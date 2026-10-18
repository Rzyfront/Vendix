import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AgentTraceService } from './observability/agent-trace.service';
import { ProviderAttemptObserver } from './provider-attempt-observer';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentDeadline, agentDeadlineContext } from './tasks/agent-deadline';

/**
 * QUI-857 — Generación/mejora de imágenes de producto con IA.
 *
 * Root cause C1 (confirmed against the dev DB): image applications ship with
 * `config_id = NULL` and only a text configuration may be the global default
 * (AI_CONFIG_003). With no default config and no per-app config, `runImage`
 * threw AI_PROVIDER_002 even when an active image configuration existed —
 * `app.config_id || defaultConfigId` ignored the matching `model_type`.
 *
 * Fix: `resolveProviderForApp()` prefers an active configuration whose
 * `model_type` matches the application before falling back to the default.
 */
describe('AIEngineService.resolveProviderForApp (QUI-857 C1)', () => {
  let service: AIEngineService;
  let prisma: {
    ai_engine_applications: { findUnique: jest.Mock };
  };

  const imageProvider = { generateImage: jest.fn() };
  const textProvider = { chat: jest.fn() };

  const buildService = (): AIEngineService => {
    prisma = {
      ai_engine_applications: {
        findUnique: jest.fn(),
      },
    };
    const serviceInstance = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      {
        calculateCost: jest.fn().mockReturnValue(0),
        logRequest: jest.fn(),
      } as any,
      { emit: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    return serviceInstance;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    service = buildService();
  });

  it('prefers an explicit config_id over any fallback', () => {
    const app = { config_id: 99, model_type: 'image' };
    (service as any).providers.set(99, imageProvider);

    const result = (service as any).resolveProviderForApp(app);

    expect(result.provider).toBe(imageProvider);
    expect(result.configId).toBe(99);
  });

  it('throws AI_CONFIG_001 when an explicit config_id has no loaded provider', () => {
    const app = { config_id: 404, model_type: 'image' };

    expect(() => (service as any).resolveProviderForApp(app)).toThrow(
      VendixHttpException,
    );
    try {
      (service as any).resolveProviderForApp(app);
    } catch (err: any) {
      expect(err.errorCode).toBe(ErrorCodes.AI_CONFIG_001.code);
    }
  });

  it('resolves an active config matching the app model_type when no config_id is set', () => {
    const app = { config_id: null, model_type: 'image' };
    (service as any).configModelTypes.set(7, 'image');
    (service as any).providers.set(7, imageProvider);
    (service as any).configModelTypes.set(3, 'speech');
    (service as any).providers.set(3, textProvider);

    const result = (service as any).resolveProviderForApp(app);

    expect(result.provider).toBe(imageProvider);
    expect(result.configId).toBe(7);
  });

  it('skips configs whose provider failed to initialize (not in providers map)', () => {
    const app = { config_id: null, model_type: 'image' };
    (service as any).configModelTypes.set(7, 'image');
    (service as any).configModelTypes.set(8, 'image');
    (service as any).providers.set(8, imageProvider);

    const result = (service as any).resolveProviderForApp(app);

    expect(result.configId).toBe(8);
    expect(result.provider).toBe(imageProvider);
  });

  it('falls back to the default config when no matching model_type exists', () => {
    const app = { config_id: null, model_type: 'image' };
    (service as any).configModelTypes.set(1, 'text');
    (service as any).providers.set(1, textProvider);
    (service as any).defaultConfigId = 1;

    const result = (service as any).resolveProviderForApp(app);

    expect(result.provider).toBe(textProvider);
    expect(result.configId).toBe(1);
  });

  it('throws AI_PROVIDER_002 when nothing is resolvable', () => {
    const app = { config_id: null, model_type: 'image' };

    expect(() => (service as any).resolveProviderForApp(app)).toThrow(
      VendixHttpException,
    );
    try {
      (service as any).resolveProviderForApp(app);
    } catch (err: any) {
      expect(err.errorCode).toBe(ErrorCodes.AI_PROVIDER_002.code);
    }
  });
});

describe('AIEngineService.runImage (QUI-857 C1 happy path without default)', () => {
  let service: AIEngineService;
  let prisma: {
    ai_engine_applications: { findUnique: jest.Mock };
  };

  const buildService = (): AIEngineService => {
    prisma = {
      ai_engine_applications: {
        findUnique: jest.fn(),
      },
    };
    const serviceInstance = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      {
        calculateCost: jest.fn().mockReturnValue(0),
        logRequest: jest.fn(),
      } as any,
      { emit: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    return serviceInstance;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    service = buildService();
  });

  it('resolves an image config by model_type and generates the image even with no default', async () => {
    const app = {
      key: 'product_image_enhancer',
      model_type: 'image',
      config_id: null,
      is_active: true,
      ai_feature_category: 'image_generation',
      system_prompt: 'You are a commercial photographer',
      prompt_template: null,
      metadata: { image_generation: { size: '1024x1024' } },
    };
    prisma.ai_engine_applications.findUnique.mockResolvedValue(app);

    (service as any).configModelTypes.set(7, 'image');
    const generateImage = jest.fn().mockResolvedValue({
      success: true,
      imageBase64: 'data:image/png;base64,QUJD',
      model: 'gpt-image-1',
    });
    (service as any).providers.set(7, { generateImage });

    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);

    const result = await service.runImage('product_image_enhancer', {
      requested_improvement: 'mejorar iluminacion',
    });

    expect(result.success).toBe(true);
    expect(result.imageBase64).toBe('data:image/png;base64,QUJD');
    expect(generateImage).toHaveBeenCalled();
  });
});

describe('AIEngineService.runImageStream (QUI-857 C1)', () => {
  let service: AIEngineService;
  let prisma: {
    ai_engine_applications: { findUnique: jest.Mock };
  };

  const buildService = (): AIEngineService => {
    prisma = {
      ai_engine_applications: {
        findUnique: jest.fn(),
      },
    };
    const serviceInstance = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      {
        calculateCost: jest.fn().mockReturnValue(0),
        logRequest: jest.fn(),
      } as any,
      { emit: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    return serviceInstance;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    service = buildService();
  });

  it('emits an error chunk when no provider is resolvable', async () => {
    const app = {
      key: 'product_image_enhancer',
      model_type: 'image',
      config_id: null,
      is_active: true,
      ai_feature_category: 'image_generation',
    };
    prisma.ai_engine_applications.findUnique.mockResolvedValue(app);
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);

    const chunks: any[] = [];
    for await (const chunk of service.runImageStream(
      'product_image_enhancer',
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0].type).toBe('error');
    expect((chunks[0].error as string).length).toBeGreaterThan(0);
  });

  it('yields a completed chunk when the provider generates the image', async () => {
    const app = {
      key: 'product_image_enhancer',
      model_type: 'image',
      config_id: null,
      is_active: true,
      ai_feature_category: 'image_generation',
      system_prompt: 'You are a commercial photographer',
      prompt_template: null,
      metadata: { image_generation: { size: '1024x1024' } },
    };
    prisma.ai_engine_applications.findUnique.mockResolvedValue(app);

    (service as any).configModelTypes.set(7, 'image');
    (service as any).providers.set(7, {
      generateImage: jest.fn().mockResolvedValue({
        success: true,
        imageBase64: 'data:image/png;base64,QUJD',
        model: 'gpt-image-1',
      }),
    });

    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);

    const chunkTypes: string[] = [];
    for await (const chunk of service.runImageStream(
      'product_image_enhancer',
    )) {
      chunkTypes.push(chunk.type as string);
    }

    expect(chunkTypes).toEqual(['progress', 'completed', 'done']);
  });

  it('logs the resolved config_id when resolved by model_type (no default)', async () => {
    const app = {
      key: 'product_image_enhancer',
      model_type: 'image',
      config_id: null,
      is_active: true,
      ai_feature_category: 'image_generation',
      system_prompt: 'You are a commercial photographer',
      prompt_template: null,
      metadata: { image_generation: { size: '1024x1024' } },
    };
    prisma.ai_engine_applications.findUnique.mockResolvedValue(app);

    (service as any).configModelTypes.set(7, 'image');
    const generateImage = jest.fn().mockResolvedValue({
      success: true,
      imageBase64: 'data:image/png;base64,QUJD',
      model: 'gpt-image-1',
    });
    (service as any).providers.set(7, { generateImage });

    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);

    const logRequest = (service as any).aiLoggingService.logRequest;
    for await (const _ of service.runImageStream('product_image_enhancer')) {
      // consume
    }

    expect(logRequest).toHaveBeenCalledWith(
      expect.objectContaining({ config_id: 7 }),
    );
  });
});
describe('AIEngineService cache token logging (vexR3-C)', () => {
  const buildService = () => {
    const prisma = { ai_engine_applications: { findUnique: jest.fn() } };
    const aiLogging = {
      calculateCost: jest.fn().mockReturnValue(0.5),
      logRequest: jest.fn(),
    };
    const service = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      aiLogging as any,
      { emit: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    return { service, prisma, aiLogging };
  };

  it('run() passes provider cache tokens to calculateCost and logRequest', async () => {
    const { service, prisma, aiLogging } = buildService();
    prisma.ai_engine_applications.findUnique.mockResolvedValue({
      key: 'vex_assistant',
      is_active: true,
      config_id: 5,
      model_type: 'text',
      system_prompt: 'sys',
      prompt_template: 'hi',
      ai_feature_category: null,
    });
    (service as any).providers.set(5, {
      chat: jest.fn().mockResolvedValue({
        success: true,
        content: 'ok',
        model: 'claude',
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheReadTokens: 80,
          cacheCreationTokens: 15,
        },
      }),
    });
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);

    await service.run('vex_assistant');

    expect(aiLogging.calculateCost).toHaveBeenCalledWith(
      undefined,
      100,
      20,
      80,
      15,
    );
    expect(aiLogging.logRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_tokens: 100,
        completion_tokens: 20,
        cache_read_tokens: 80,
        cache_creation_tokens: 15,
      }),
    );
  });

  it('logApplicationRequest() forwards cache tokens and defaults to 0', () => {
    const { service, aiLogging } = buildService();
    (service as any).logApplicationRequest({
      appKey: 'a',
      configId: null,
      response: {
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          cacheReadTokens: 7,
          cacheCreationTokens: 9,
        },
      },
      status: 'success',
      startTime: Date.now(),
    });
    expect(aiLogging.logRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cache_read_tokens: 7,
        cache_creation_tokens: 9,
      }),
    );

    (service as any).logApplicationRequest({
      appKey: 'a',
      configId: null,
      response: {
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
      status: 'success',
      startTime: Date.now(),
    });
    expect(aiLogging.logRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
      }),
    );
  });
});

describe('AIEngineService.consumeSubscriptionQuota wiring', () => {
  const STORE_ID = 42;
  const BASE = 'req-base-1';

  const buildService = () => {
    const prisma = { ai_engine_applications: { findUnique: jest.fn() } };
    const subscriptionAccess = {
      canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      consumeAIQuota: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      { on: jest.fn() } as any,
      {
        calculateCost: jest.fn().mockReturnValue(0),
        logRequest: jest.fn(),
      } as any,
      { emit: jest.fn() } as any,
      subscriptionAccess as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    return { service, prisma, subscriptionAccess };
  };

  const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContextService.run(
      {
        is_super_admin: false,
        is_owner: false,
        store_id: STORE_ID,
        request_id: BASE,
      },
      fn,
    );

  const textApp = (key: string, category: string) => ({
    key,
    is_active: true,
    config_id: 5,
    model_type: 'text',
    system_prompt: 'sys',
    prompt_template: 'hi',
    ai_feature_category: category,
  });

  const withTextProvider = (service: AIEngineService) =>
    (service as any).providers.set(5, {
      chat: jest.fn().mockResolvedValue({
        success: true,
        content: 'ok',
        model: 'm',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    });

  it('counts every text_generation run() of the same request with distinct requestIds', async () => {
    const { service, prisma, subscriptionAccess } = buildService();
    prisma.ai_engine_applications.findUnique.mockResolvedValue(
      textApp('some_text_app', 'text_generation'),
    );
    withTextProvider(service);

    await inRequest(async () => {
      await service.run('some_text_app');
      await service.run('some_text_app');
    });

    const calls = subscriptionAccess.consumeAIQuota.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0].slice(0, 3)).toEqual([STORE_ID, 'text_generation', 15]);
    expect(calls[1].slice(0, 3)).toEqual([STORE_ID, 'text_generation', 15]);
    expect(calls[0][3]).toMatch(new RegExp(`^${BASE}:.+`));
    expect(calls[1][3]).toMatch(new RegExp(`^${BASE}:.+`));
    expect(calls[0][3]).not.toEqual(calls[1][3]);
  });

  it('charges chat_assistant (conversations) as 1 streaming_chat unit with the base requestId', async () => {
    const { service, prisma, subscriptionAccess } = buildService();
    prisma.ai_engine_applications.findUnique.mockResolvedValue(
      textApp('chat_assistant', 'conversations'),
    );
    withTextProvider(service);

    await inRequest(() => service.run('chat_assistant'));

    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledTimes(1);
    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledWith(
      STORE_ID,
      'streaming_chat',
      1,
      BASE,
    );
  });

  it('does not consume quota for vex_assistant (own counters)', async () => {
    const { service, prisma, subscriptionAccess } = buildService();
    prisma.ai_engine_applications.findUnique.mockResolvedValue(
      textApp('vex_assistant', 'conversations'),
    );
    withTextProvider(service);

    await inRequest(() => service.run('vex_assistant'));

    expect(subscriptionAccess.consumeAIQuota).not.toHaveBeenCalled();
  });

  it('charges one rag_embeddings unit per embedding regardless of tokens', async () => {
    const { service, subscriptionAccess } = buildService();
    jest
      .spyOn(service as any, 'resolveApplicationExecution')
      .mockResolvedValue({
        app: { key: 'rag_embedder', ai_feature_category: 'rag_embeddings' },
        provider: {
          generateEmbedding: jest.fn().mockResolvedValue({
            success: true,
            embeddings: [[0.1]],
            usage: { totalTokens: 500 },
          }),
        },
        configId: 9,
      });

    await inRequest(() => service.runEmbedding('rag_embedder', {}, 'doc'));

    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledTimes(1);
    const args = subscriptionAccess.consumeAIQuota.mock.calls[0];
    expect(args.slice(0, 3)).toEqual([STORE_ID, 'rag_embeddings', 1]);
    expect(args[3]).toMatch(new RegExp(`^${BASE}:.+`));
  });
});

describe('AIEngineService phase A provider attempts and quota isolation', () => {
  const previousFlag = process.env.AI_AGENT_TRACING_ENABLED;
  const settings = { pricing: { input_per_1k: 1, output_per_1k: 2 } };
  const app = {
    key: 'phase_a_text',
    is_active: true,
    config_id: 5,
    system_prompt: 'same system',
    prompt_template: 'same {{input}}',
    temperature: 0.3,
    max_tokens: 500,
    output_format: 'text',
    ai_feature_category: 'text_generation',
    retry_config: { maxRetries: 1, delayMs: 0 },
  };
  const success = {
    success: true,
    content: 'ok',
    model: 'test-model',
    finish_reason: 'stop' as const,
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  };

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.AI_AGENT_TRACING_ENABLED;
    else process.env.AI_AGENT_TRACING_ENABLED = previousFlag;
  });

  const build = (enabled = true) => {
    process.env.AI_AGENT_TRACING_ENABLED = String(enabled);
    const rows = new Map<string, any>();
    const prisma = {
      ai_engine_applications: { findUnique: jest.fn().mockResolvedValue(app) },
      ai_engine_logs: { create: jest.fn().mockResolvedValue({}) },
      ai_agent_trace_spans: {
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          rows.set(create.span_id, { ...create });
          return create;
        }),
      },
    };
    const trace = new AgentTraceService(prisma as any);
    const logging = new AILoggingService(prisma as any, {} as any, trace);
    const log = jest.spyOn(logging, 'logRequest');
    const subscriptionAccess = {
      canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }),
      consumeAIQuota: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AIEngineService(
      prisma as any,
      { get: jest.fn() } as any,
      {} as any,
      logging,
      { emit: jest.fn() } as any,
      subscriptionAccess as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
      trace,
    );
    (service as any).configSettings.set(5, settings);
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    const execute = async (
      callback = () =>
        service.run(app.key, { input: 'private cliente@example.test' }),
    ) => {
      const scope = {
        kind: 'tenant' as const,
        organization_id: 1,
        store_id: 42,
        user_id: 7,
        request_id: 'legacy-request-dedup',
        surface: 'text',
        agent: 'vex',
      };
      const root = trace.startTrace(scope);
      try {
        return await RequestContextService.runIsolated(
          {
            is_super_admin: false,
            is_owner: false,
            organization_id: 1,
            store_id: 42,
            user_id: 7,
            request_id: 'legacy-request-dedup',
          },
          () => trace.run(root, callback),
        );
      } finally {
        trace.finishTrace(root, 'partial');
        await trace.flush();
      }
    };
    return {
      service,
      prisma,
      trace,
      logging,
      log,
      subscriptionAccess,
      rows,
      execute,
    };
  };

  it('429 → retry → success has two attempts, one logical request and canonical cost only once', async () => {
    const { service, rows, log, subscriptionAccess, execute } = build();
    const chat = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: '429 rate limit' })
      .mockResolvedValueOnce(success);
    (service as any).providers.set(5, { chat });
    await execute();
    const spans = [...rows.values()];
    const attempts = spans.filter((row) => row.kind === 'provider_attempt');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(attempts).toHaveLength(2);
    expect(spans.filter((row) => row.kind === 'provider_call')).toHaveLength(1);
    expect(spans.filter((row) => row.kind === 'provider_retry')).toHaveLength(
      1,
    );
    expect(attempts[0].cost_usd).toBeNull();
    expect(attempts[0].prompt_tokens).toBeNull();
    expect(attempts[1].cost_usd).toBe(0.14);
    expect(spans.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)).toBe(0.14);
    expect(
      spans
        .filter((row) => row.kind !== 'provider_attempt')
        .every((row) => row.cost_usd === null),
    ).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ cost_source: 'logical_summary' }),
    );
    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledTimes(1);
    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledWith(
      42,
      'text_generation',
      120,
      expect.stringMatching(/^legacy-request-dedup:/),
    );
  });

  it('retains the billed usage of failed attempts instead of only costing the final response', async () => {
    const { service, rows, execute } = build();
    (service as any).providers.set(5, {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          ...success,
          success: false,
          error: 'provider failure with usage',
        })
        .mockResolvedValueOnce(success),
    });
    await execute();
    expect(
      [...rows.values()].reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    ).toBe(0.28);
  });

  it('missing usage stays null in observed telemetry, including cache counters', async () => {
    const { service, rows, prisma, execute } = build();
    (service as any).providers.set(5, {
      chat: jest.fn().mockResolvedValue({ success: true, content: 'ok' }),
    });
    await execute();
    const attempt = [...rows.values()].find(
      (row) => row.kind === 'provider_attempt',
    );
    expect(attempt).toMatchObject({
      prompt_tokens: null,
      completion_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      cost_usd: null,
    });
    expect(
      prisma.ai_engine_logs.create.mock.calls[0][0].data.usage_observed,
    ).toEqual({
      prompt_tokens: null,
      completion_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
    });
  });

  it('flag OFF keeps provider payload, response and quota units/dedup semantics unchanged', async () => {
    const off = build(false);
    const chatOff = jest.fn().mockResolvedValue({ ...success });
    (off.service as any).providers.set(5, { chat: chatOff });
    const resultOff = await off.execute();
    expect(off.rows.size).toBe(0);
    const on = build(true);
    const chatOn = jest.fn().mockResolvedValue({ ...success });
    (on.service as any).providers.set(5, { chat: chatOn });
    const resultOn = await on.execute();
    expect(chatOn.mock.calls).toEqual(chatOff.mock.calls);
    expect(resultOn).toEqual(resultOff);
    const offQuota = off.subscriptionAccess.consumeAIQuota.mock.calls[0];
    const onQuota = on.subscriptionAccess.consumeAIQuota.mock.calls[0];
    expect(onQuota.slice(0, 3)).toEqual(offQuota.slice(0, 3));
    expect(offQuota[3]).toMatch(/^legacy-request-dedup:/);
    expect(onQuota[3]).toMatch(/^legacy-request-dedup:/);
    expect(onQuota[3]).not.toBe([...on.rows.values()][0].trace_id);
  });

  it.each([
    [
      { pricing: { input_per_1k: 1, output_per_1k: 2 } },
      { cacheReadTokens: 80 },
      null,
    ],
    [{ pricing: { input_per_1k: -1, output_per_1k: 2 } }, {}, null],
    [
      {
        pricing: { input_per_1k: 1, output_per_1k: 2, cache_read_per_1k: 0.1 },
      },
      {},
      null,
    ],
    [
      {
        pricing: { input_per_1k: 1, output_per_1k: 2, cache_read_per_1k: 0.1 },
      },
      { cacheReadTokens: 80 },
      0.148,
    ],
  ])(
    'does not invent prices for unknown/invalid cache usage: %j',
    async (pricing, cache, expected) => {
      const { service, rows, execute } = build();
      (service as any).configSettings.set(5, pricing);
      (service as any).providers.set(5, {
        chat: jest.fn().mockResolvedValue({
          ...success,
          usage: { ...success.usage, ...cache },
        }),
      });
      await execute();
      expect(
        [...rows.values()].find((row) => row.kind === 'provider_attempt')
          .cost_usd,
      ).toBe(expected);
    },
  );

  it('runStream done preserves chunks/quota and attaches usage to one attempt', async () => {
    const { service, rows, subscriptionAccess, execute } = build();
    (service as any).providers.set(5, {
      chatStream: async function* () {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done', usage: success.usage };
      },
    });
    const chunks: any[] = [];
    await execute(async () => {
      for await (const chunk of service.runStream(app.key)) chunks.push(chunk);
      return { success: true };
    });
    expect(chunks).toEqual([
      { type: 'text', content: 'ok' },
      { type: 'done', usage: success.usage },
    ]);
    expect(
      [...rows.values()].filter((row) => row.kind === 'provider_call'),
    ).toHaveLength(1);
    expect(
      [...rows.values()].filter((row) => row.kind === 'provider_attempt'),
    ).toHaveLength(1);
    expect(
      [...rows.values()].find((row) => row.kind === 'provider_attempt')
        .cost_usd,
    ).toBe(0.14);
    expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledTimes(1);
  });

  it('runStream cancellation closes child spans and iterator without closing the caller root', async () => {
    const { service, rows, subscriptionAccess, execute, trace } = build();
    let returned = false;
    (service as any).providers.set(5, {
      chatStream: async function* () {
        try {
          yield { type: 'text', content: 'partial' };
          yield { type: 'done' };
        } finally {
          returned = true;
        }
      },
    });
    await execute(async () => {
      const root = trace.currentSpan();
      const iterator = service.runStream(app.key);
      expect((await iterator.next()).value).toEqual({
        type: 'text',
        content: 'partial',
      });
      await iterator.return(undefined);
      expect(trace.currentSpan()).toBe(root);
      expect(trace.currentTraceContext()).toBeDefined();
      return { success: true };
    });
    expect(returned).toBe(true);
    const children = [...rows.values()].filter((row) => row.kind !== 'root');
    expect(children.every((row) => row.status === 'cancelled')).toBe(true);
    expect(children.every((row) => row.cost_usd === null)).toBe(true);
    expect(subscriptionAccess.consumeAIQuota).not.toHaveBeenCalled();
  });

  it('runStream error remains an error frame, never a completed or charged task', async () => {
    const { service, rows, subscriptionAccess, execute } = build();
    (service as any).providers.set(5, {
      chatStream: async function* () {
        throw new Error('private provider error');
      },
    });
    const chunks: any[] = [];
    await execute(async () => {
      for await (const chunk of service.runStream(app.key)) chunks.push(chunk);
      return { success: true };
    });
    expect(chunks).toEqual([
      { type: 'error', error: 'private provider error' },
    ]);
    expect(
      [...rows.values()].find((row) => row.kind === 'provider_call').status,
    ).toBe('error');
    expect(
      [...rows.values()].find((row) => row.kind === 'provider_attempt').status,
    ).toBe('error');
    expect(subscriptionAccess.consumeAIQuota).not.toHaveBeenCalled();
    expect(JSON.stringify([...rows.values()])).not.toContain(
      'private provider error',
    );
  });

  it.each(['response', 'stream'] as const)(
    'standalone %s failure closes its own root as failed, not partial',
    async (surface) => {
      const { service, rows, trace } = build();
      (service as any).providers.set(5, {
        chat: jest
          .fn()
          .mockResolvedValue({ success: false, error: 'legacy failure' }),
        chatStream: async function* () {
          yield { type: 'error', error: 'legacy failure' };
        },
      });
      await RequestContextService.runIsolated(
        {
          is_super_admin: false,
          is_owner: false,
          organization_id: 1,
          store_id: 42,
          request_id: 'standalone-dedup',
        },
        async () => {
          if (surface === 'response') {
            expect(await service.run(app.key)).toEqual({
              success: false,
              error: 'legacy failure',
            });
          } else {
            const frames: unknown[] = [];
            for await (const frame of service.runStream(app.key))
              frames.push(frame);
            expect(frames).toEqual([
              { type: 'error', error: 'legacy failure' },
            ]);
          }
        },
      );
      await trace.flush();
      const roots = [...rows.values()].filter((row) => row.kind === 'root');
      expect(roots).toHaveLength(1);
      expect(roots[0]).toMatchObject({ outcome: 'failed', status: 'error' });
    },
  );

  it('stream wrappers forward consumer throw to source recovery without closing the caller root', async () => {
    const { trace, logging, execute, rows } = build();
    const observer = new ProviderAttemptObserver(trace, logging);
    let received: unknown;
    await execute(async () => {
      const root = trace.currentSpan();
      const iterator = observer.callStream(() =>
        observer.attemptStream(settings, {}, async function* () {
          try {
            yield { type: 'text' as const, content: 'first' };
          } catch (error) {
            received = error;
            yield { type: 'text' as const, content: 'recovered' };
          }
          yield { type: 'done' as const, usage: success.usage };
        }),
      );
      expect((await iterator.next()).value).toEqual({
        type: 'text',
        content: 'first',
      });
      const injected = new Error('consumer injected');
      expect((await iterator.throw(injected)).value).toEqual({
        type: 'text',
        content: 'recovered',
      });
      expect(received).toBe(injected);
      expect((await iterator.next()).value).toEqual({
        type: 'done',
        usage: success.usage,
      });
      expect((await iterator.next()).done).toBe(true);
      expect(trace.currentSpan()).toBe(root);
      expect(trace.currentTraceContext()).toBeDefined();
      return { success: true };
    });
    expect(
      [...rows.values()]
        .filter((row) => row.kind !== 'root')
        .every((row) => row.status === 'ok'),
    ).toBe(true);
  });

  it('stream SDK retry is counted and missing real usage stays unknown despite legacy zeros', async () => {
    const { service, rows, execute, prisma } = build();
    const streamPayload =
      'data: ' +
      JSON.stringify({
        id: 'qa-stream',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
        choices: [
          { index: 0, delta: { content: 'ok' }, finish_reason: 'stop' },
        ],
      }) +
      '\n\ndata: [DONE]\n\n';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"error":{"message":"rate limited"}}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after-ms': '1',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(streamPayload, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
    (service as any).initializeProvider({
      id: 5,
      provider: 'QA',
      sdk_type: 'openai_compatible',
      model_id: 'test-model',
      api_key_ref: 'qa-not-real-key',
      settings,
    });
    await execute(async () => {
      for await (const _ of service.runStream(app.key)) {
        /* consume unchanged frames */
      }
      return { success: true };
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attempts = [...rows.values()].filter(
      (row) => row.kind === 'provider_attempt',
    );
    expect(attempts).toHaveLength(2);
    expect(
      attempts.every(
        (row) => row.prompt_tokens === null && row.cost_usd === null,
      ),
    ).toBe(true);
    expect(
      prisma.ai_engine_logs.create.mock.calls[0][0].data.usage_observed
        .prompt_tokens,
    ).toBeNull();
  });

  it.each(['openai_compatible', 'anthropic_compatible'] as const)(
    'counts hidden %s SDK HTTP retries without changing SDK retry policy',
    async (sdkType) => {
      const { service, rows, execute, log, subscriptionAccess } = build();
      const payload =
        sdkType === 'openai_compatible'
          ? {
              id: 'qa-completion',
              object: 'chat.completion',
              created: 1,
              model: 'test-model',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'ok' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 20,
                total_tokens: 120,
              },
            }
          : {
              id: 'qa-message',
              type: 'message',
              role: 'assistant',
              model: 'test-model',
              content: [{ type: 'text', text: 'ok' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 20 },
            };
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                type: 'rate_limit_error',
                message: 'rate limited',
              },
            }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'retry-after-ms': '1',
              },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      (service as any).initializeProvider({
        id: 5,
        provider: 'QA',
        sdk_type: sdkType,
        model_id: 'test-model',
        api_key_ref: 'qa-not-real-key',
        settings,
      });
      await execute();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const attempts = [...rows.values()].filter(
        (row) => row.kind === 'provider_attempt',
      );
      expect(attempts).toHaveLength(2);
      expect(attempts.map((row) => row.attributes.attempt_unit)).toEqual([
        'http_request',
        'http_request',
      ]);
      expect(attempts[0]).toMatchObject({
        error_code: 'HTTP_429',
        cost_usd: null,
        prompt_tokens: null,
      });
      expect(attempts[1].cost_usd).toBe(0.14);
      expect(
        [...rows.values()].filter((row) => row.kind === 'provider_call'),
      ).toHaveLength(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(subscriptionAccess.consumeAIQuota).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify([...rows.values()]);
      expect(serialized).not.toMatch(
        /qa-not-real-key|cliente@example|private|same system|api\.openai|Authorization/,
      );
    },
  );
});

describe('AIEngineService D2 opt-in deadlines', () => {
  const app = {
    key: 'd2-read',
    is_active: true,
    config_id: 5,
    temperature: null,
    max_tokens: null,
    ai_feature_category: null,
    retry_config: { maxRetries: 3, delayMs: 1000 },
  };
  let service: AIEngineService;
  let provider: { chat: jest.Mock; complete: jest.Mock; chatStream: jest.Mock };
  let consume: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    service = new AIEngineService(
      {
        ai_engine_applications: {
          findUnique: jest.fn().mockResolvedValue(app),
        },
      } as any,
      { get: jest.fn() } as any,
      {} as any,
      {
        calculateCost: jest.fn().mockReturnValue(0),
        logRequest: jest.fn(),
      } as any,
      { emit: jest.fn() } as any,
      {} as any,
      { isEnforce: () => false } as any,
    );
    provider = { chat: jest.fn(), complete: jest.fn(), chatStream: jest.fn() };
    (service as any).providers.set(5, provider);
    (service as any).defaultConfigId = 5;
    jest
      .spyOn(service as any, 'runSubscriptionGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'checkRateLimit').mockResolvedValue(undefined);
    consume = jest
      .spyOn(service as any, 'consumeSubscriptionQuota')
      .mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('preserves the configured legacy retries when no deadline is supplied', async () => {
    provider.chat
      .mockResolvedValueOnce({ success: false, error: 'transient' })
      .mockResolvedValueOnce({ success: true, content: 'ok' });
    const result = service.run(app.key);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toMatchObject({ success: true });
    expect(provider.chat).toHaveBeenCalledTimes(2);
    expect(provider.chat.mock.calls[0][1]).not.toHaveProperty('signal');
  });

  it('inherits request-local signal/deadline and never retries an aborted in-flight provider', async () => {
    provider.chat.mockImplementation(() => new Promise(() => undefined));
    const deadline = new AgentDeadline({
      wallDeadlineMs: Date.now() + 100,
      activeBudgetMs: 100,
      reserveMs: 20,
    });
    const result = agentDeadlineContext.run(deadline, () =>
      service.run(app.key),
    );
    await jest.advanceTimersByTimeAsync(80);
    await expect(result).resolves.toMatchObject({
      success: false,
      error_code: 'AGENT_DEADLINE_EXCEEDED',
      retryable: false,
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(provider.chat.mock.calls[0][1].signal.aborted).toBe(true);
    expect(consume).not.toHaveBeenCalled();
    deadline.dispose();
  });

  it('stops before a backoff that cannot fit and makes no second provider dispatch', async () => {
    provider.chat.mockResolvedValue({ success: false, error: 'temporary' });
    const result = service.run(app.key, undefined, undefined, {
      deadlineMs: Date.now() + 100,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toMatchObject({
      success: false,
      error_code: 'AGENT_DEADLINE_EXCEEDED',
    });
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it('cancels an existing backoff promptly without a new request', async () => {
    provider.chat.mockResolvedValue({ success: false, error: 'temporary' });
    const controller = new AbortController();
    const result = service.run(app.key, undefined, undefined, {
      signal: controller.signal,
    });
    await jest.advanceTimersByTimeAsync(20);
    controller.abort();
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toMatchObject({
      success: false,
      error_code: 'AGENT_CANCELLED',
      retryable: false,
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(provider.chat).toHaveBeenCalledTimes(1);
  });

  it.each(['chat', 'chatWith', 'complete'] as const)(
    'fences late %s completions without publishing content',
    async (method) => {
      let finish!: (value: any) => void;
      const mock = method === 'complete' ? provider.complete : provider.chat;
      mock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const options = { deadlineMs: Date.now() + 10 };
      const result =
        method === 'chatWith'
          ? service.chatWith(5, [], options)
          : method === 'complete'
            ? service.complete('read', options)
            : service.chat([], options);
      await jest.advanceTimersByTimeAsync(10);
      await expect(result).resolves.toMatchObject({
        success: false,
        error_code: 'AGENT_DEADLINE_EXCEEDED',
      });
      finish({ success: true, content: 'late unauthorized generation' });
      await jest.advanceTimersByTimeAsync(0);
      await expect(result).resolves.not.toHaveProperty('content');
    },
  );

  it('fences stream providers that ignore the signal, with no done or quota consumption', async () => {
    provider.chatStream.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => undefined),
      }),
    });
    const chunks: any[] = [];
    const result = (async () => {
      for await (const chunk of service.runStream(
        app.key,
        undefined,
        undefined,
        { deadlineMs: Date.now() + 10 },
      ))
        chunks.push(chunk);
    })();
    await jest.advanceTimersByTimeAsync(10);
    await result;
    expect(chunks).toEqual([
      { type: 'error', error: 'Agent deadline exceeded' },
    ]);
    expect(consume).not.toHaveBeenCalled();
  });
});
