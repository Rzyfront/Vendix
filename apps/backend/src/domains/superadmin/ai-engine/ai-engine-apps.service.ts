import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ai_model_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import {
  AgentDeadline,
  agentDeadlineContext,
  isAgentAbort,
} from '../../../ai-engine/tasks/agent-deadline';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { isSystemAppKey } from '../../../ai-engine/system-app-keys';
import { CreateAIAppDto, UpdateAIAppDto, AIAppQueryDto } from './dto';

/**
 * Plazo máximo de la prueba manual de una aplicación (Super Admin › AI Engine).
 * Sin él, el SDK del proveedor espera hasta 10 min por defecto: la petición del
 * navegador queda colgada ocupando una conexión y la pantalla no responde.
 * Es el plazo por defecto (texto, audio, embeddings…). Imagen y video tardan
 * más: ver `AI_APP_TEST_TIMEOUT_BY_TYPE_MS`. El frontend corta a los 200 s
 * (`AI_TEST_ACTION_TIMEOUT_MS`), así que ningún plazo de aquí debe llegar a él.
 */
export const AI_APP_TEST_TIMEOUT_MS = 90_000;

/**
 * Plazo de la prueba según el tipo de ejecución. La generación de video suele
 * pasar de 90 s; con el plazo por defecto la prueba de una app de video
 * quedaría siempre en `AI_APP_TEST_TIMEOUT`. Para cambiarlo, edita este mapa y
 * mantén el máximo por debajo del plazo del frontend.
 */
export const AI_APP_TEST_TIMEOUT_BY_TYPE_MS: Readonly<Record<string, number>> =
  {
    image: 120_000,
    video: 180_000,
  };

@Injectable()
export class AIEngineAppsService {
  private readonly logger = new Logger(AIEngineAppsService.name);
  /** Sobrescribible solo en specs. */
  protected testTimeoutMs = AI_APP_TEST_TIMEOUT_MS;
  /** Sobrescribible solo en specs. */
  protected testTimeoutByTypeMs: Readonly<Record<string, number>> =
    AI_APP_TEST_TIMEOUT_BY_TYPE_MS;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
  ) {}

  /**
   * `fallback_config_id` must be an active config different from the primary.
   * Reuses AI_CONFIG_001 (missing/inactive) and AI_APP_005 (same as primary).
   */
  private async assertValidFallback(
    fallbackConfigId: number | null | undefined,
    primaryConfigId: number | null | undefined,
    appModelType?: ai_model_type_enum,
  ): Promise<void> {
    if (!fallbackConfigId) return;
    if (fallbackConfigId === primaryConfigId) {
      throw new VendixHttpException(ErrorCodes.AI_APP_005);
    }
    const config = await this.prisma.ai_engine_configs.findUnique({
      where: { id: fallbackConfigId },
      select: { id: true, is_active: true, model_type: true },
    });
    if (!config || !config.is_active) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }
    // A fallback of another kind (e.g. image model behind a text app) would
    // "answer" with the wrong modality exactly when the primary is down.
    if (appModelType && config.model_type !== appModelType) {
      throw new VendixHttpException(ErrorCodes.AI_APP_005);
    }
  }

  async create(dto: CreateAIAppDto) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_002);
    }

    let configModelType: ai_model_type_enum | undefined;

    // Validate config_id exists if provided
    if (dto.config_id) {
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: dto.config_id },
        select: { id: true, model_type: true },
      });
      if (!config) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
      }
      configModelType = config.model_type;
    }

    // Cross-validate model_type: if app declares one and config declares one,
    // they MUST match.
    if (
      dto.model_type &&
      configModelType &&
      dto.model_type !== configModelType
    ) {
      throw new VendixHttpException(ErrorCodes.AI_APP_005);
    }

    // Effective model_type for the new app: dto value, else config value, else 'text'.
    const effectiveModelType: ai_model_type_enum =
      dto.model_type ?? configModelType ?? 'text';

    await this.assertValidFallback(
      dto.fallback_config_id,
      dto.config_id,
      effectiveModelType,
    );

    return this.prisma.ai_engine_applications.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        config_id: dto.config_id || null,
        fallback_config_id: dto.fallback_config_id || null,
        system_prompt: dto.system_prompt,
        prompt_template: dto.prompt_template,
        temperature: dto.temperature,
        max_tokens: dto.max_tokens,
        output_format: dto.output_format || 'text',
        model_type: effectiveModelType,
        rate_limit: dto.rate_limit as any,
        retry_config: dto.retry_config as any,
        is_active: dto.is_active ?? true,
        metadata: dto.metadata as any,
        ai_feature_category: dto.ai_feature_category,
        updated_at: new Date(),
      },
      include: {
        config: {
          select: {
            id: true,
            label: true,
            provider: true,
            model_id: true,
            model_type: true,
            settings: true,
          },
        },
      },
    });
  }

  async findAll(query: AIAppQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      output_format,
      model_type,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.ai_engine_applicationsWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (output_format) {
      where.output_format = output_format;
    }

    if (model_type) {
      where.model_type = model_type;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_engine_applications.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          config: {
            select: {
              id: true,
              label: true,
              provider: true,
              model_id: true,
              model_type: true,
              settings: true,
            },
          },
        },
      }),
      this.prisma.ai_engine_applications.count({ where }),
    ]);

    return {
      data: data.map((row) => this.withSystemFlag(row)),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
      include: {
        config: {
          select: {
            id: true,
            label: true,
            provider: true,
            model_id: true,
            model_type: true,
            settings: true,
          },
        },
      },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    return this.withSystemFlag(app);
  }

  /**
   * `is_system`: the backend resolves this app by key, so the panel offers
   * edit / turn off but never delete (see `SYSTEM_AI_APP_KEYS`).
   */
  private withSystemFlag<T extends { key: string }>(
    app: T,
  ): T & { is_system: boolean } {
    return { ...app, is_system: isSystemAppKey(app.key) };
  }

  async update(id: number, dto: UpdateAIAppDto) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    // Check key uniqueness if changing
    if (dto.key && dto.key !== existing.key) {
      const conflict = await this.prisma.ai_engine_applications.findUnique({
        where: { key: dto.key },
      });
      if (conflict) {
        throw new VendixHttpException(ErrorCodes.AI_APP_002);
      }
    }

    let configModelType: ai_model_type_enum | undefined;

    // Validate config_id if provided
    if (dto.config_id) {
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: dto.config_id },
        select: { id: true, model_type: true },
      });
      if (!config) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
      }
      configModelType = config.model_type;
    }

    // Effective model_type after the update: incoming dto value, else current row value.
    const effectiveModelType: ai_model_type_enum | undefined =
      dto.model_type ?? existing.model_type;

    if (
      dto.fallback_config_id !== undefined ||
      dto.config_id !== undefined ||
      dto.model_type !== undefined
    ) {
      await this.assertValidFallback(
        dto.fallback_config_id !== undefined
          ? dto.fallback_config_id
          : (existing as { fallback_config_id?: number | null })
              .fallback_config_id,
        dto.config_id !== undefined ? dto.config_id : existing.config_id,
        effectiveModelType,
      );
    }

    // Cross-validate model_type: when both sides are known, they must match.
    if (
      effectiveModelType &&
      configModelType &&
      effectiveModelType !== configModelType
    ) {
      throw new VendixHttpException(ErrorCodes.AI_APP_005);
    }

    return this.prisma.ai_engine_applications.update({
      where: { id },
      data: {
        ...dto,
        temperature: dto.temperature,
        rate_limit: dto.rate_limit as any,
        retry_config: dto.retry_config as any,
        metadata: dto.metadata as any,
        // Null/undefined on update means "leave unchanged": the DTO rejects
        // null via @IsString, but PartialType makes the property optional, so
        // an explicit null must not wipe a NOT NULL column into a 500.
        ai_feature_category: dto.ai_feature_category ?? undefined,
        model_type: dto.model_type !== undefined ? dto.model_type : undefined,
        updated_at: new Date(),
      },
      include: {
        config: {
          select: {
            id: true,
            label: true,
            provider: true,
            model_id: true,
            model_type: true,
            settings: true,
          },
        },
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    if (isSystemAppKey(existing.key)) {
      throw new VendixHttpException(
        ErrorCodes.AI_APP_006,
        'Esta aplicación la usa el sistema; puedes editarla o apagarla, pero no borrarla',
      );
    }

    await this.prisma.ai_engine_applications.delete({ where: { id } });
  }

  /**
   * Prueba manual de una aplicación. Nunca lanza por un fallo de la prueba:
   * app desactivada, error del proveedor o plazo vencido vuelven como
   * `{ success: false, error }` rápido y controlado, para que la pantalla lo
   * muestre en su propio mensaje. Solo una app inexistente sigue siendo 404.
   *
   * `clientSignal` (opcional) se aborta cuando el cliente cierra la conexión:
   * se enlaza al plazo para cancelar la llamada al proveedor y no dejarla
   * trabajando para nadie.
   */
  async testApplication(id: number, clientSignal?: AbortSignal) {
    const app = await this.findOne(id);

    if (!app.is_active) {
      return {
        success: false,
        error:
          'La aplicación está desactivada. Actívala para poder probarla.',
        error_code: ErrorCodes.AI_APP_003.code,
      };
    }

    // Build a minimal test using the app's template
    const testVars: Record<string, string> = {
      name: 'Test',
      context: 'Testing',
      // Speech apps carry `{{text}}` as their whole template — that placeholder
      // IS the text to dictate. Without a value `interpolate()` leaves the
      // braces in place and the model reads "{{text}}" out loud, so the test
      // button would burn a call and prove nothing. A real phrase also makes
      // the button useful for its actual purpose: hearing the configured voice
      // before committing to it.
      text: 'Hola, soy Vexi. Esta es una prueba de voz.',
    };

    const modelType = await this.aiEngine.getApplicationModelType(app.key);
    const executionType = this.resolveExecutionType(
      app.output_format,
      modelType,
    );
    const timeoutMs =
      this.testTimeoutByTypeMs[executionType] ?? this.testTimeoutMs;
    const deadline = new AgentDeadline({
      wallDeadlineMs: Date.now() + timeoutMs,
      activeBudgetMs: Infinity,
      reserveMs: 0,
      signal: clientSignal,
    });
    let response: any;
    try {
      // El contexto propaga la señal de aborto a los proveedores que la
      // honran; `deadline.run` responde a tiempo aunque alguno no la honre.
      response = await agentDeadlineContext.run(deadline, () =>
        deadline.run(() =>
          this.executeTestByType(app.key, executionType, testVars),
        ),
      );
    } catch (error) {
      const clientGone = !!clientSignal?.aborted;
      const timedOut = !clientGone && isAgentAbort(error, deadline.signal);
      this.logger.warn(
        `Test of AI app #${id} (${app.key}) failed: ${
          clientGone
            ? 'client disconnected, provider call cancelled'
            : timedOut
              ? `timeout after ${timeoutMs}ms`
              : error instanceof Error
                ? error.message
                : String(error)
        }`,
      );
      return {
        success: false,
        error: clientGone
          ? 'La prueba se canceló porque se cerró la conexión.'
          : timedOut
            ? `El proveedor de IA no respondió en ${Math.round(
                timeoutMs / 1000,
              )} s. Revisa la configuración o inténtalo más tarde.`
            : this.describeTestFailure(error),
        error_code: clientGone
          ? 'AI_APP_TEST_CANCELLED'
          : timedOut
            ? 'AI_APP_TEST_TIMEOUT'
            : 'AI_APP_TEST_FAILED',
        model_type: executionType,
      };
    } finally {
      deadline.dispose();
    }

    return {
      success: response.success,
      content: this.extractTestContent(response),
      usage: response.usage,
      error: response.error,
      model_type: executionType,
    };
  }

  async getDashboardStats() {
    const [totalApps, activeApps, appsByFormat, appsByConfig] =
      await Promise.all([
        this.prisma.ai_engine_applications.count(),
        this.prisma.ai_engine_applications.count({
          where: { is_active: true },
        }),
        this.prisma.ai_engine_applications.groupBy({
          by: ['output_format'],
          _count: true,
        }),
        this.prisma.ai_engine_applications.groupBy({
          by: ['config_id'],
          _count: true,
        }),
      ]);

    return {
      totalApps,
      activeApps,
      inactiveApps: totalApps - activeApps,
      appsByFormat: appsByFormat.reduce(
        (acc, item) => {
          acc[item.output_format] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      usingDefaultConfig:
        appsByConfig.find((c) => c.config_id === null)?._count || 0,
      usingCustomConfig: appsByConfig
        .filter((c) => c.config_id !== null)
        .reduce((sum, c) => sum + c._count, 0),
    };
  }

  /** Mensaje corto y legible del fallo de la prueba (sin stack ni cuerpo crudo). */
  private describeTestFailure(error: unknown): string {
    const detail = error instanceof Error ? error.message.trim() : '';
    const base = 'La prueba de la aplicación falló';
    return detail ? `${base}: ${detail.slice(0, 300)}` : `${base}.`;
  }

  private resolveExecutionType(
    outputFormat: string,
    modelType: string,
  ): string {
    if (
      [
        'image',
        'embedding',
        'audio',
        'video',
        'speech',
        'transcription',
        'rerank',
      ].includes(outputFormat)
    ) {
      return outputFormat;
    }

    if (modelType === 'image') return 'image';
    if (modelType === 'embedding') return 'embedding';
    if (modelType === 'audio') return 'audio';
    if (modelType === 'video') return 'video';
    if (modelType === 'speech') return 'speech';
    if (modelType === 'transcription') return 'transcription';
    if (modelType === 'rerank') return 'rerank';
    return 'text';
  }

  private async executeTestByType(
    appKey: string,
    executionType: string,
    testVars: Record<string, string>,
  ): Promise<any> {
    switch (executionType) {
      case 'image':
        return this.aiEngine.runImage(appKey, testVars);
      case 'embedding':
        return this.aiEngine.runEmbedding(appKey, testVars);
      case 'audio':
        return this.aiEngine.run(appKey, testVars, [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Reply with OK after reading this audio.',
              },
              {
                type: 'input_audio',
                input_audio: {
                  data: this.buildSilentWavBase64(),
                  format: 'wav',
                },
              },
            ],
          },
        ]);
      case 'video':
        return this.aiEngine.runVideo(appKey, testVars);
      case 'speech':
        return this.aiEngine.runSpeech(appKey, testVars);
      case 'transcription':
        return this.aiEngine.runTranscription(
          appKey,
          {
            inputAudio: {
              data: this.buildSilentWavBase64(),
              format: 'wav',
            },
          },
          testVars,
        );
      case 'rerank':
        return this.aiEngine.runRerank(appKey, testVars, {
          query: 'Which document says Test?',
          documents: ['Test document', 'Unrelated document'],
          topN: 1,
        });
      case 'text':
      default:
        return this.aiEngine.run(appKey, testVars);
    }
  }

  private extractTestContent(response: any): string | undefined {
    if ('content' in response) return response.content;
    if ('imageBase64' in response) return response.imageBase64;
    if ('embedding' in response) return JSON.stringify(response.embedding);
    if ('audioBase64' in response) return response.audioBase64;
    if ('urls' in response) return JSON.stringify(response.urls);
    if ('text' in response) return response.text;
    if ('results' in response) return JSON.stringify(response.results);
    return undefined;
  }

  private buildSilentWavBase64(): string {
    const sampleRate = 8000;
    const durationSeconds = 0.1;
    const samples = Math.floor(sampleRate * durationSeconds);
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    return buffer.toString('base64');
  }
}
