import { AIEngineService } from './ai-engine.service';
import { VendixHttpException, ErrorCodes } from '../common/errors';

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