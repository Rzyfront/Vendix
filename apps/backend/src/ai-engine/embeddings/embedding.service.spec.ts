import { EmbeddingService } from './embedding.service';
import { VendixHttpException, ErrorCodes } from '../../common/errors';

describe('EmbeddingService routing (EMBEDDING_APP_KEY vs direct SDK)', () => {
  const EMBEDDING = [0.1, 0.2, 0.3];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['EMBEDDING_APP_KEY', 'OPENAI_API_KEY']) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ['EMBEDDING_APP_KEY', 'OPENAI_API_KEY']) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    jest.restoreAllMocks();
  });

  const buildService = (appKey: string | null = null) => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'EMBEDDING_APP_KEY') return appKey;
        return undefined;
      }),
    } as any;
    const aiEngine = { runEmbedding: jest.fn() } as any;
    const service = new EmbeddingService({} as any, configService, aiEngine);
    return { service, aiEngine };
  };

  it('routes through aiEngine.runEmbedding when EMBEDDING_APP_KEY is set', async () => {
    const { service, aiEngine } = buildService('emb-app');
    (service as any).openai = { embeddings: { create: jest.fn() } };
    aiEngine.runEmbedding.mockResolvedValue({
      success: true,
      embedding: EMBEDDING,
    });

    const result = await service.generateEmbedding('hello world');

    expect(result).toEqual(EMBEDDING);
    expect(aiEngine.runEmbedding).toHaveBeenCalledWith(
      'emb-app',
      undefined,
      'hello world',
    );
    expect(
      (service as any).openai.embeddings.create,
    ).not.toHaveBeenCalled();
  });

  it('truncates the app-route input to 8000 chars', async () => {
    const { service, aiEngine } = buildService('emb-app');
    aiEngine.runEmbedding.mockResolvedValue({
      success: true,
      embedding: EMBEDDING,
    });

    await service.generateEmbedding('a'.repeat(9000));

    const input = aiEngine.runEmbedding.mock.calls[0][2] as string;
    expect(input).toHaveLength(8000);
  });

  it('routes through the default product_embeddings app when no env key is set', async () => {
    const { service, aiEngine } = buildService(null);
    aiEngine.runEmbedding.mockResolvedValue({
      success: true,
      embedding: EMBEDDING,
    });

    const result = await service.generateEmbedding('hello world');

    expect(result).toEqual(EMBEDDING);
    expect(aiEngine.runEmbedding).toHaveBeenCalledWith(
      'product_embeddings',
      undefined,
      'hello world',
    );
  });

  it('falls back to the direct SDK when the app is missing and SDK is configured', async () => {
    const { service, aiEngine } = buildService(null);
    const create = jest.fn().mockResolvedValue({
      data: [{ embedding: EMBEDDING }],
    });
    (service as any).openai = { embeddings: { create } };
    aiEngine.runEmbedding.mockRejectedValue(
      new VendixHttpException(ErrorCodes.AI_APP_001),
    );

    const result = await service.generateEmbedding('hello world');

    expect(result).toEqual(EMBEDDING);
    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: 'hello world',
    });
  });

  it('throws AI_EMBED_001 when the app fails and no SDK is configured', async () => {
    const { service } = buildService(null);
    (service as any).openai = null;

    await expect(service.generateEmbedding('hello')).rejects.toMatchObject({
      errorCode: 'AI_EMBED_001',
    });
  });

  it('propagates typed engine errors with their own code untouched', async () => {
    const { service } = buildService('emb-app');
    const typed = new VendixHttpException(ErrorCodes.AI_APP_003);
    (service as any).aiEngine.runEmbedding.mockRejectedValue(typed);

    const caught = await service
      .generateEmbedding('hello')
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(caught).toBe(typed);
    await expect(service.generateEmbedding('hello')).rejects.toMatchObject({
      errorCode: 'AI_APP_003',
    });
  });

  it('maps an engine success:false response to AI_EMBED_001', async () => {
    const { service } = buildService('emb-app');
    (service as any).aiEngine.runEmbedding.mockResolvedValue({
      success: false,
      error: 'Embeddings not supported by this provider',
    });

    await expect(service.generateEmbedding('hello')).rejects.toMatchObject({
      errorCode: 'AI_EMBED_001',
    });
  });

  it('maps a raw engine failure to AI_EMBED_001 instead of leaking it', async () => {
    const { service } = buildService('emb-app');
    (service as any).aiEngine.runEmbedding.mockRejectedValue(
      new Error('socket hang up'),
    );

    const caught = await service
      .generateEmbedding('hello')
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(caught).toBeInstanceOf(VendixHttpException);
    expect(caught).toMatchObject({ errorCode: 'AI_EMBED_001' });
  });

  describe('isAvailable', () => {
    it('is false when neither EMBEDDING_APP_KEY nor the SDK is configured', () => {
      const { service } = buildService(null);
      (service as any).openai = null;

      expect(service.isAvailable()).toBe(false);
    });

    it('is true when EMBEDDING_APP_KEY is set', () => {
      const { service } = buildService('emb-app');
      (service as any).openai = null;

      expect(service.isAvailable()).toBe(true);
    });

    it('is true when only the direct SDK is configured', () => {
      const { service } = buildService(null);
      (service as any).openai = { embeddings: { create: jest.fn() } };

      expect(service.isAvailable()).toBe(true);
    });

    it('ignores the silent product_embeddings default without explicit config', () => {
      const { service } = buildService(null);
      (service as any).openai = null;

      // generateEmbedding still attempts the default app route...
      expect((service as any).resolveEmbeddingAppKey()).toBe(
        'product_embeddings',
      );
      // ...but the gate must not report the route as configured.
      expect(service.isAvailable()).toBe(false);
    });
  });
});
