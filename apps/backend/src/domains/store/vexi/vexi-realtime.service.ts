import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * Client secret TTL. Short on purpose: the secret only has to survive the SDP
 * handshake, which happens immediately after the fetch. A long-lived secret
 * sitting in browser memory is a bearer token for the provider account.
 */
const CLIENT_SECRET_TTL_SECONDS = 60;

interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface RealtimeSessionGrant {
  client_secret: string;
  expires_at: number;
  model: string;
  voice: string;
  base_url: string;
  tools: RealtimeToolDefinition[];
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
    const config = await this.resolveAudioConfig();
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

    const response = await fetch(`${baseUrl}${CLIENT_SECRETS_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // Ties provider-side abuse signals to our user without leaking the id.
        'OpenAI-Safety-Identifier': this.safetyIdentifier(),
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
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
        `Realtime client secret request failed (${response.status}): ${detail.slice(0, 300)}`,
      );
      throw new VendixHttpException(
        ErrorCodes.AI_PROVIDER_001,
        'Realtime provider rejected the session request',
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
        payload.expires_at ??
        Math.floor(Date.now() / 1000) + CLIENT_SECRET_TTL_SECONDS,
      model,
      voice,
      base_url: baseUrl,
      tools,
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
    if (!this.toolRegistry.isReadOnly(name)) {
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
   * Voice runs on whichever `ai_engine_configs` row is registered with
   * `model_type = 'audio'`, so super-admins provision it through the existing
   * AI configuration surface instead of a parallel env-only channel.
   */
  private async resolveAudioConfig() {
    return this.prisma.ai_engine_configs.findFirst({
      where: { model_type: 'audio', is_active: true },
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
    });
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
    return this.toolRegistry
      .getReadOnlyDefinitions(scope)
      .map((d) => ({
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
