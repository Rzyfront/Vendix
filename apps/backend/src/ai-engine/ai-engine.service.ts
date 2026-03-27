import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  AIRequestOptions,
  AIResponse,
  AIStreamChunk,
} from './interfaces/ai-provider.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { AnthropicCompatibleProvider } from './providers/anthropic-compatible.provider';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AILoggingService } from './ai-logging.service';
import { RequestContextService } from '../common/context/request-context.service';

@Injectable()
export class AIEngineService implements OnModuleInit {
  private readonly logger = new Logger(AIEngineService.name);
  private providers: Map<number, AIProvider> = new Map();
  private configSettings: Map<number, Record<string, any>> = new Map();
  private defaultConfigId: number | null = null;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly aiLoggingService: AILoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.loadConfigurations();
  }

  private async loadConfigurations() {
    this.providers.clear();
    this.configSettings.clear();
    this.defaultConfigId = null;

    try {
      const configs = await this.prisma.ai_engine_configs.findMany({
        where: { is_active: true },
      });

      for (const config of configs) {
        this.initializeProvider(config);
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

  private initializeProvider(config: any) {
    const providerConfig: AIProviderConfig = {
      provider: config.provider,
      sdkType: config.sdk_type,
      apiKey: this.resolveApiKey(config),
      modelId: config.model_id,
      baseUrl: config.base_url || undefined,
      settings: config.settings as Record<string, any>,
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
        default:
          this.logger.warn(
            `Unknown sdk_type: ${config.sdk_type} for provider ${config.provider}`,
          );
          return;
      }

      this.providers.set(config.id, provider);
      this.configSettings.set(config.id, (config.settings as Record<string, any>) || {});
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize provider "${config.provider}" (${config.sdk_type}): ${error.message}`,
      );
    }
  }

  private resolveApiKey(config: any): string {
    if (config.api_key_ref) return config.api_key_ref;
    const envKey = `AI_${config.provider.toUpperCase().replace(/\s+/g, '_')}_API_KEY`;
    return (
      process.env[envKey] || this.configService.get<string>(envKey) || ''
    );
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

  async chat(
    messages: AIMessage[],
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const provider = this.getDefaultProvider();
    const response = await provider.chat(messages, options);
    if (!response.success) {
      this.logger.error(`AI chat failed: ${response.error}`);
    }
    const thinking = options?.thinking ?? this.isThinkingEnabled(this.defaultConfigId);
    return this.sanitizeResponse(response, thinking);
  }

  async complete(
    prompt: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const provider = this.getDefaultProvider();
    const response = await provider.complete(prompt, options);
    if (!response.success) {
      this.logger.error(`AI complete failed: ${response.error}`);
    }
    const thinking = options?.thinking ?? this.isThinkingEnabled(this.defaultConfigId);
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
    return this.sanitizeResponse(await provider.chat(messages, options), thinking);
  }

  async testProvider(
    configId: number,
  ): Promise<{ success: boolean; message: string }> {
    const provider = this.providers.get(configId);
    if (!provider) {
      // Try to load it on-the-fly for testing
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: configId },
      });
      if (!config) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
      }
      this.initializeProvider(config);
      const freshProvider = this.providers.get(configId);
      if (!freshProvider) {
        return { success: false, message: `Unknown sdk_type: ${config.sdk_type}` };
      }
      const result = await freshProvider.testConnection();
      await this.prisma.ai_engine_configs.update({
        where: { id: configId },
        data: {
          last_tested_at: new Date(),
          last_test_ok: result.success,
        },
      });
      return result;
    }

    const result = await provider.testConnection();
    await this.prisma.ai_engine_configs.update({
      where: { id: configId },
      data: {
        last_tested_at: new Date(),
        last_test_ok: result.success,
      },
    });
    return result;
  }

  async reloadConfigurations(): Promise<void> {
    await this.loadConfigurations();
  }

  isConfigured(): boolean {
    return this.providers.size > 0;
  }

  // --- Application-level API ---

  async run(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
  ): Promise<AIResponse> {
    const startTime = Date.now();
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

      // Build messages
      const messages: AIMessage[] = [];

      if (app.system_prompt) {
        messages.push({
          role: 'system',
          content: this.interpolate(app.system_prompt, variables),
        });
      }

      if (app.prompt_template) {
        messages.push({
          role: 'user',
          content: this.interpolate(app.prompt_template, variables),
        });
      }

      if (extraMessages) {
        messages.push(...extraMessages);
      }

      // Build options from application config
      const options: AIRequestOptions = {};
      if (app.temperature !== null) {
        options.temperature = Number(app.temperature);
      }
      if (app.max_tokens !== null) {
        options.maxTokens = app.max_tokens;
      }

      // Execute with retry
      const retryConfig = app.retry_config as {
        maxRetries?: number;
        delayMs?: number;
      } | null;
      const maxRetries = retryConfig?.maxRetries ?? 0;
      const delayMs = retryConfig?.delayMs ?? 1000;

      let lastResponse: AIResponse = { success: false, error: 'No attempt made' };

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        lastResponse = await provider.chat(messages, options);

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

          logStatus = 'success';
          logResponse = lastResponse;
          return lastResponse;
        }

        if (attempt < maxRetries) {
          this.logger.warn(
            `AI app "${appKey}" attempt ${attempt + 1} failed, retrying in ${delayMs}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      this.logger.error(
        `AI app "${appKey}" failed after ${maxRetries + 1} attempts: ${lastResponse.error}`,
      );
      logResponse = lastResponse;
      return lastResponse;
    } catch (error: any) {
      logResponse = { success: false, error: error.message };
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;
      const context = RequestContextService.getContext();
      const configSettings = resolvedConfigId
        ? this.configSettings.get(resolvedConfigId)
        : undefined;

      const costUsd = this.aiLoggingService.calculateCost(
        configSettings,
        logResponse.usage?.promptTokens ?? 0,
        logResponse.usage?.completionTokens ?? 0,
      );

      this.aiLoggingService.logRequest({
        app_key: appKey,
        config_id: resolvedConfigId ?? undefined,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        user_id: context?.user_id,
        model: logResponse.model,
        prompt_tokens: logResponse.usage?.promptTokens ?? 0,
        completion_tokens: logResponse.usage?.completionTokens ?? 0,
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

  async *runStream(
    appKey: string,
    variables?: Record<string, string>,
    extraMessages?: AIMessage[],
  ): AsyncGenerator<AIStreamChunk> {
    const startTime = Date.now();
    let lastChunk: AIStreamChunk | null = null;
    let resolvedConfigId: number | null = null;

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
        lastChunk = { type: 'error', error: 'Streaming not supported by this provider' };
        yield lastChunk;
        return;
      }

      // Build messages
      const messages: AIMessage[] = [];

      if (app.system_prompt) {
        messages.push({
          role: 'system',
          content: this.interpolate(app.system_prompt, variables),
        });
      }

      if (app.prompt_template) {
        messages.push({
          role: 'user',
          content: this.interpolate(app.prompt_template, variables),
        });
      }

      if (extraMessages) {
        messages.push(...extraMessages);
      }

      const options: AIRequestOptions = {};
      if (app.temperature !== null) {
        options.temperature = Number(app.temperature);
      }
      if (app.max_tokens !== null) {
        options.maxTokens = app.max_tokens;
      }

      try {
        for await (const chunk of provider.chatStream(messages, options)) {
          lastChunk = chunk;
          yield chunk;
        }
      } catch (error: any) {
        lastChunk = { type: 'error', error: error.message };
        yield lastChunk;
      }
    } finally {
      // Log after stream completes — always runs regardless of early returns
      const latencyMs = Date.now() - startTime;
      const context = RequestContextService.getContext();
      const configSettings = resolvedConfigId
        ? this.configSettings.get(resolvedConfigId)
        : undefined;

      const usage = lastChunk?.type === 'done' ? lastChunk.usage : undefined;
      const costUsd = this.aiLoggingService.calculateCost(
        configSettings,
        usage?.promptTokens ?? 0,
        usage?.completionTokens ?? 0,
      );

      this.aiLoggingService.logRequest({
        app_key: appKey,
        config_id: resolvedConfigId ?? undefined,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        user_id: context?.user_id,
        model: undefined,
        prompt_tokens: usage?.promptTokens ?? 0,
        completion_tokens: usage?.completionTokens ?? 0,
        cost_usd: costUsd,
        latency_ms: latencyMs,
        status: lastChunk?.type === 'error' ? 'error' : 'success',
        error_message: lastChunk?.type === 'error' ? lastChunk.error : undefined,
        input_preview: variables ? JSON.stringify(variables) : undefined,
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
      case 'text':
      default:
        return content;
    }
  }
}
