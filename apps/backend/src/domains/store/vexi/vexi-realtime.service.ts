import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ai_engine_configs } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { SubscriptionAccessService } from '../subscriptions/services/subscription-access.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateRealtimeSessionDto } from './dto';

/** OpenAI-compatible endpoints for the Realtime API. */
const CLIENT_SECRETS_PATH = '/realtime/client_secrets';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
const DEFAULT_VOICE = 'marin';

/**
 * The `ai_engine_applications` row that owns the spoken persona. Seeded for new
 * installs and created in existing ones by
 * `20260806120000_vexi_realtime_voice_app`.
 */
const VOICE_APP_KEY = 'vexi_realtime_voice';

/**
 * Client secret TTL. Short on purpose: the secret only has to survive the SDP
 * handshake, which happens immediately after the fetch. A long-lived secret
 * sitting in browser memory is a bearer token for the provider account, so the
 * configurable value is clamped rather than trusted — a super-admin typo of
 * `100000` must not turn into a 27-hour credential.
 */
const DEFAULT_CLIENT_SECRET_TTL_SECONDS = 60;
const MIN_CLIENT_SECRET_TTL_SECONDS = 10;
const MAX_CLIENT_SECRET_TTL_SECONDS = 300;

interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

type TurnDetectionType = 'server_vad' | 'semantic_vad';
type NoiseReductionType = 'near_field' | 'far_field';

interface RealtimeTurnDetection {
  type: TurnDetectionType;
  threshold?: number;
  silence_duration_ms?: number;
}

/**
 * The provider nests both VAD and noise reduction under `audio.input`, and the
 * voice under `audio.output`. Getting that nesting wrong is not an error — the
 * misplaced key is silently ignored — so the shape is built here, once, and the
 * browser forwards it without interpreting it.
 */
interface RealtimeAudioInputPatch {
  turn_detection?: RealtimeTurnDetection | null;
  noise_reduction?: { type: NoiseReductionType } | null;
  transcription?: { model: string } | null;
}

export interface RealtimeSessionPatch {
  tool_choice: 'auto';
  audio?: { input: RealtimeAudioInputPatch };
}

export interface RealtimeSessionGrant {
  client_secret: string;
  expires_at: number;
  model: string;
  voice: string;
  base_url: string;
  tools: RealtimeToolDefinition[];
  /**
   * The spoken persona, from the voice application's `system_prompt`. Null when
   * no application governs the session, in which case the browser applies its
   * own baseline instead of leaving the model unguided.
   */
  instructions: string | null;
  session_patch: RealtimeSessionPatch;
}

@Injectable()
export class VexiRealtimeService {
  private readonly logger = new Logger(VexiRealtimeService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {}

  /**
   * Mints a short-lived provider credential for the browser and hands it the
   * tool catalog it is allowed to expose to the model.
   *
   * The permanent API key never leaves this process.
   */
  async createSession(
    dto: CreateRealtimeSessionDto,
  ): Promise<RealtimeSessionGrant> {
    const { config, instructions } = await this.resolveVoiceSetup();

    // Antes de gastar un viaje al proveedor, comprobar que el proveedor es de
    // los que hablan este protocolo. Sin esto el 502 genérico de abajo culpa al
    // proveedor de un error de configuración nuestro.
    const mismatch = this.describeRealtimeCapability(config);
    if (mismatch) {
      throw new VendixHttpException(ErrorCodes.AI_PROVIDER_002, mismatch);
    }

    const apiKey = this.resolveApiKey(config);

    if (!apiKey) {
      throw new VendixHttpException(
        ErrorCodes.AI_PROVIDER_002,
        'No API key available for the realtime audio provider',
      );
    }

    const settings = (config?.settings as Record<string, any>) ?? {};
    const model = config?.model_id || DEFAULT_REALTIME_MODEL;
    const voice = dto.voice || settings.voice || DEFAULT_VOICE;
    const baseUrl = (config?.base_url || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const tools = this.buildToolCatalog();
    const ttlSeconds = this.resolveTtlSeconds(settings);
    const sessionPatch = this.buildSessionPatch(settings);

    const response = await fetch(`${baseUrl}${CLIENT_SECRETS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Ties provider-side abuse signals to our user without leaking the id.
        'OpenAI-Safety-Identifier': this.safetyIdentifier(),
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: ttlSeconds },
        session: {
          type: 'realtime',
          model,
          audio: { output: { voice } },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Realtime client secret request failed (${response.status}) ` +
          `host=${baseUrl} model=${model}: ${detail.slice(0, 300)}`,
      );
      // El host y el modelo entran en el mensaje porque son la mitad del
      // diagnóstico y ninguno es secreto; la clave nunca sale de este proceso.
      // Sin ellos, "el proveedor rechazó la sesión" obliga a leer logs de
      // producción para saber a QUÉ proveedor se le pidió.
      throw new VendixHttpException(
        ErrorCodes.AI_PROVIDER_001,
        `El proveedor de realtime rechazó la sesión (HTTP ${response.status}) ` +
          `en ${baseUrl}${CLIENT_SECRETS_PATH} con el modelo "${model}".`,
      );
    }

    const payload = (await response.json()) as {
      value?: string;
      expires_at?: number;
    };

    if (!payload?.value) {
      throw new VendixHttpException(
        ErrorCodes.AI_PROVIDER_001,
        'Realtime provider returned no client secret',
      );
    }

    return {
      client_secret: payload.value,
      expires_at:
        payload.expires_at ?? Math.floor(Date.now() / 1000) + ttlSeconds,
      model,
      voice,
      base_url: baseUrl,
      tools,
      instructions,
      session_patch: sessionPatch,
    };
  }

  /**
   * Executes a tool the model asked for during a voice turn.
   *
   * Two independent gates apply: the tool must be declared side-effect free,
   * and `AIToolRegistry.executeTool` re-checks the caller's permissions
   * against the ambient request context. The read-only gate is the one that
   * matters here — the browser chooses which tool to call, so a write tool
   * would be reachable without the user ever seeing what they authorized.
   */
  async executeToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    // A client-side command reaching this bridge means the browser failed to
    // dispatch it locally. Let it fall through so `executeTool()` answers with
    // the specific "this runs in the browser" error instead of the generic
    // voice veto — the two failures need different fixes.
    if (!this.toolRegistry.isReadOnly(name) && !this.toolRegistry.isClientSide(name)) {
      this.logger.warn(
        `Realtime voice attempted a non-read-only tool: ${name} ` +
          `(store=${RequestContextService.getContext()?.store_id})`,
      );
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_004,
        `Tool "${name}" is not available in voice mode`,
      );
    }

    return this.toolRegistry.executeTool(name, args as Record<string, any>);
  }

  /**
   * Charges the store for the session after it closes.
   *
   * Consumption is post-hoc because the duration is only known once the peer
   * connection ends — the same "never consume before success" rule the AI
   * engine applies to provider calls.
   */
  async consumeSessionQuota(
    durationSeconds: number,
    requestId: string,
  ): Promise<void> {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId || durationSeconds <= 0) return;

    await this.subscriptionAccess.consumeAIQuota(
      storeId,
      'realtime_voice',
      Math.ceil(durationSeconds),
      requestId,
    );
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Explains, before any network call, why the configured provider cannot serve
   * a realtime session — or returns null when it can be attempted.
   *
   * Existe porque el fallo real es indistinguible del correcto desde el lado del
   * proveedor: `vexi_realtime_voice` quedó apuntando a una config de MiniMax
   * T2A, que sólo dicta texto a audio. El POST a
   * `https://api.minimax.io/v1/t2a_v2/realtime/client_secrets` devuelve un 4xx
   * como devolvería una clave vencida, y el mensaje resultante — "Realtime
   * provider rejected the session request" — culpa al proveedor de una decisión
   * de configuración nuestra, sin nombrar el campo que hay que corregir.
   *
   * El discriminante es `sdk_type`, no `model_type` ni la URL: es el campo que
   * elige el cliente en `AIEngineService.initializeProvider`, y de los tres
   * valores admitidos (`openai_compatible`, `anthropic_compatible`,
   * `minimax_t2a`) sólo el primero expone el Realtime API. Una URL heurística
   * daría falsos negativos con despliegues tipo Azure, cuyo host no se parece al
   * de OpenAI y sí habla el protocolo.
   *
   * Una config ausente NO es un fallo: `createSession` cae al host de OpenAI por
   * defecto, que sí es capaz. Ese caso lo cubre la comprobación de clave.
   */
  private describeRealtimeCapability(
    config: ai_engine_configs | null,
  ): string | null {
    if (!config) return null;
    if (config.sdk_type === 'openai_compatible') return null;

    return (
      `La aplicación ${VOICE_APP_KEY} apunta a la configuración ` +
      `"${config.label}" (${config.provider} / ${config.sdk_type}), que no expone ` +
      `el Realtime API: sólo el sdk_type "openai_compatible" lo hace. ` +
      `Apúntala a un proveedor OpenAI-compatible con /realtime, o usa el motor ` +
      `"pipeline" en Ajustes → Vexi → Motor de voz, que sí funciona con ` +
      `${config.provider}.`
    );
  }

  /**
   * Resolves the two halves of a voice session from the AI Engine surface:
   * behaviour from the `vexi_realtime_voice` application, transport from the
   * `ai_engine_configs` row it points at.
   *
   * Neither half is required to boot. The application is treated as "not
   * configured" when absent or inactive — never as an off switch, because
   * `VexiEnabledGuard` is the only thing that mutes the voice and a second kill
   * switch would make it ambiguous which one wins.
   */
  private async resolveVoiceSetup(): Promise<{
    config: ai_engine_configs | null;
    instructions: string | null;
  }> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: VOICE_APP_KEY },
      include: { config: true },
    });

    const activeApp = app?.is_active === true ? app : null;
    const instructions = activeApp?.system_prompt?.trim() || null;

    // The linked config wins. When the application exists but nobody has linked
    // a config yet — the state right after the migration — only the transport
    // falls back: the persona already applies, so editing it works before
    // anyone touches the config selector.
    if (activeApp?.config?.is_active) {
      return { config: activeApp.config, instructions };
    }

    const config = await this.prisma.ai_engine_configs.findFirst({
      where: { model_type: 'audio', is_active: true },
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
    });

    return { config, instructions };
  }

  /**
   * Translates the flat `settings` keys a super-admin edits into the nested
   * shape the provider expects.
   *
   * An explicit `'off'` maps to `null`, which is how the provider is told to
   * disable a stage; omitting the key entirely leaves the provider default in
   * place. Those two are different outcomes, so the distinction is preserved.
   */
  private buildSessionPatch(
    settings: Record<string, any>,
  ): RealtimeSessionPatch {
    const patch: RealtimeSessionPatch = { tool_choice: 'auto' };
    const input: RealtimeAudioInputPatch = {};

    const vad = settings.turn_detection_type;
    if (vad === 'server_vad' || vad === 'semantic_vad') {
      const turnDetection: RealtimeTurnDetection = { type: vad };

      const silence = this.positiveInt(settings.turn_detection_silence_ms);
      if (silence !== null) turnDetection.silence_duration_ms = silence;

      // `threshold` is an amplitude cutoff, meaningless for semantic VAD, which
      // decides on meaning rather than loudness. Sending it there would be
      // ignored without complaint, so it is scoped to server VAD.
      if (vad === 'server_vad') {
        const threshold = this.unitFraction(settings.turn_detection_threshold);
        if (threshold !== null) turnDetection.threshold = threshold;
      }

      input.turn_detection = turnDetection;
    } else if (vad === 'off') {
      input.turn_detection = null;
    }

    const noise = settings.noise_reduction;
    if (noise === 'near_field' || noise === 'far_field') {
      input.noise_reduction = { type: noise };
    } else if (noise === 'off') {
      input.noise_reduction = null;
    }

    const transcriptionModel =
      typeof settings.transcription_model === 'string'
        ? settings.transcription_model.trim()
        : '';
    if (transcriptionModel) {
      input.transcription = { model: transcriptionModel };
    }

    if (Object.keys(input).length > 0) patch.audio = { input };

    return patch;
  }

  /** Clamped, never trusted — see the TTL constants above for why. */
  private resolveTtlSeconds(settings: Record<string, any>): number {
    const raw = this.toNumber(settings.client_secret_ttl_seconds);
    if (raw === null) return DEFAULT_CLIENT_SECRET_TTL_SECONDS;

    return Math.min(
      MAX_CLIENT_SECRET_TTL_SECONDS,
      Math.max(MIN_CLIENT_SECRET_TTL_SECONDS, Math.trunc(raw)),
    );
  }

  private positiveInt(value: unknown): number | null {
    const parsed = this.toNumber(value);
    if (parsed === null || parsed <= 0) return null;
    return Math.trunc(parsed);
  }

  private unitFraction(value: unknown): number | null {
    const parsed = this.toNumber(value);
    if (parsed === null || parsed < 0 || parsed > 1) return null;
    return parsed;
  }

  /**
   * Absent-or-unparseable to `null`, so callers can tell "not configured" from a
   * real value.
   *
   * `Number()` alone will not do: it maps `null`, `''` and `[]` to `0`, which is
   * a legitimate value for a threshold. Without this guard a cleared field would
   * arrive as an explicit `0` — for `threshold` that means "treat any sound as
   * speech", the opposite of leaving it unset.
   */
  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private resolveApiKey(config: { provider?: string; api_key_ref?: string | null } | null): string {
    if (config?.api_key_ref) return config.api_key_ref;
    const provider = (config?.provider || 'openai').toUpperCase().replace(/\s+/g, '_');
    const envKey = `AI_${provider}_API_KEY`;
    return (
      process.env[envKey] ||
      this.configService.get<string>(envKey) ||
      process.env.AI_OPENAI_API_KEY ||
      ''
    );
  }

  /**
   * Read-only catalog, already filtered by the caller's permissions. Realtime
   * wants a flat `{type, name, description, parameters}`; the registry emits
   * the chat-completions shape with the payload nested under `function`.
   */
  private buildToolCatalog(): RealtimeToolDefinition[] {
    const context = RequestContextService.getContext();
    // `[]` is truthy — check length so an empty permission list falls back to
    // roles instead of pinning the catalog to zero tools.
    const granted = context?.permissions;
    const scope = granted?.length ? granted : context?.roles;
    // Read-only data tools plus client-side UI commands. The latter belong in
    // voice more than anywhere else — "llévame a inventario" is the whole
    // reason to talk instead of click — and they carry no write risk: the
    // browser dispatches them and `executeTool()` refuses them outright.
    return [
      ...this.toolRegistry.getReadOnlyDefinitions(scope),
      ...this.toolRegistry.getClientSideDefinitions(scope),
    ].map((d) => ({
      type: 'function' as const,
      name: d.function.name,
      description: d.function.description,
      parameters: d.function.parameters,
    }));
  }

  private safetyIdentifier(): string {
    const context = RequestContextService.getContext();
    return `vendix-store-${context?.store_id ?? 'unknown'}-user-${context?.user_id ?? 'unknown'}`;
  }
}
