import { AIEngineService } from './ai-engine.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';
import { RequestContextService } from '../common/context/request-context.service';

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
      { canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }) } as any,
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
      { canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }) } as any,
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
      { canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }) } as any,
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
    for await (const chunk of service.runImageStream('product_image_enhancer')) {
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
    for await (const chunk of service.runImageStream('product_image_enhancer')) {
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
      { canUseAIFeature: jest.fn().mockResolvedValue({ allowed: true }) } as any,
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
      expect.objectContaining({ cache_read_tokens: 7, cache_creation_tokens: 9 }),
    );

    (service as any).logApplicationRequest({
      appKey: 'a',
      configId: null,
      response: { usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
      status: 'success',
      startTime: Date.now(),
    });
    expect(aiLogging.logRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ cache_read_tokens: 0, cache_creation_tokens: 0 }),
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
      { calculateCost: jest.fn().mockReturnValue(0), logRequest: jest.fn() } as any,
      { emit: jest.fn() } as any,
      subscriptionAccess as any,
      { isEnforce: jest.fn().mockReturnValue(false) } as any,
    );
    jest.spyOn(service as any, 'runSubscriptionGate').mockResolvedValue(undefined);
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
    jest.spyOn(service as any, 'resolveApplicationExecution').mockResolvedValue({
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
