import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import type { RegisteredTool } from '../../../ai-engine/tools/interfaces/tool.interface';
import { AIUsageStatsFilter } from '../../../ai-engine/interfaces/ai-log.interface';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateAIConfigDto, UpdateAIConfigDto, AIConfigQueryDto } from './dto';

/**
 * Queues visibles en el tab Jobs del módulo super-admin AI Engine (F5).
 *
 * Las tres primeras viven en `AIQueueModule`; `receipt-scan` y `expense-scan`
 * son colas por dominio (dispatch-notes y expenses) con el mismo patrón
 * async 202 + poll. `AIQueueService.getJobStatus()` solo conoce las tres
 * primeras, así que el overview y el lookup resuelven las `Queue` de BullMQ
 * directamente: una sola ruta de código y el mismo shape `AIJobResult` para
 * las cinco.
 */
export const AI_ENGINE_QUEUE_NAMES = [
  'ai-generation',
  'ai-embedding',
  'ai-agent',
  'receipt-scan',
  'expense-scan',
] as const;

export type AIQueueName = (typeof AI_ENGINE_QUEUE_NAMES)[number];

export type AIToolCategory = 'read' | 'write' | 'ui';

/**
 * Model types that cannot be the platform-wide default configuration.
 *
 * A blacklist rather than a special case for `audio`: `defaultConfigId` is a
 * single value shared by every application whose `config_id` is NULL, and the
 * overwhelming majority of those applications need a text model. Any non-text
 * type in that slot breaks them. Listing the types that must never hold it
 * keeps a new `model_type` from silently becoming eligible.
 */
const NON_DEFAULTABLE_MODEL_TYPES = new Set([
  'audio',
  'speech',
  'transcription',
  'video',
  'rerank',
  'embedding',
]);

@Injectable()
export class AIEngineConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly aiLoggingService: AILoggingService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  async create(dto: CreateAIConfigDto) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: {
        provider_model_id: {
          provider: dto.provider,
          model_id: dto.model_id,
        },
      },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_002);
    }

    this.assertDefaultAllowed(dto.model_type, dto.is_default);

    // If setting as default, unset previous default
    if (dto.is_default) {
      await this.prisma.ai_engine_configs.updateMany({
        where: { is_default: true },
        data: { is_default: false },
      });
    }

    const config = await this.prisma.ai_engine_configs.create({
      data: {
        provider: dto.provider,
        sdk_type: dto.sdk_type,
        label: dto.label,
        model_id: dto.model_id,
        base_url: this.cleanBaseUrl(dto.base_url) || null,
        api_key_ref: dto.api_key_ref || null,
        is_default: dto.is_default || false,
        is_active: dto.is_active ?? true,
        ...(dto.model_type !== undefined ? { model_type: dto.model_type } : {}),
        settings: dto.settings as any,
        updated_at: new Date(),
      },
    });

    await this.aiEngine.reloadConfigurations();
    return this.maskApiKey(config);
  }

  async findAll(query: AIConfigQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sdk_type,
      model_type,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.ai_engine_configsWhereInput = {};

    if (search) {
      where.OR = [
        { label: { contains: search, mode: 'insensitive' } },
        { provider: { contains: search, mode: 'insensitive' } },
        { model_id: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (sdk_type) {
      where.sdk_type = sdk_type;
    }

    if (model_type) {
      where.model_type = model_type;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_engine_configs.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.ai_engine_configs.count({ where }),
    ]);

    return {
      data: data.map((c) => this.maskApiKey(c)),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const config = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    return this.maskApiKey(config);
  }

  async update(id: number, dto: UpdateAIConfigDto) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    // F-001 (blocker): the panel round-trips maskApiKey() output
    // ('****' + last4, or '****') when the operator did not type a new
    // secret. Persisting that placeholder as api_key_ref would orphan the
    // real secret and break every provider call with AI_PROVIDER_002, so a
    // masked value is dropped from the payload and the stored ref survives.
    if (
      typeof dto.api_key_ref === 'string' &&
      dto.api_key_ref.startsWith('****')
    ) {
      delete dto.api_key_ref;
    }

    // Check for duplicate provider+model_id
    if (
      (dto.provider || dto.model_id) &&
      (dto.provider !== existing.provider || dto.model_id !== existing.model_id)
    ) {
      const conflict = await this.prisma.ai_engine_configs.findUnique({
        where: {
          provider_model_id: {
            provider: dto.provider || existing.provider,
            model_id: dto.model_id || existing.model_id,
          },
        },
      });
      if (conflict && conflict.id !== id) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_002);
      }
    }

    // Resolved against the persisted row, not just the payload: the likeliest
    // way to hit this is `PATCH {"is_default": true}` on a config that is
    // already audio, where the DTO carries no `model_type` at all.
    this.assertDefaultAllowed(
      dto.model_type ?? existing.model_type,
      dto.is_default ?? existing.is_default,
    );

    // If setting as default, unset previous default
    if (dto.is_default) {
      await this.prisma.ai_engine_configs.updateMany({
        where: { is_default: true, id: { not: id } },
        data: { is_default: false },
      });
    }

    const updated = await this.prisma.ai_engine_configs.update({
      where: { id },
      data: {
        ...dto,
        base_url:
          dto.base_url !== undefined
            ? this.cleanBaseUrl(dto.base_url) || null
            : undefined,
        model_type: dto.model_type !== undefined ? dto.model_type : undefined,
        settings: dto.settings as any,
        updated_at: new Date(),
      },
    });

    await this.aiEngine.reloadConfigurations();
    return this.maskApiKey(updated);
  }

  async remove(id: number) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    await this.prisma.ai_engine_configs.delete({ where: { id } });
    await this.aiEngine.reloadConfigurations();
  }

  async getDashboardStats() {
    const [
      totalConfigs,
      activeConfigs,
      inactiveConfigs,
      configsBySdkType,
      configsByProvider,
      defaultConfig,
    ] = await Promise.all([
      this.prisma.ai_engine_configs.count(),
      this.prisma.ai_engine_configs.count({ where: { is_active: true } }),
      this.prisma.ai_engine_configs.count({ where: { is_active: false } }),
      this.prisma.ai_engine_configs.groupBy({
        by: ['sdk_type'],
        _count: true,
      }),
      this.prisma.ai_engine_configs.groupBy({
        by: ['provider'],
        _count: true,
      }),
      this.prisma.ai_engine_configs.findFirst({
        where: { is_default: true },
        select: { id: true, label: true, provider: true, model_id: true },
      }),
    ]);

    return {
      totalConfigs,
      activeConfigs,
      inactiveConfigs,
      configsBySdkType: configsBySdkType.reduce(
        (acc, item) => {
          acc[item.sdk_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      configsByProvider: configsByProvider.reduce(
        (acc, item) => {
          acc[item.provider] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      defaultConfig,
    };
  }

  async testConnection(id: number) {
    return this.aiEngine.testProvider(id);
  }

  async getUsageStats(filter: AIUsageStatsFilter) {
    return this.aiLoggingService.getUsageStats(filter);
  }

  async getUsageByTenant(orgId: number, dateFrom?: Date, dateTo?: Date) {
    return this.aiLoggingService.getUsageByTenant(orgId, dateFrom, dateTo);
  }

  /**
   * Catálogo vivo de tools (F5, tab Tools).
   *
   * Proyección de solo lectura del `AIToolRegistry` en memoria: lo que ve el
   * operador es exactamente lo que el agent loop puede invocar. Sin
   * paginación — el catálogo es de decenas de entradas y el tab lo filtra en
   * cliente.
   */
  async getToolsCatalog() {
    return this.toolRegistry.getAll().map((tool) => ({
      name: tool.name,
      domain: tool.domain,
      description: tool.description,
      requiredPermissions: tool.requiredPermissions ?? [],
      category: this.resolveToolCategory(tool),
      readOnly: tool.readOnly ?? false,
      clientSide: tool.clientSide ?? false,
      requiresConfirmation: tool.requiresConfirmation ?? false,
    }));
  }

  /**
   * Overview de colas (F5, tab Jobs).
   *
   * Nunca rechaza por una cola caída o no registrada: cada entrada informa su
   * propio `available`/`error` para que el tab siga mostrando el resto. Una
   * cola ausente en el injector (p. ej. dominio sin workers en este deploy)
   * se reporta como no disponible, no como 500.
   */
  async getQueuesOverview() {
    const queues = await Promise.all(
      AI_ENGINE_QUEUE_NAMES.map(async (name) => {
        const queue = this.resolveQueue(name);
        if (!queue) {
          return {
            name,
            available: false,
            counts: null,
            error: `Queue '${name}' is not registered in this deployment`,
          };
        }
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
            'paused',
          );
          return { name, available: true, counts, error: null };
        } catch (error: any) {
          return {
            name,
            available: false,
            counts: null,
            error: error?.message ?? `Queue '${name}' is unreachable`,
          };
        }
      }),
    );
    return { queues };
  }

  /**
   * Estado de un job por cola + id (F5, tab Jobs, búsqueda).
   *
   * Mismo shape y mismo código que `AIQueueService.getJobStatus`: una cola
   * desconocida y un job inexistente responden el mismo 404 (`AI_QUEUE_002`)
   * para no filtrar existencia.
   */
  async getQueueJobStatus(queueName: string, jobId: string) {
    if (
      !(AI_ENGINE_QUEUE_NAMES as readonly string[]).includes(queueName) ||
      !jobId
    ) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }
    const queue = this.resolveQueue(queueName);
    if (!queue) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }
    const job = await queue.getJob(jobId);
    if (!job) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }
    const state = await job.getState();
    return {
      job_id: job.id!,
      status: state,
      result: job.returnvalue,
      error: job.failedReason,
      progress: typeof job.progress === 'number' ? job.progress : undefined,
    };
  }

  /**
   * La categoría que muestra el tab Tools, derivada de las mismas flags que
   * gobiernan la ejecución: `clientSide` se despacha en el navegador (UI),
   * `requiresConfirmation` muta datos vía el circuito propose→confirm
   * (write), el resto es solo lectura (read).
   */
  private resolveToolCategory(tool: RegisteredTool): AIToolCategory {
    if (tool.clientSide) return 'ui';
    if (tool.requiresConfirmation) return 'write';
    return 'read';
  }

  /**
   * Las colas de scan viven en módulos de dominio que este módulo no importa
   * (hacerlo cerraría ciclos con `AIEngineModule`, que es `@Global()`), así
   * que se resuelven por token en todo el contenedor. `strict: false` es lo
   * que lo permite sin añadir imports entre dominios.
   */
  private resolveQueue(name: string): Queue | null {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  private maskApiKey(config: any): any {
    if (!config.api_key_ref) return config;
    const masked =
      config.api_key_ref.length > 4
        ? '****' + config.api_key_ref.slice(-4)
        : '****';
    return { ...config, api_key_ref: masked };
  }

  private cleanBaseUrl(baseUrl?: string | null): string | undefined {
    if (!baseUrl) return undefined;

    return baseUrl.trim() || undefined;
  }

  /**
   * Only a text configuration may be the global default.
   *
   * `AIEngineService.loadConfigurations()` keeps a single `defaultConfigId`
   * without discriminating by `model_type`, and every application resolves as
   * `app.config_id || defaultConfigId`. Most seeded applications ship with
   * `config_id = null`, so making a non-text config the default silently
   * redirects every text and vision application to a provider that cannot
   * serve them.
   *
   * Enforced at the edge instead of relying on operator discipline, because the
   * failure is remote from its cause: the config saves fine and unrelated
   * applications break later.
   */
  private assertDefaultAllowed(
    modelType: string | null | undefined,
    isDefault: boolean | null | undefined,
  ): void {
    if (isDefault === true && NON_DEFAULTABLE_MODEL_TYPES.has(modelType ?? '')) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_003);
    }
  }
}
