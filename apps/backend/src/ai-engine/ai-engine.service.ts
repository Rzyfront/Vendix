import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AgentTraceService,
  hashTraceValue,
} from './observability/agent-trace.service';
import { ProviderAttemptObserver } from './provider-attempt-observer';
import {
  canonicalAgentTools,
  reportedAgentUsage,
  validateAgentToolCalls,
} from './providers/agent-stream-contract';
import { applyAgentContextBudget } from './context/agent-context-budget';
import {
  objectiveProviderMeter,
  objectiveMeteredFetch,
} from './tasks/agent-budget-context';
import { randomUUID } from 'crypto';
import {
  AgentDeadline,
  createAgentOperation,
  agentDeadlineStream,
  agentAbortFailure,
  isAgentAbort,
} from './tasks/agent-deadline';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import {
  AIProvider,
  AIProviderConfig,
  AIBackgroundUsageRecord,
  AIMessage,
  AIRequestOptions,
  AIResponse,
  AIStreamChunk,
  AIImageRequestOptions,
  AIImageResponse,
  AIImageStreamChunk,
  AIEmbeddingResponse,
  AIVideoRequestOptions,
  AIVideoResponse,
  AISpeechRequestOptions,
  AISpeechResponse,
  AITranscriptionRequestOptions,
  AITranscriptionResponse,
  AIRerankRequestOptions,
  AIRerankResponse,
  AIModelType,
} from './interfaces/ai-provider.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { AnthropicCompatibleProvider } from './providers/anthropic-compatible.provider';
import { MinimaxSpeechProvider } from './providers/minimax-speech.provider';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AILoggingService } from './ai-logging.service';
import { RequestContextService } from '../common/context/request-context.service';
import { SubscriptionAccessService } from '../domains/store/subscriptions/services/subscription-access.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';
import {
  AIFeatureKey,
  isAIFeatureKey,
} from '../domains/store/subscriptions/types/access.types';

/**
 * Reads the provider prompt-cache counters off a usage object. Providers that
 * do not report them (OpenAI-compatible, image) yield 0 so the log columns
 * stay count-only.
 */
export function extractCacheTokens(usage: object | undefined): {
  cache_read_tokens: number;
  cache_creation_tokens: number;
} {
  const u = usage as
    | { cacheReadTokens?: number; cacheCreationTokens?: number }
    | undefined;
  return {
    cache_read_tokens: u?.cacheReadTokens ?? 0,
    cache_creation_tokens: u?.cacheCreationTokens ?? 0,
  };
}

@Injectable()
export class AIEngineService implements OnModuleInit {
  private readonly logger = new Logger(AIEngineService.name);
  private providers: Map<number, AIProvider> = new Map();
  private configSettings: Map<number, Record<string, any>> = new Map();
  private configModelTypes: Map<number, AIModelType> = new Map();
  private defaultConfigId: number | null = null;
  private readonly configFingerprints = new Map<number, string>();
  private readonly providerObserver?: ProviderAttemptObserver;
  /** Runtime evidence overrides a configured capability until configurations reload. */
  private readonly degradedAgentStreamConfigs = new Set<number>();

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly aiLoggingService: AILoggingService,
    private readonly eventEmitter: EventEmitter2,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly gateConfig: SubscriptionGateConfig,
    @Optional() private readonly trace?: AgentTraceService,
  ) {
    if (trace)
      this.providerObserver = new ProviderAttemptObserver(
        trace,
        aiLoggingService,
      );
  }

  async onModuleInit() {
    await this.loadConfigurations();
  }

  private async loadConfigurations() {
    this.degradedAgentStreamConfigs.clear();
    this.providers.clear();
    this.configSettings.clear();
    this.configModelTypes.clear();
    this.configFingerprints.clear();
    this.defaultConfigId = null;

    try {
      const configs = await this.prisma.ai_engine_configs.findMany({
        where: { is_active: true },
      });

      for (const config of configs) {
        this.initializeProvider(config);
        const configModelType =
          config.model_type && this.isAIModelType(config.model_type)
            ? (config.model_type as AIModelType)
            : this.getModelTypeFromSettings(
                (config.settings as Record<string, any>) || {},
              );
        this.configModelTypes.set(config.id, configModelType);
        if (config.is_default) {
          this.defaultConfigId = config.id;
        }
      }

      this.logger.log(`AI Engine loaded ${configs.length} provider(s)`);
      if (!this.defaultConfigId && configs.length > 0) {
        this.logger.warn('No default AI provider configured');
      }
      if (configs.length === 0) {
        this.logger.warn(
          'No AI providers configured. Use superadmin panel to add configurations.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to load AI configurations', error);
    }
  }

  /**
   * Registers a provider for a configuration.
   *
   * Returns `null` on success, or a message explaining why no provider could be
   * built. The load-time loop ignores the value — it already logs — but
   * `testProvider` needs it: without a reason it reported every construction
   * failure as `Unknown sdk_type`, which is wrong for the most common one. A
   * configuration with no API key cannot even construct `OpenAICompatibleProvider`
   * (the OpenAI SDK throws on an empty key), so the operator was told the sdk
   * type was unrecognised while the type was fine and the secret was missing.
   */
  private initializeProvider(config: any): string | null {
    const providerConfig: AIProviderConfig = {
      provider: config.provider,
      sdkType: config.sdk_type,
      apiKey: this.resolveApiKey(config),
      modelId: config.model_id,
      baseUrl: config.base_url || undefined,
      modelType: config.model_type || undefined,
      settings: config.settings as Record<string, any>,
      fetch: objectiveMeteredFetch(
        this.providerObserver
          ? this.providerObserver.wrapFetch(globalThis.fetch)
          : globalThis.fetch,
      ),
      ...(this.providerObserver && {
        observeUsage: (usage) => this.providerObserver!.observeUsage(usage),
      }),
      recordBackgroundUsage: (record) =>
        this.logBackgroundUsage(config.id, config.settings, record),
    };

    try {
      let provider: AIProvider;
      switch (config.sdk_type) {
        case 'openai_compatible':
          provider = new OpenAICompatibleProvider(providerConfig);
          break;
        case 'anthropic_compatible':
          provider = new AnthropicCompatibleProvider(providerConfig);
          break;
        case 'minimax_t2a':
          provider = new MinimaxSpeechProvider(providerConfig);
          break;
        default: {
          const unknown = `Unknown sdk_type: ${config.sdk_type} for provider ${config.provider}`;
          this.logger.warn(unknown);
          return unknown;
        }
      }

      this.providers.set(config.id, provider);
      this.configFingerprints.set(
        config.id,
        hashTraceValue({
          provider: config.provider,
          sdk_type: config.sdk_type,
          model_id: config.model_id,
          base_url: config.base_url,
          settings: config.settings,
        }),
      );
      this.configSettings.set(
        config.id,
        (config.settings as Record<string, any>) || {},
      );
      return null;
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize provider "${config.provider}" (${config.sdk_type}): ${error.message}`,
      );
      return this.describeInitFailure(config, error);
    }
  }

  /**
   * Names the cause of a construction failure in terms the operator can act on.
   *
   * An absent key is checked first because it is both the most common cause and
   * the one whose native error is least useful: the OpenAI SDK reports a missing
   * `OPENAI_API_KEY` environment variable, which is not where Vendix stores it.
   */
  private describeInitFailure(config: any, error: any): string {
    if (!this.resolveApiKey(config)) {
      return this.missingApiKeyMessage(config);
    }

    return error?.message || 'Provider initialization failed';
  }

  private resolveApiKey(config: any): string {
    if (config.api_key_ref) return config.api_key_ref;
    const envKey = `AI_${config.provider.toUpperCase().replace(/\s+/g, '_')}_API_KEY`;
    return process.env[envKey] || this.configService.get<string>(envKey) || '';
  }

  private getDefaultProvider(): AIProvider {
    if (!this.defaultConfigId) {
      throw new VendixHttpException(ErrorCodes.AI_PROVIDER_002);
    }
    const provider = this.providers.get(this.defaultConfigId);
    if (!provider) {
      throw new VendixHttpException(ErrorCodes.AI_PROVIDER_002);
    }
    return provider;
  }

  /**
   * Resolves the provider for an application that ships without an explicit
   * `config_id`.
   *
   * Most seeded applications have `config_id = null`, and only a text
   * configuration may be set as the global default (`AI_CONFIG_003`). A
   * non-text application (image, speech, video, …) would therefore resolve to
   * the text default when present, or fail with `AI_PROVIDER_002` when absent
   * — even if an active configuration of its own `model_type` exists. This
   * preference order mirrors the seed's `linkImageAppsWhenAvailable`:
   *
   *   1. explicit `app.config_id`
   *   2. first active configuration matching the app `model_type`
   *   3. the global default configuration
   *   4. `AI_PROVIDER_002`
   */
  private resolveProviderForApp(app: {
    config_id: number | null;
    model_type: string | null;
  }): { provider: AIProvider; configId: number | null } {
    if (app.config_id) {
      const provider = this.providers.get(app.config_id);
      if (provider) {
        return { provider, configId: app.config_id };
      }
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    const appModelType =
      app.model_type && this.isAIModelType(app.model_type)
        ? (app.model_type as AIModelType)
        : null;

    if (appModelType) {
      for (const [configId, configModelType] of this.configModelTypes) {
        if (configModelType === appModelType) {
          const provider = this.providers.get(configId);
          if (provider) {
            return { provider, configId };
          }
        }
      }
    }

    const defaultProvider = this.getDefaultProvider();
    return { provider: defaultProvider, configId: this.defaultConfigId };
  }

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const provider = this.getDefaultProvider();
    const response = await this.observeProviderCall(undefined, () =>
      this.withProviderDeadline(options, (scoped) =>
        this.observeProviderAttempt(
          this.defaultConfigId,
          messages,
          scoped,
          () => provider.chat(messages, scoped),
        ),
      ),
    );
    if (!response.success) {
      this.logger.error(
        `AI chat failed: ${this.safeProviderError(response.error)}`,
      );
    }
    const thinking =
      options?.thinking ?? this.isThinkingEnabled(this.defaultConfigId);
    return this.sanitizeResponse(response, thinking);
  }

  async complete(
    prompt: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const provider = this.getDefaultProvider();
    const response = await this.observeProviderCall(undefined, () =>
      this.withProviderDeadline(options, (scoped) =>
        this.observeProviderAttempt(
          this.defaultConfigId,
          [{ role: 'user', content: prompt }],
          scoped,
          () => provider.complete(prompt, scoped),
        ),
      ),
    );
    if (!response.success) {
      this.logger.error(
        `AI complete failed: ${this.safeProviderError(response.error)}`,
      );
    }
    const thinking =
      options?.thinking ?? this.isThinkingEnabled(this.defaultConfigId);
    return this.sanitizeResponse(response, thinking);
  }

  async chatWith(
    configId: number,
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const provider = this.providers.get(configId);
    if (!provider) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }
    const thinking = options?.thinking ?? this.isThinkingEnabled(configId);
    return this.sanitizeResponse(
      await this.observeProviderCall(undefined, () =>
        this.withProviderDeadline(options, (scoped) =>
          this.observeProviderAttempt(configId, messages, scoped, () =>
            provider.chat(messages, scoped),
          ),
        ),
      ),
      thinking,
    );
  }

  async testProvider(
    configId: number,
  ): Promise<{ success: boolean; message: string }> {
    const config = await this.prisma.ai_engine_configs.findUnique({
      where: { id: configId },
    });
    if (!config) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    const result = await this.runProviderTest(configId, config);

    // Recorded for every outcome, including the ones that never reach the
    // provider. A configuration the operator just tested and that failed must
    // not keep showing the green dot of its last successful test.
    await this.prisma.ai_engine_configs.update({
      where: { id: configId },
      data: {
        last_tested_at: new Date(),
        last_test_ok: result.success,
      },
    });

    return result;
  }

  private async runProviderTest(
    configId: number,
    config: any,
  ): Promise<{ success: boolean; message: string }> {
    // Checked before dispatching, not only when construction fails.
    // `OpenAICompatibleProvider` builds fine with an empty key — `generateSpeech`
    // and `transcribeAudio` use raw `fetch`, so the request goes out with an
    // empty `Bearer` and the operator gets the provider's own 401: a paragraph
    // about Authorization headers for a secret that was simply never entered.
    if (!this.resolveApiKey(config)) {
      return { success: false, message: this.missingApiKeyMessage(config) };
    }

    const cached = this.providers.get(configId);
    if (cached) {
      return cached.testConnection();
    }

    // Not loaded — either inactive at boot or newly created. Build it now.
    const failure = this.initializeProvider(config);
    const fresh = this.providers.get(configId);
    if (!fresh) {
      return {
        success: false,
        message: failure || `Unknown sdk_type: ${config.sdk_type}`,
      };
    }

    return fresh.testConnection();
  }

  private missingApiKeyMessage(config: any): string {
    const envKey = `AI_${String(config.provider).toUpperCase().replace(/\s+/g, '_')}_API_KEY`;
    return `This configuration has no API key. Add it to the configuration, or expose ${envKey} in the environment.`;
  }

  async reloadConfigurations(): Promise<void> {
    await this.loadConfigurations();
  }

  isConfigured(): boolean {
    return this.providers.size > 0;
  }

  /**
   * Refuses to scan when the app has no vision model pinned.
   *
   * `run()` falls back to the default provider when `config_id` is NULL, and
   * that path does **not** error: a text-only model happily answers a prompt
   * whose image it never received, returning perfectly-shaped JSON with
   * invented values. For a fiscal scanner — a RUT, a DIAN numbering resolution —
   * an invented value is far worse than a failure: it looks verified and it is
   * not. So the misconfiguration is refused up front with something the operator
   * can act on, instead of a silent hallucination downstream.
   *
   * Only callers that send an image should use this. Text apps legitimately run
   * on the default config.
   */
  async assertVisionModelLinked(appKey: string): Promise<void> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
      select: { config_id: true, is_active: true, name: true },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }
    if (!app.is_active) {
      throw new VendixHttpException(ErrorCodes.AI_APP_003);
    }
    if (app.config_id == null) {
      throw new VendixHttpException(
        ErrorCodes.AI_VISION_001,
        `"${app.name}" no tiene un modelo de visión enlazado. Regístralo en el panel de IA (super-admin → IA → Configuraciones) y vuelve a intentarlo; hasta entonces la lectura por foto no está disponible.`,
      );
    }
    if (!this.providers.get(app.config_id)) {
      throw new VendixHttpException(
        ErrorCodes.AI_CONFIG_001,
        `El modelo enlazado a "${app.name}" no está activo o no cargó. Revísalo en el panel de IA.`,
      );
    }
  }

  // --- Application-level API ---

  /**
   * Application-level call: resolves the app, enforces the subscription gate
   * and rate limit, interpolates the stored prompts and writes an
   * `ai_engine_logs` row. Everything that talks to a provider on a user's
   * behalf must come through here — `chat()`/`chatWith()` skip all three.
   *
   * `optionsOverride` exists so the agent loop can pass `tools`/`tool_choice`
   * per iteration without abandoning the gate. It is merged last, so a caller
   * may also deliberately override the app's temperature or token ceiling.
   */
  async run(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
    optionsOverride?: AIRequestOptions,
  ): Promise<AIResponse> {
    return this.observeProviderCall(appKey, () =>
      this.runApplication(appKey, variables, extraMessages, optionsOverride),
    );
  }

  private async runApplication(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
    optionsOverride?: AIRequestOptions,
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AIResponse = { success: false, error: 'No attempt made' };
    let resolvedConfigId: number | null = null;

    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: appKey },
      });

      if (!app) {
        throw new VendixHttpException(ErrorCodes.AI_APP_001);
      }

      if (!app.is_active) {
        throw new VendixHttpException(ErrorCodes.AI_APP_003);
      }

      // Subscription gate (log-only by default; enforces when AI_GATE_ENFORCE=true).
      await this.runSubscriptionGate(appKey, app.ai_feature_category);

      // Rate limit check
      await this.checkRateLimit(app);

      // Resolve provider
      resolvedConfigId = app.config_id || this.defaultConfigId;
      const provider = app.config_id
        ? this.providers.get(app.config_id)
        : this.getDefaultProvider();

      if (!provider) {
        throw new VendixHttpException(
          app.config_id ? ErrorCodes.AI_CONFIG_001 : ErrorCodes.AI_PROVIDER_002,
        );
      }

      const messages = this.applicationMessages(app, variables, extraMessages);
      const options = this.applicationOptions(app, optionsOverride);

      // Execute with retry
      const retryConfig = app.retry_config as {
        maxRetries?: number;
        delayMs?: number;
      } | null;
      const maxRetries = retryConfig?.maxRetries ?? 0;
      const delayMs = retryConfig?.delayMs ?? 1000;

      let lastResponse: AIResponse = {
        success: false,
        error: 'No attempt made',
      };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastResponse = await this.withProviderDeadline(options, (scoped) =>
          this.observeProviderAttempt(
            resolvedConfigId,
            messages,
            scoped,
            () => provider.chat(messages, scoped),
            attempt + 1,
          ),
        );
        // Cancellation is terminal even when the application's existing retry
        // policy allows another request. Never spend a closing/retry inference.
        if (
          ['AGENT_CANCELLED', 'AGENT_DEADLINE_EXCEEDED'].includes(
            lastResponse.error_code ?? '',
          )
        ) {
          logResponse = lastResponse;
          return lastResponse;
        }

        if (lastResponse.success) {
          // Sanitize thinking blocks based on config setting
          const configId = app.config_id || this.defaultConfigId;
          const thinking = this.isThinkingEnabled(configId);
          lastResponse = this.sanitizeResponse(lastResponse, thinking);

          // Post-process output format
          lastResponse.content = this.formatOutput(
            lastResponse.content || '',
            app.output_format,
          );

          // Subscription quota consumption (best-effort; never throws).
          await this.consumeSubscriptionQuota(
            app.ai_feature_category,
            lastResponse.usage?.totalTokens ??
              (lastResponse.usage?.promptTokens ?? 0) +
                (lastResponse.usage?.completionTokens ?? 0),
            { appKey: app.key ?? appKey, callId },
          );

          logStatus = 'success';
          logResponse = lastResponse;
          return lastResponse;
        }

        if (attempt < maxRetries) {
          this.logger.warn(
            `AI app "${appKey}" attempt ${attempt + 1} failed, retrying in ${delayMs}ms`,
          );
          const wait = () => this.waitForProviderRetry(delayMs, options);
          try {
            if (this.providerObserver)
              await this.providerObserver.retry(delayMs, wait);
            else await wait();
          } catch (error) {
            if (!isAgentAbort(error, options.signal)) throw error;
            logResponse = agentAbortFailure(error, options.signal);
            return logResponse;
          }
        }
      }

      this.logger.error(
        `AI app "${appKey}" failed after ${maxRetries + 1} attempts: ${this.safeProviderError(lastResponse.error)}`,
      );
      logResponse = lastResponse;
      return lastResponse;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;
      const context = RequestContextService.asyncLocalStorage.getStore();
      const configSettings = resolvedConfigId
        ? this.configSettings.get(resolvedConfigId)
        : undefined;

      const cacheTokens = extractCacheTokens(logResponse.usage);
      const costUsd = this.aiLoggingService.calculateCost(
        configSettings,
        logResponse.usage?.promptTokens ?? 0,
        logResponse.usage?.completionTokens ?? 0,
        cacheTokens.cache_read_tokens,
        cacheTokens.cache_creation_tokens,
      );

      this.aiLoggingService.logRequest({
        request_id:
          RequestContextService.asyncLocalStorage.getStore()?.request_id,
        ...this.observedLogFields(logResponse.usage),
        app_key: appKey,
        config_id: resolvedConfigId ?? undefined,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        user_id: context?.user_id,
        model: logResponse.model,
        prompt_tokens: logResponse.usage?.promptTokens ?? 0,
        completion_tokens: logResponse.usage?.completionTokens ?? 0,
        ...cacheTokens,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: logStatus,
        error_message: logStatus === 'error' ? logResponse.error : undefined,
        input_preview: variables ? JSON.stringify(variables) : undefined,
      });

      this.eventEmitter.emit('ai.request.completed', {
        app_key: appKey,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: logStatus,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
      });
    }
  }

  /** Decide the transport before spending a provider request, never after tokens. */
  async supportsAgentStreaming(appKey: string): Promise<boolean> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
    });
    if (!app?.is_active) return false;
    const configId = app.config_id || this.defaultConfigId;
    const provider = configId ? this.providers.get(configId) : undefined;
    return (
      !!configId &&
      !this.degradedAgentStreamConfigs.has(configId) &&
      !!provider?.chatStream &&
      provider.supportsMeteredAgentStream?.() === true
    );
  }

  /** H opt-in agent transport. No buffered fallback and no second quota path. */
  async *runAgentStream(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
    optionsOverride?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk> {
    yield* this.runStream(appKey, variables, extraMessages, {
      ...optionsOverride,
      agenticStream: true,
    });
  }

  async *runStream(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
    optionsOverride?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk> {
    const factory = () =>
      this.runApplicationStream(
        appKey,
        variables,
        extraMessages,
        optionsOverride,
      );
    if (!this.providerObserver || !this.trace) {
      yield* factory();
      return;
    }
    const root = this.trace.currentSpan()
      ? undefined
      : this.startStandaloneTrace();
    let completed = false;
    let failed = false;
    try {
      yield* this.providerObserver.callStream(factory, root, (status) => {
        failed = status === 'error';
      });
      completed = true;
    } catch (error) {
      this.trace.finishTrace(root, 'failed', {
        status: 'error',
        error_code: 'PROVIDER_EXCEPTION',
      });
      throw error;
    } finally {
      this.trace.finishTrace(
        root,
        completed ? (failed ? 'failed' : 'partial') : 'cancelled',
        {
          status: completed ? (failed ? 'error' : 'ok') : 'cancelled',
        },
      );
    }
  }

  private async *runApplicationStream(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
    optionsOverride?: AIRequestOptions,
  ): AsyncGenerator<AIStreamChunk> {
    const agentic = optionsOverride?.agenticStream === true;
    const startTime = Date.now();
    const callId = randomUUID();
    let lastChunk: AIStreamChunk | null = null;
    let resolvedConfigId: number | null = null;
    let deadline: AgentDeadline | undefined;
    let providerDispatched = false;
    let metered = false;
    let terminal = false;
    let quotaConsumed = false;
    let accumulatedContent = '';
    let pendingTerminal: AIStreamChunk | undefined;
    let resultUsage: AIResponse['usage'];
    let contextBudget: AIStreamChunk['context_budget'];
    let tools: AIRequestOptions['tools'];
    let reservedOutputTokens = 0;
    const meter = agentic ? objectiveProviderMeter.getStore() : undefined;
    const recordMeter = async (usage: AIResponse['usage']) => {
      if (!meter || metered || !providerDispatched) return;
      metered = true;
      meter.observed = true;
      await meter.usage(usage, this.agentStreamCost(resolvedConfigId, usage));
    };

    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: appKey },
      });

      if (!app) {
        lastChunk = { type: 'error', error: 'AI application not found' };
        yield lastChunk;
        return;
      }

      if (!app.is_active) {
        lastChunk = { type: 'error', error: 'AI application is disabled' };
        yield lastChunk;
        return;
      }

      // Subscription gate (log-only by default; throws in enforce mode).
      try {
        await this.runSubscriptionGate(appKey, app.ai_feature_category);
      } catch (err: any) {
        lastChunk = {
          type: 'error',
          error: err?.message ?? 'Subscription gate denied',
        };
        yield lastChunk;
        return;
      }

      await this.checkRateLimit(app);

      resolvedConfigId = app.config_id || this.defaultConfigId;
      const provider = app.config_id
        ? this.providers.get(app.config_id)
        : this.getDefaultProvider();

      if (!provider) {
        lastChunk = { type: 'error', error: 'No AI provider configured' };
        yield lastChunk;
        return;
      }

      if (!provider.chatStream) {
        lastChunk = {
          type: 'error',
          error: 'Streaming not supported by this provider',
        };
        yield lastChunk;
        return;
      }

      if (
        agentic &&
        (provider.supportsMeteredAgentStream?.() !== true ||
          (resolvedConfigId !== null &&
            this.degradedAgentStreamConfigs.has(resolvedConfigId)))
      ) {
        lastChunk = {
          type: 'error',
          error:
            'Metered agent streaming is unavailable for this configuration',
          error_code: 'AI_STREAM_UNAVAILABLE',
          usage_state: 'unknown',
        };
        yield lastChunk;
        return;
      }

      let messages = this.applicationMessages(app, variables, extraMessages);
      const options = this.applicationOptions(app, optionsOverride);
      if (agentic) {
        // Account for exactly the base override sent to the SDK, without
        // overriding later runtime/tenant/pending-approval system messages.
        if (options.systemPrompt) {
          const baseIndex = messages.findIndex(
            (message) => message.role === 'system',
          );
          if (baseIndex < 0)
            messages.unshift({ role: 'system', content: options.systemPrompt });
          else
            messages[baseIndex] = {
              ...messages[baseIndex],
              content: options.systemPrompt,
            };
          delete options.systemPrompt;
        }
        options.tools = canonicalAgentTools(options.tools);
        tools = options.tools;
        const settings = resolvedConfigId
          ? this.configSettings.get(resolvedConfigId)
          : undefined;
        const configured =
          settings?.agent_context_window_tokens ??
          settings?.context_window_tokens;
        const contextWindowTokens = configured ?? 32768;
        const maxOutputTokens =
          options.maxTokens ?? settings?.maxTokens ?? 1024;
        options.maxTokens = maxOutputTokens;
        reservedOutputTokens = maxOutputTokens;
        const budget = applyAgentContextBudget(messages, options.tools ?? [], {
          contextWindowTokens,
          maxOutputTokens,
        });
        messages = budget.messages;
        contextBudget = {
          estimated_input_tokens: budget.estimatedInputTokens,
          omitted_messages: budget.omittedMessages,
          context_window_tokens: contextWindowTokens,
          provenance: configured === undefined ? 'fallback' : 'configured',
          method: budget.method,
        };
      }
      // Always own an abortable operation for H, including bare consumer return().
      deadline = createAgentOperation(
        agentic
          ? {
              ...options,
              signal: options.signal ?? new AbortController().signal,
            }
          : options,
      );
      if (deadline) {
        options.signal = deadline.signal;
        options.deadlineMs = deadline.deadlineMs;
      }

      try {
        deadline?.assertCanStart();
        if (agentic) {
          if (meter) await meter.dispatch();
          deadline?.assertCanStart();
          providerDispatched = true;
        }
        const stream =
          this.providerObserver && this.trace?.currentSpan()
            ? this.providerObserver.attemptStream(
                resolvedConfigId
                  ? this.configSettings.get(resolvedConfigId)
                  : undefined,
                this.providerAttributes(resolvedConfigId, messages, options),
                () => provider.chatStream!(messages, options),
              )
            : provider.chatStream(messages, options);
        for await (const chunk of agentDeadlineStream(stream, deadline)) {
          if (agentic) {
            if (pendingTerminal)
              throw new Error('Provider emitted data after a terminal frame');
            // Only a complete terminal batch may become execution candidates.
            if (chunk.type === 'tool_call' || chunk.type === 'tool_result')
              throw new Error(
                'Agent stream provider emitted a non-terminal tool call',
              );
            if (chunk.type === 'text')
              accumulatedContent += chunk.content ?? '';
            if (chunk.type === 'done' || chunk.type === 'error') {
              pendingTerminal = chunk;
              resultUsage = reportedAgentUsage(chunk.usage);
              continue;
            }
          }
          lastChunk = chunk;
          yield chunk;
        }
        if (agentic) {
          if (!pendingTerminal)
            throw new Error('Provider stream ended without a terminal result');
          await recordMeter(resultUsage);
          if (pendingTerminal.type === 'error') {
            lastChunk = {
              ...pendingTerminal,
              usage: resultUsage,
              usage_state: resultUsage ? 'reported' : 'unknown',
            };
            yield lastChunk;
            return;
          }
          if (!resultUsage) {
            if (resolvedConfigId !== null)
              this.degradedAgentStreamConfigs.add(resolvedConfigId);
            throw Object.assign(
              new Error('Provider stream completed without reported usage'),
              {
                code: 'AI_STREAM_USAGE_UNAVAILABLE',
              },
            );
          }
          const completedCalls = validateAgentToolCalls(
            pendingTerminal.tool_calls ?? [],
            tools,
          );
          if (
            (pendingTerminal.finish_reason === 'tool_calls' &&
              !completedCalls.length) ||
            (pendingTerminal.tool_calls?.length &&
              pendingTerminal.finish_reason !== 'tool_calls')
          )
            throw new Error('Incomplete agent tool batch');
          // Complete accounting before exposing done. Closing at this frame
          // cannot turn the inference into a free or cancelled provider attempt.
          await this.consumeSubscriptionQuota(
            app.ai_feature_category,
            resultUsage?.totalTokens ?? 0,
            { appKey: app.key ?? appKey, callId },
          );
          quotaConsumed = true;
          terminal = true;
          const sanitized = this.sanitizeResponse(
            { success: true, content: accumulatedContent },
            this.isThinkingEnabled(resolvedConfigId),
          );
          lastChunk = {
            ...pendingTerminal,
            ...(completedCalls.length && { tool_calls: completedCalls }),
            usage: resultUsage,
            content: this.formatOutput(
              sanitized.content ?? '',
              app.output_format,
            ),
            usage_state: resultUsage ? 'reported' : 'unknown',
            context_budget: contextBudget,
          };
          yield lastChunk;
          return;
        }
      } catch (error: any) {
        lastChunk = {
          type: 'error',
          ...(agentic && {
            error_code:
              deadline && isAgentAbort(error, deadline.signal)
                ? agentAbortFailure(error, deadline.signal).error_code
                : error?.code === 'AI_STREAM_USAGE_UNAVAILABLE'
                  ? error.code
                  : 'AI_STREAM_INVALID',
            usage: resultUsage,
            usage_state: resultUsage
              ? ('reported' as const)
              : ('unknown' as const),
          }),
          error:
            deadline && isAgentAbort(error, deadline.signal)
              ? agentAbortFailure(error, deadline.signal).error
              : error.message,
        };
        yield lastChunk;
      }

      // Consume quota on successful completion.
      if (lastChunk?.type === 'done' && !quotaConsumed) {
        const usage = lastChunk.usage;
        const tokens =
          usage?.totalTokens ??
          (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
        await this.consumeSubscriptionQuota(app.ai_feature_category, tokens, {
          appKey: app.key ?? appKey,
          callId,
        });
      }
    } catch (error: any) {
      if (!agentic) throw error;
      lastChunk = {
        type: 'error',
        error: error?.message ?? 'Agent stream failed',
        error_code: error?.errorCode ?? error?.code ?? 'AI_STREAM_FAILED',
        usage_state: 'unknown',
      };
      yield lastChunk;
    } finally {
      deadline?.dispose();
      try {
        if (agentic) await recordMeter(resultUsage);
      } finally {
        // Log after stream completes — always runs regardless of early returns
        const latencyMs = Date.now() - startTime;
        const context = RequestContextService.asyncLocalStorage.getStore();
        const configSettings = resolvedConfigId
          ? this.configSettings.get(resolvedConfigId)
          : undefined;

        const usage = agentic
          ? resultUsage
          : lastChunk?.type === 'done'
            ? lastChunk.usage
            : undefined;
        const cacheTokens = extractCacheTokens(usage);
        const legacyCostUsd = this.aiLoggingService.calculateCost(
          configSettings,
          usage?.promptTokens ?? 0,
          usage?.completionTokens ?? 0,
          cacheTokens.cache_read_tokens,
          cacheTokens.cache_creation_tokens,
        );

        const costUsd = agentic
          ? this.agentStreamCost(resolvedConfigId, usage)
          : legacyCostUsd;
        const pricing = configSettings?.pricing;
        const knownRate = (value: unknown): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0;
        const estimatedCostMicrousd =
          agentic &&
          providerDispatched &&
          !usage &&
          contextBudget &&
          knownRate(pricing?.input_per_1k) &&
          knownRate(pricing?.output_per_1k)
            ? Math.ceil(
                ((contextBudget.estimated_input_tokens * pricing.input_per_1k +
                  reservedOutputTokens * pricing.output_per_1k) /
                  1000) *
                  1_000_000,
              )
            : null;
        const status = agentic
          ? terminal
            ? 'success'
            : 'error'
          : lastChunk?.type === 'error'
            ? 'error'
            : 'success';
        this.aiLoggingService.logRequest({
          request_id:
            RequestContextService.asyncLocalStorage.getStore()?.request_id,
          ...this.observedLogFields(usage),
          app_key: appKey,
          config_id: resolvedConfigId ?? undefined,
          organization_id: context?.organization_id,
          store_id: context?.store_id,
          user_id: context?.user_id,
          model: agentic ? lastChunk?.model : undefined,
          prompt_tokens: usage?.promptTokens ?? 0,
          completion_tokens: usage?.completionTokens ?? 0,
          ...cacheTokens,
          cost_usd: costUsd ?? 0,
          latency_ms: latencyMs,
          status,
          error_message:
            lastChunk?.type === 'error'
              ? lastChunk.error
              : agentic && !terminal
                ? 'Agent stream cancelled'
                : undefined,
          input_preview: variables ? JSON.stringify(variables) : undefined,
          ...(agentic && {
            cost_source: 'logical_summary' as const,
            usage_observed: {
              prompt_tokens: usage?.promptTokens ?? null,
              completion_tokens: usage?.completionTokens ?? null,
              cache_read_tokens: usage?.cacheReadTokens ?? null,
              cache_creation_tokens: usage?.cacheCreationTokens ?? null,
            },
            telemetry_metadata: {
              streaming: true,
              usage_known: usage !== undefined,
              usage_source: usage ? 'provider' : 'unknown',
              billable: usage ? 'reported_usage' : 'unknown',
              context_tokens: contextBudget?.estimated_input_tokens ?? null,
              context_window_tokens:
                contextBudget?.context_window_tokens ?? null,
              context_budget_source: contextBudget?.provenance ?? null,
              omitted_messages: contextBudget?.omitted_messages ?? null,
              estimated_output_tokens: reservedOutputTokens,
              estimation_method: 'conservative_estimate',
              estimated_cost_microusd: estimatedCostMicrousd,
              cost_measurement:
                costUsd !== null
                  ? 'reported'
                  : estimatedCostMicrousd !== null
                    ? 'estimated'
                    : 'unknown',
              catalog_hash: hashTraceValue(tools ?? []),
              catalog_version: '1.1',
            },
          }),
        });
        if (agentic)
          this.eventEmitter.emit('ai.request.completed', {
            app_key: appKey,
            cost_usd: costUsd,
            latency_ms: latencyMs,
            status,
            organization_id: context?.organization_id,
            store_id: context?.store_id,
            usage_state: usage ? 'reported' : 'unknown',
          });
      }
    }
  }

  async runImage(
    appKey: string,
    variables?: Record<string, string>,
    imageOptions?: AIImageRequestOptions,
  ): Promise<AIImageResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AIImageResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;

    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: appKey },
      });

      if (!app) {
        throw new VendixHttpException(ErrorCodes.AI_APP_001);
      }

      if (!app.is_active) {
        throw new VendixHttpException(ErrorCodes.AI_APP_003);
      }

      await this.runSubscriptionGate(appKey, app.ai_feature_category);
      await this.checkRateLimit(app);

      const { provider, configId } = this.resolveProviderForApp(app);
      resolvedConfigId = configId;

      if (!provider.generateImage) {
        logResponse = {
          success: false,
          error: 'Image generation not supported by this provider',
        };
        return logResponse;
      }

      const prompt = this.buildImagePrompt(app, variables);
      const response = await provider.generateImage(
        prompt,
        this.buildImageOptions(app, imageOptions),
      );

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(app.ai_feature_category, 1, {
          appKey: app.key ?? appKey,
          callId,
        });
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;
      const context = RequestContextService.asyncLocalStorage.getStore();
      const configSettings = resolvedConfigId
        ? this.configSettings.get(resolvedConfigId)
        : undefined;

      const cacheTokens = extractCacheTokens(logResponse.usage);
      const costUsd = this.aiLoggingService.calculateCost(
        configSettings,
        logResponse.usage?.promptTokens ?? 0,
        logResponse.usage?.completionTokens ?? 0,
        cacheTokens.cache_read_tokens,
        cacheTokens.cache_creation_tokens,
      );

      this.aiLoggingService.logRequest({
        request_id:
          RequestContextService.asyncLocalStorage.getStore()?.request_id,
        ...this.observedLogFields(logResponse.usage),
        app_key: appKey,
        config_id: resolvedConfigId ?? undefined,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        user_id: context?.user_id,
        model: logResponse.model,
        prompt_tokens: logResponse.usage?.promptTokens ?? 0,
        completion_tokens: logResponse.usage?.completionTokens ?? 0,
        ...cacheTokens,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: logStatus,
        error_message: logStatus === 'error' ? logResponse.error : undefined,
        input_preview: variables ? JSON.stringify(variables) : undefined,
      });

      this.eventEmitter.emit('ai.request.completed', {
        app_key: appKey,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: logStatus,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
      });
    }
  }

  async *runImageStream(
    appKey: string,
    variables?: Record<string, string>,
    imageOptions?: AIImageRequestOptions,
  ): AsyncGenerator<AIImageStreamChunk> {
    const startTime = Date.now();
    const callId = randomUUID();
    let lastChunk: AIImageStreamChunk | null = null;
    let completedChunk: AIImageStreamChunk | null = null;
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: appKey },
      });

      if (!app) {
        lastChunk = { type: 'error', error: 'AI application not found' };
        yield lastChunk;
        return;
      }

      if (!app.is_active) {
        lastChunk = { type: 'error', error: 'AI application is disabled' };
        yield lastChunk;
        return;
      }

      featureCategory = app.ai_feature_category;

      try {
        await this.runSubscriptionGate(appKey, app.ai_feature_category);
      } catch (err: any) {
        lastChunk = {
          type: 'error',
          error: err?.message ?? 'Subscription gate denied',
        };
        yield lastChunk;
        return;
      }

      await this.checkRateLimit(app);

      const resolved = this.resolveProviderForApp(app);
      resolvedConfigId = resolved.configId;
      const provider = resolved.provider;
      if (!provider.generateImage) {
        lastChunk = {
          type: 'error',
          error: 'Image generation not supported by this provider',
        };
        yield lastChunk;
        return;
      }

      const prompt = this.buildImagePrompt(app, variables);
      const options = this.buildImageOptions(app, imageOptions);

      if (provider.generateImageStream) {
        for await (const chunk of provider.generateImageStream(
          prompt,
          options,
        )) {
          lastChunk = chunk;
          if (chunk.type === 'completed') {
            completedChunk = chunk;
          }
          yield chunk;
          if (chunk.type === 'error') return;
        }
      } else if (provider.generateImage) {
        yield {
          type: 'progress',
          message: 'Generando imagen',
          model: options.model,
        };
        const response = await provider.generateImage(prompt, options);
        if (!response.success || !response.imageBase64) {
          lastChunk = {
            type: 'error',
            error: response.error || 'Image model did not return data',
          };
          yield lastChunk;
          return;
        }
        completedChunk = {
          type: 'completed',
          imageBase64: response.imageBase64,
          usage: response.usage,
          model: response.model,
          revisedPrompt: response.revisedPrompt,
        };
        lastChunk = completedChunk;
        yield completedChunk;
        lastChunk = {
          type: 'done',
          usage: response.usage,
          model: response.model,
        };
        yield lastChunk;
      } else {
        lastChunk = {
          type: 'error',
          error: 'Image generation not supported by this provider',
        };
        yield lastChunk;
        return;
      }

      if (completedChunk) {
        await this.consumeSubscriptionQuota(app.ai_feature_category, 1, {
          appKey: app.key ?? appKey,
          callId,
        });
      }
    } catch (error: any) {
      lastChunk = { type: 'error', error: error.message };
      yield lastChunk;
    } finally {
      const latencyMs = Date.now() - startTime;
      const context = RequestContextService.asyncLocalStorage.getStore();
      const configSettings = resolvedConfigId
        ? this.configSettings.get(resolvedConfigId)
        : undefined;

      const usage = completedChunk?.usage;
      const cacheTokens = extractCacheTokens(usage);
      const costUsd = this.aiLoggingService.calculateCost(
        configSettings,
        usage?.promptTokens ?? 0,
        usage?.completionTokens ?? 0,
        cacheTokens.cache_read_tokens,
        cacheTokens.cache_creation_tokens,
      );

      this.aiLoggingService.logRequest({
        request_id:
          RequestContextService.asyncLocalStorage.getStore()?.request_id,
        ...this.observedLogFields(usage),
        app_key: appKey,
        config_id: resolvedConfigId ?? undefined,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        user_id: context?.user_id,
        model: completedChunk?.model,
        prompt_tokens: usage?.promptTokens ?? 0,
        completion_tokens: usage?.completionTokens ?? 0,
        ...cacheTokens,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: lastChunk?.type === 'error' ? 'error' : 'success',
        error_message:
          lastChunk?.type === 'error' ? lastChunk.error : undefined,
        input_preview: variables ? JSON.stringify(variables) : undefined,
      });

      this.eventEmitter.emit('ai.request.completed', {
        app_key: appKey,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: lastChunk?.type === 'error' ? 'error' : 'success',
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        feature_category: featureCategory,
      });
    }
  }

  async getApplicationModelType(appKey: string): Promise<AIModelType> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
      select: { config_id: true, model_type: true },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    // 1) Prefer the explicit model_type on the application row.
    if (app.model_type && this.isAIModelType(app.model_type)) {
      return app.model_type;
    }

    // 2) Fall back to the assigned/default config's model_type.
    const configId = app.config_id || this.defaultConfigId;

    if (configId) {
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: configId },
        select: { model_type: true, settings: true },
      });

      if (config?.model_type && this.isAIModelType(config.model_type)) {
        return config.model_type;
      }

      // 3) Legacy fallback: heuristic over the config's settings JSON.
      if (config) {
        return this.getModelTypeFromSettings(
          (config.settings as Record<string, any>) || {},
        );
      }
    }

    // 4) Legacy in-memory cache fallback (covers config rows still in cache).
    const cachedSettings = configId
      ? this.configSettings.get(configId)
      : undefined;

    if (cachedSettings) {
      return this.getModelTypeFromSettings(cachedSettings);
    }

    return 'text';
  }

  async getApplicationExecutionType(appKey: string): Promise<AIModelType> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
      select: { output_format: true, model_type: true },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    const appModelType =
      app.model_type && this.isAIModelType(app.model_type)
        ? app.model_type
        : await this.getApplicationModelType(appKey);

    return this.resolveExecutionType(app.output_format, appModelType);
  }

  async runByApplicationType(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
  ): Promise<
    | AIResponse
    | AIImageResponse
    | AIEmbeddingResponse
    | AIVideoResponse
    | AISpeechResponse
    | AITranscriptionResponse
    | AIRerankResponse
  > {
    const executionType = await this.getApplicationExecutionType(appKey);

    switch (executionType) {
      case 'image':
        return this.runImage(appKey, variables);
      case 'embedding':
        return this.runEmbedding(appKey, variables);
      case 'audio':
        return this.run(appKey, variables, extraMessages);
      case 'video':
        return this.runVideo(appKey, variables);
      case 'speech':
        return this.runSpeech(appKey, variables);
      case 'transcription':
        throw new VendixHttpException(
          ErrorCodes.AI_REQUEST_001,
          'Transcription applications require audio input; use runTranscription().',
        );
      case 'rerank':
        return this.runRerank(appKey, variables);
      case 'text':
      default:
        return this.run(appKey, variables, extraMessages);
    }
  }

  async runEmbedding(
    appKey: string,
    variables?: Record<string, string>,
    input?: string | string[],
  ): Promise<AIEmbeddingResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AIEmbeddingResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const { app, provider, configId } =
        await this.resolveApplicationExecution(appKey);
      resolvedConfigId = configId;
      featureCategory = app.ai_feature_category;

      if (!provider.generateEmbedding) {
        logResponse = {
          success: false,
          error: 'Embeddings not supported by this provider',
        };
        return logResponse;
      }

      const response = await provider.generateEmbedding(
        input || this.buildApplicationPrompt(app, variables),
      );

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(
          app.ai_feature_category,
          response.usage?.totalTokens ?? 1,
          { appKey: app.key ?? appKey, callId },
        );
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      this.logApplicationRequest({
        appKey,
        configId: resolvedConfigId,
        response: logResponse,
        status: logStatus,
        startTime,
        variables,
        featureCategory,
      });
    }
  }

  async runVideo(
    appKey: string,
    variables?: Record<string, string>,
    videoOptions?: AIVideoRequestOptions,
  ): Promise<AIVideoResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AIVideoResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const { app, provider, configId } =
        await this.resolveApplicationExecution(appKey);
      resolvedConfigId = configId;
      featureCategory = app.ai_feature_category;

      if (!provider.generateVideo) {
        logResponse = {
          success: false,
          error: 'Video generation not supported by this provider',
        };
        return logResponse;
      }

      const response = await provider.generateVideo(
        this.buildApplicationPrompt(app, variables),
        this.buildVideoOptions(app, videoOptions),
      );

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(app.ai_feature_category, 1, {
          appKey: app.key ?? appKey,
          callId,
        });
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      this.logApplicationRequest({
        appKey,
        configId: resolvedConfigId,
        response: logResponse,
        status: logStatus,
        startTime,
        variables,
        featureCategory,
      });
    }
  }

  async runSpeech(
    appKey: string,
    variables?: Record<string, string>,
    speechOptions?: AISpeechRequestOptions,
  ): Promise<AISpeechResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AISpeechResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const { app, provider, configId } =
        await this.resolveApplicationExecution(appKey);
      resolvedConfigId = configId;
      featureCategory = app.ai_feature_category;

      if (!provider.generateSpeech) {
        logResponse = {
          success: false,
          error: 'Speech generation not supported by this provider',
        };
        return logResponse;
      }

      const response = await provider.generateSpeech(
        this.buildApplicationPrompt(app, variables),
        this.buildSpeechOptions(app, speechOptions),
      );

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(app.ai_feature_category, 1, {
          appKey: app.key ?? appKey,
          callId,
        });
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      this.logApplicationRequest({
        appKey,
        configId: resolvedConfigId,
        response: logResponse,
        status: logStatus,
        startTime,
        variables,
        featureCategory,
      });
    }
  }

  async runTranscription(
    appKey: string,
    options: AITranscriptionRequestOptions,
    variables?: Record<string, string>,
  ): Promise<AITranscriptionResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AITranscriptionResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const { app, provider, configId } =
        await this.resolveApplicationExecution(appKey);
      resolvedConfigId = configId;
      featureCategory = app.ai_feature_category;

      if (!provider.transcribeAudio) {
        logResponse = {
          success: false,
          error: 'Audio transcription not supported by this provider',
        };
        return logResponse;
      }

      const response = await provider.transcribeAudio(options);

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(
          app.ai_feature_category,
          response.usage?.totalTokens ?? 1,
          { appKey: app.key ?? appKey, callId },
        );
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      this.logApplicationRequest({
        appKey,
        configId: resolvedConfigId,
        response: logResponse,
        status: logStatus,
        startTime,
        variables,
        featureCategory,
      });
    }
  }

  async runRerank(
    appKey: string,
    variables?: Record<string, string>,
    rerankOptions?: Partial<AIRerankRequestOptions>,
  ): Promise<AIRerankResponse> {
    const startTime = Date.now();
    const callId = randomUUID();
    let logStatus: 'success' | 'error' = 'error';
    let logResponse: AIRerankResponse = {
      success: false,
      error: 'No attempt made',
    };
    let resolvedConfigId: number | null = null;
    let featureCategory: string | null = null;

    try {
      const { app, provider, configId } =
        await this.resolveApplicationExecution(appKey);
      resolvedConfigId = configId;
      featureCategory = app.ai_feature_category;

      if (!provider.rerank) {
        logResponse = {
          success: false,
          error: 'Rerank not supported by this provider',
        };
        return logResponse;
      }

      const response = await provider.rerank(
        this.buildRerankOptions(app, variables, rerankOptions),
      );

      logResponse = response;
      if (response.success) {
        logStatus = 'success';
        await this.consumeSubscriptionQuota(app.ai_feature_category, 1, {
          appKey: app.key ?? appKey,
          callId,
        });
      }

      return response;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      this.logApplicationRequest({
        appKey,
        configId: resolvedConfigId,
        response: logResponse,
        status: logStatus,
        startTime,
        variables,
        featureCategory,
      });
    }
  }

  async getApplication(appKey: string) {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
      include: {
        config: {
          select: { id: true, label: true, provider: true, model_id: true },
        },
      },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    return app;
  }

  private applicationMessages(
    app: any,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
  ): AIMessage[] {
    return [
      ...(app.system_prompt
        ? [
            {
              role: 'system' as const,
              content: this.interpolate(app.system_prompt, variables),
            },
          ]
        : []),
      ...(app.prompt_template
        ? [
            {
              role: 'user' as const,
              content: this.interpolate(app.prompt_template, variables),
            },
          ]
        : []),
      ...(extraMessages ?? []),
    ];
  }

  private applicationOptions(
    app: any,
    override?: AIRequestOptions,
  ): AIRequestOptions {
    return {
      ...(app.temperature !== null
        ? { temperature: Number(app.temperature) }
        : {}),
      ...(app.max_tokens !== null ? { maxTokens: app.max_tokens } : {}),
      ...override,
    };
  }

  /** Missing pricing or cache counters are unknown, never a fictitious free call. */
  private agentStreamCost(
    configId: number | null,
    usage: AIResponse['usage'],
  ): number | null {
    if (!usage) return null;
    const settings = configId ? this.configSettings.get(configId) : undefined;
    const pricing = settings?.pricing;
    const valid = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (
      !pricing ||
      !valid(usage.promptTokens) ||
      !valid(usage.completionTokens) ||
      (usage.promptTokens > 0 && !valid(pricing.input_per_1k)) ||
      (usage.completionTokens > 0 && !valid(pricing.output_per_1k)) ||
      ((usage.cacheReadTokens ?? 0) > 0 && !valid(pricing.cache_read_per_1k)) ||
      ((usage.cacheCreationTokens ?? 0) > 0 &&
        !valid(pricing.cache_creation_per_1k)) ||
      (pricing.cache_read_per_1k !== undefined &&
        usage.cacheReadTokens === undefined) ||
      (pricing.cache_creation_per_1k !== undefined &&
        usage.cacheCreationTokens === undefined)
    )
      return null;
    return this.aiLoggingService.calculateCost(
      settings,
      usage.promptTokens,
      usage.completionTokens,
      usage.cacheReadTokens ?? 0,
      usage.cacheCreationTokens ?? 0,
    );
  }

  private safeProviderError(error: string | undefined): string | undefined {
    return 'PROVIDER_ERROR';
  }

  private async observeProviderCall(
    appKey: string | undefined,
    callback: () => Promise<AIResponse>,
  ): Promise<AIResponse> {
    if (!this.providerObserver || !this.trace) return callback();
    if (this.trace.currentSpan()) {
      return this.providerObserver.call(
        { call_reason: appKey ? 'application' : 'direct' },
        callback,
      );
    }
    const root = this.startStandaloneTrace();
    if (!root) return callback();
    try {
      const result = await this.trace.run(root, () =>
        this.providerObserver!.call(
          { call_reason: appKey ? 'application' : 'direct' },
          callback,
        ),
      );
      if (!result.success)
        this.trace.finishTrace(root, 'failed', { status: 'error' });
      return result;
    } catch (error) {
      this.trace.finishTrace(root, 'failed', {
        status: 'error',
        error_code: 'PROVIDER_EXCEPTION',
      });
      throw error;
    } finally {
      // An inference is not proof of a completed business task.
      this.trace.finishTrace(root, 'partial');
    }
  }

  private async withProviderDeadline(
    options: AIRequestOptions | undefined,
    callback: (scoped: AIRequestOptions | undefined) => Promise<AIResponse>,
  ): Promise<AIResponse> {
    const deadline = createAgentOperation(options);
    if (!deadline) return callback(options);
    try {
      const scoped = {
        ...options,
        signal: deadline.signal,
        deadlineMs: deadline.deadlineMs,
      };
      return await deadline.run(() => callback(scoped));
    } catch (error) {
      if (!isAgentAbort(error, deadline.signal)) throw error;
      return agentAbortFailure(error, deadline.signal);
    } finally {
      deadline.dispose();
    }
  }

  private async waitForProviderRetry(
    delayMs: number,
    options: AIRequestOptions,
  ): Promise<void> {
    const deadline = createAgentOperation(options);
    if (!deadline)
      return new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      // A backoff that fills the entire remaining budget cannot lead to work.
      deadline.assertCanStart(delayMs + 1);
      await deadline.run(
        () =>
          new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(deadline.signal.reason);
            };
            const timer = setTimeout(() => {
              deadline.signal.removeEventListener('abort', abort);
              resolve();
            }, delayMs);
            deadline.signal.addEventListener('abort', abort, { once: true });
            if (deadline.signal.aborted) abort();
          }),
      );
    } finally {
      deadline.dispose();
    }
  }

  private async observeProviderAttempt(
    configId: number | null,
    messages: AIMessage[],
    options: AIRequestOptions | undefined,
    callback: () => Promise<AIResponse>,
    dispatchNumber = 1,
  ): Promise<AIResponse> {
    const execute = () =>
      !this.providerObserver || !this.trace?.currentSpan()
        ? callback()
        : this.providerObserver.attempt(
            configId ? this.configSettings.get(configId) : undefined,
            {
              ...this.providerAttributes(configId, messages, options),
              dispatch_number: dispatchNumber,
            },
            callback,
          );
    if (options?.signal?.aborted)
      return agentAbortFailure(undefined, options.signal);
    const meter = objectiveProviderMeter.getStore();
    if (meter) await meter.dispatch();
    if (options?.signal?.aborted)
      return agentAbortFailure(undefined, options.signal);
    const response = await execute();
    if (options?.signal?.aborted)
      return agentAbortFailure(undefined, options.signal);
    if (meter) {
      meter.observed = true;
      const usage = response.usage;
      const settings = configId ? this.configSettings.get(configId) : undefined;
      await meter.usage(
        usage,
        usage && settings?.pricing
          ? this.aiLoggingService.calculateCost(
              settings,
              usage.promptTokens,
              usage.completionTokens,
              usage.cacheReadTokens,
              usage.cacheCreationTokens,
            )
          : null,
      );
    }
    return response;
  }

  private providerAttributes(
    configId: number | null,
    messages: AIMessage[],
    options?: AIRequestOptions,
  ) {
    const tools = options?.tools ?? [];
    return {
      config_hash: configId
        ? (this.configFingerprints.get(configId) ??
          hashTraceValue({
            config_id: configId,
            settings: this.configSettings.get(configId),
          }))
        : null,
      prompt_hash: hashTraceValue(messages),
      options_hash: hashTraceValue(options ?? {}),
      catalog_hash: hashTraceValue(tools),
      tool_count: tools.length,
      catalog_version: options?.agenticStream ? '1.1' : '1',
      definition_tokens: null,
      context_tokens: null,
    };
  }

  private startStandaloneTrace() {
    // Never borrow a tenant from the historical static RequestContext fallback.
    const context = RequestContextService.asyncLocalStorage.getStore();
    return context?.organization_id && context.store_id
      ? this.trace?.startTrace({
          kind: 'tenant',
          organization_id: context.organization_id,
          store_id: context.store_id,
          user_id: context.user_id,
          request_id: context.request_id,
          surface: 'api',
          agent: 'engine',
        })
      : undefined;
  }

  /**
   * One ai_engine_logs row per background provider call (capability probe),
   * identifiable by `app_key`/`telemetry_metadata.purpose`. Tenant fields come
   * from the request context only if one exists; none are invented.
   */
  private logBackgroundUsage(
    configId: number,
    settings: Record<string, any> | undefined,
    record: AIBackgroundUsageRecord,
  ): void {
    const context = RequestContextService.asyncLocalStorage.getStore();
    const promptTokens = record.usage?.promptTokens ?? 0;
    const completionTokens = record.usage?.completionTokens ?? 0;
    const cacheTokens = extractCacheTokens(record.usage);
    void this.aiLoggingService.logRequest({
      app_key: record.purpose,
      telemetry_metadata: { purpose: record.purpose, background: true },
      config_id: configId,
      organization_id: context?.organization_id,
      store_id: context?.store_id,
      user_id: context?.user_id,
      model: record.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      ...cacheTokens,
      cost_usd: this.aiLoggingService.calculateCost(
        settings,
        promptTokens,
        completionTokens,
        cacheTokens.cache_read_tokens,
        cacheTokens.cache_creation_tokens,
      ),
      latency_ms: record.latencyMs,
      status: 'success',
    });
  }

  private observedLogFields(usage: AIResponse['usage']) {
    const observed = this.providerObserver?.observedUsage(usage);
    return {
      cost_source: 'logical_summary' as const,
      usage_observed: {
        prompt_tokens: observed?.promptTokens ?? null,
        completion_tokens: observed?.completionTokens ?? null,
        cache_read_tokens: observed?.cacheReadTokens ?? null,
        cache_creation_tokens: observed?.cacheCreationTokens ?? null,
      },
    };
  }

  private buildImagePrompt(
    app: any,
    variables?: Record<string, string>,
  ): string {
    const parts: string[] = [];

    if (app.system_prompt) {
      parts.push(this.interpolate(app.system_prompt, variables));
    }

    if (app.prompt_template) {
      parts.push(this.interpolate(app.prompt_template, variables));
    }

    if (parts.length > 0) return parts.join('\n\n');
    return variables ? JSON.stringify(variables) : '';
  }

  private buildApplicationPrompt(
    app: any,
    variables?: Record<string, string>,
  ): string {
    return this.buildImagePrompt(app, variables);
  }

  private buildImageOptions(
    app: any,
    overrides?: AIImageRequestOptions,
  ): AIImageRequestOptions {
    const metadata = (app.metadata as Record<string, any> | null) || {};
    const imageConfig = metadata.image_generation || metadata;

    return {
      model:
        overrides?.model ||
        imageConfig.image_model ||
        imageConfig.model ||
        undefined,
      responseModel:
        overrides?.responseModel || imageConfig.response_model || undefined,
      size: overrides?.size || imageConfig.size || '1024x1024',
      quality: overrides?.quality || imageConfig.quality || 'auto',
      outputFormat:
        overrides?.outputFormat || imageConfig.output_format || 'png',
      outputCompression:
        overrides?.outputCompression ?? imageConfig.output_compression,
      background: overrides?.background || imageConfig.background || 'auto',
      partialImages:
        overrides?.partialImages ?? imageConfig.partial_images ?? 2,
      inputFidelity:
        overrides?.inputFidelity || imageConfig.input_fidelity || undefined,
      action:
        overrides?.action ||
        imageConfig.action ||
        (overrides?.referenceImages?.length ? 'auto' : 'generate'),
      referenceImages: overrides?.referenceImages,
    };
  }

  private buildVideoOptions(
    app: any,
    overrides?: AIVideoRequestOptions,
  ): AIVideoRequestOptions {
    const metadata = (app.metadata as Record<string, any> | null) || {};
    const videoConfig = metadata.video_generation || metadata;

    return {
      model: overrides?.model || videoConfig.video_model || videoConfig.model,
      aspectRatio:
        overrides?.aspectRatio ||
        videoConfig.aspect_ratio ||
        videoConfig.aspectRatio,
      duration: overrides?.duration ?? videoConfig.duration,
      resolution: overrides?.resolution || videoConfig.resolution,
      callbackUrl:
        overrides?.callbackUrl ||
        videoConfig.callback_url ||
        videoConfig.callbackUrl,
      pollUntilComplete:
        overrides?.pollUntilComplete ?? videoConfig.poll_until_complete,
      pollIntervalMs: overrides?.pollIntervalMs ?? videoConfig.poll_interval_ms,
      maxPollAttempts:
        overrides?.maxPollAttempts ?? videoConfig.max_poll_attempts,
      provider: overrides?.provider || videoConfig.provider,
    };
  }

  private buildSpeechOptions(
    app: any,
    overrides?: AISpeechRequestOptions,
  ): AISpeechRequestOptions {
    const metadata = (app.metadata as Record<string, any> | null) || {};
    const speechConfig = metadata.speech || metadata;

    return {
      model:
        overrides?.model || speechConfig.speech_model || speechConfig.model,
      voice: overrides?.voice || speechConfig.voice,
      responseFormat:
        overrides?.responseFormat ||
        speechConfig.response_format ||
        speechConfig.responseFormat,
      speed: overrides?.speed ?? speechConfig.speed,
      // `??` y no `||`: un `vol` de 0 es un valor legítimo (silencio) y con `||`
      // caería al de la config, que es lo contrario de lo que el operador pidió.
      vol: overrides?.vol ?? speechConfig.vol,
      provider: overrides?.provider || speechConfig.provider,
    };
  }

  private buildRerankOptions(
    app: any,
    variables?: Record<string, string>,
    overrides?: Partial<AIRerankRequestOptions>,
  ): AIRerankRequestOptions {
    const metadata = (app.metadata as Record<string, any> | null) || {};
    const rerankConfig = metadata.rerank || metadata;
    const fallbackQuery = this.buildApplicationPrompt(app, variables);

    return {
      model:
        overrides?.model || rerankConfig.rerank_model || rerankConfig.model,
      query:
        overrides?.query ||
        rerankConfig.query ||
        fallbackQuery ||
        'Vendix connection test',
      documents: overrides?.documents ||
        rerankConfig.documents || ['Vendix connection test', 'Other document'],
      topN: overrides?.topN ?? rerankConfig.top_n ?? rerankConfig.topN,
      provider: overrides?.provider || rerankConfig.provider,
    };
  }

  private async resolveApplicationExecution(appKey: string): Promise<{
    app: any;
    provider: AIProvider;
    configId: number | null;
  }> {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    if (!app.is_active) {
      throw new VendixHttpException(ErrorCodes.AI_APP_003);
    }

    await this.runSubscriptionGate(appKey, app.ai_feature_category);
    await this.checkRateLimit(app);

    const configId = app.config_id || this.defaultConfigId;
    const provider = app.config_id
      ? this.providers.get(app.config_id)
      : this.getDefaultProvider();

    if (!provider) {
      throw new VendixHttpException(
        app.config_id ? ErrorCodes.AI_CONFIG_001 : ErrorCodes.AI_PROVIDER_002,
      );
    }

    return { app, provider, configId };
  }

  private logApplicationRequest(params: {
    appKey: string;
    configId: number | null;
    response: {
      model?: string;
      usage?: AIResponse['usage'];
      error?: string;
    };
    status: 'success' | 'error';
    startTime: number;
    variables?: Record<string, string>;
    featureCategory?: string | null;
  }): void {
    const latencyMs = Date.now() - params.startTime;
    const context = RequestContextService.asyncLocalStorage.getStore();
    const configSettings = params.configId
      ? this.configSettings.get(params.configId)
      : undefined;
    const usage = params.response.usage;

    const cacheTokens = extractCacheTokens(usage);
    const costUsd = this.aiLoggingService.calculateCost(
      configSettings,
      usage?.promptTokens ?? 0,
      usage?.completionTokens ?? 0,
      cacheTokens.cache_read_tokens,
      cacheTokens.cache_creation_tokens,
    );

    this.aiLoggingService.logRequest({
      request_id:
        RequestContextService.asyncLocalStorage.getStore()?.request_id,
      ...this.observedLogFields(usage),
      app_key: params.appKey,
      config_id: params.configId ?? undefined,
      organization_id: context?.organization_id,
      store_id: context?.store_id,
      user_id: context?.user_id,
      model: params.response.model,
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
      ...cacheTokens,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      status: params.status,
      error_message:
        params.status === 'error' ? params.response.error : undefined,
      input_preview: params.variables
        ? JSON.stringify(params.variables)
        : undefined,
    });

    this.eventEmitter.emit('ai.request.completed', {
      app_key: params.appKey,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      status: params.status,
      organization_id: context?.organization_id,
      store_id: context?.store_id,
      feature_category: params.featureCategory,
    });
  }

  /**
   * @deprecated Legacy fallback for AI configs that have not yet been
   * backfilled with the explicit `model_type` column. New code should rely on
   * `ai_engine_configs.model_type` / `ai_engine_applications.model_type`
   * directly via `getApplicationModelType`. Kept only to keep unmigrated rows
   * functional.
   */
  private getModelTypeFromSettings(settings: Record<string, any>): AIModelType {
    const modelType = settings?.model_type || settings?.modelType;

    if (this.isAIModelType(modelType)) {
      return modelType;
    }

    if (
      settings?.image_generation_mode !== undefined ||
      settings?.image_endpoint !== undefined ||
      settings?.image_model !== undefined ||
      settings?.modalities?.includes?.('image') === true
    ) {
      return 'image';
    }

    return 'text';
  }

  private resolveExecutionType(
    outputFormat: string,
    modelType: AIModelType,
  ): AIModelType {
    if (this.isAIModelType(outputFormat) && outputFormat !== 'text') {
      return outputFormat;
    }

    if (modelType !== 'text') {
      return modelType;
    }

    return 'text';
  }

  private isAIModelType(value: unknown): value is AIModelType {
    return (
      typeof value === 'string' &&
      [
        'text',
        'image',
        'embedding',
        'audio',
        'video',
        'rerank',
        'speech',
        'transcription',
      ].includes(value)
    );
  }

  private interpolate(
    template: string,
    variables?: Record<string, string>,
  ): string {
    if (!variables) return template;
    return template.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => variables[key] ?? `{{${key}}}`,
    );
  }

  private async checkRateLimit(app: any): Promise<void> {
    const rateLimit = app.rate_limit as {
      maxRequests?: number;
      windowSeconds?: number;
    } | null;

    if (!rateLimit?.maxRequests || !rateLimit?.windowSeconds) return;

    const key = `ai:ratelimit:${app.key}`;

    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, rateLimit.windowSeconds);
    const results = await pipeline.exec();

    const current = (results?.[0]?.[1] as number) || 0;

    if (current > rateLimit.maxRequests) {
      throw new VendixHttpException(ErrorCodes.AI_APP_004);
    }
  }

  private isThinkingEnabled(configId: number | null): boolean {
    if (!configId) return false;
    const settings = this.configSettings.get(configId);
    return !!settings?.thinking;
  }

  private sanitizeResponse(response: AIResponse, thinking = false): AIResponse {
    if (response.success && response.content && !thinking) {
      response.content = response.content
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
    }
    return response;
  }

  /**
   * Invoke SubscriptionAccessService gate for the current request's store.
   * - No storeId in context → skip (treated as internal caller).
   * - featureCategory not a valid AIFeatureKey → skip (legacy app not
   *   categorized yet).
   * - ENFORCE when SubscriptionGateConfig.isEnforce() is true;
   *   log-only (default) otherwise.
   */
  private async runSubscriptionGate(
    appKey: string,
    featureCategory: string | null,
  ): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return; // internal caller
    if (!featureCategory || !isAIFeatureKey(featureCategory)) {
      // F2: en rutas de tienda nunca hay skip silencioso. Tras F1 la columna
      // es NOT NULL con backfill, así que esto solo cubre valores legacy no
      // mapeados; se observa como denegado y bloquea en enforce.
      this.logger.log(
        JSON.stringify({
          event: 'AI_GATE_CHECK',
          appKey,
          storeId,
          feature: featureCategory ?? null,
          allowed: false,
          mode: 'block',
          reason: 'unmapped_feature_category',
          enforce: this.gateConfig.isEnforce(),
        }),
      );
      if (this.gateConfig.isEnforce()) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_005, undefined, {
          app_key: appKey,
          feature_category: featureCategory ?? null,
        });
      }
      return;
    }
    const feature = featureCategory;

    let result: Awaited<
      ReturnType<SubscriptionAccessService['canUseAIFeature']>
    >;
    try {
      result = await this.subscriptionAccess.canUseAIFeature(storeId, feature);
    } catch (err) {
      this.logger.error(
        `AI_GATE_ERROR appKey=${appKey} feature=${feature} err=${(err as Error).message}`,
      );
      if (this.gateConfig.isEnforce()) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR);
      }
      return;
    }

    this.logger.log(
      JSON.stringify({
        event: 'AI_GATE_CHECK',
        appKey,
        storeId,
        feature,
        allowed: result.allowed,
        mode: result.mode,
        reason: result.reason,
        state: result.subscription_state,
        enforce: this.gateConfig.isEnforce(),
      }),
    );

    if (result.mode === 'block' && this.gateConfig.isEnforce()) {
      const key =
        (result.reason as keyof typeof ErrorCodes) ?? 'SUBSCRIPTION_005';
      const entry = ErrorCodes[key] ?? ErrorCodes.SUBSCRIPTION_005;
      const details = {
        subscription_state: result.subscription_state,
        plan_id: result.plan_id ?? null,
        has_record: result.has_record,
      };
      throw new VendixHttpException(entry, undefined, details);
    }
  }

  /**
   * Consume subscription quota after a successful provider call.
   * Best-effort: never throws, any Redis failure is logged by the service.
   */
  private async consumeSubscriptionQuota(
    featureCategory: string | null,
    units: number,
    opts: { appKey?: string | null; callId?: string } = {},
  ): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return;
    if (!featureCategory) return;

    // Quota unit policy:
    //   category          | feature consumed  | units              | requestId
    //   conversations     | streaming_chat    | 1 (chat_assistant) | base (no suffix)
    //     (vex_assistant / other apps: no consumption here; Vex keeps its own
    //      counters in ai-agent.service.ts)
    //   text_generation   | text_generation   | token count        | base:callId
    //   async_queue       | async_queue       | 1 job              | base:callId
    //   rag_embeddings    | rag_embeddings    | 1 (one document)   | base:callId
    //   streaming_chat    | streaming_chat    | 1 message          | base (no suffix)
    //   anything else     | no numeric quota
    // base = RequestContext request id, or `internal-<uuid>` when absent.
    // Without suffix, many calls within one request dedupe to a single unit
    // (1 user message = 1 unit); with `:callId` every provider call counts.
    let feature: AIFeatureKey;
    let effectiveUnits: number;
    let perCall: boolean;
    if (featureCategory === 'conversations') {
      if (opts.appKey !== 'chat_assistant') return;
      feature = 'streaming_chat';
      effectiveUnits = 1;
      perCall = false;
    } else if (!isAIFeatureKey(featureCategory)) {
      return;
    } else {
      feature = featureCategory;
      switch (feature) {
        case 'text_generation':
          effectiveUnits = Math.max(0, Math.floor(units));
          perCall = true;
          break;
        case 'async_queue':
        case 'rag_embeddings':
          effectiveUnits = 1;
          perCall = true;
          break;
        case 'streaming_chat':
          effectiveUnits = 1;
          perCall = false;
          break;
        default:
          return;
      }
    }
    if (effectiveUnits <= 0) return;

    try {
      // requestId is MANDATORY for atomic dedup. HTTP path populates it via
      // middleware; queue processors re-establish the RequestContext.
      const base =
        RequestContextService.getRequestId() ?? `internal-${randomUUID()}`;
      const requestId = perCall
        ? `${base}:${opts.callId ?? randomUUID()}`
        : base;
      await this.subscriptionAccess.consumeAIQuota(
        storeId,
        feature,
        effectiveUnits,
        requestId,
      );
    } catch {
      // Already logged inside the service. Never bubble.
    }
  }

  private formatOutput(content: string, format: string): string {
    switch (format) {
      case 'json':
        // Try to extract JSON from the response
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) return jsonMatch[1].trim();
        const braceMatch = content.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (braceMatch) return braceMatch[1].trim();
        return content;
      case 'markdown':
      case 'html':
      case 'image':
      case 'text':
      default:
        return content;
    }
  }
}
