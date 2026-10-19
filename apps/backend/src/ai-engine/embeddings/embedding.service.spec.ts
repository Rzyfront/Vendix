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
    expect((service as any).openai.embeddings.create).not.toHaveBeenCalled();
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

    const caught = await service.generateEmbedding('hello').then(
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

    const caught = await service.generateEmbedding('hello').then(
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

describe('EmbeddingService B namespace isolation', () => {
  let prisma: any;
  let service: EmbeddingService;
  let knowledge: any;
  const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
  beforeEach(() => {
    prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      ai_knowledge_documents: {
        findFirst: jest.fn().mockResolvedValue({ content: 'synthetic doc' }),
      },
      ai_embeddings: { deleteMany: jest.fn() },
    };
    knowledge = {
      generate: jest.fn().mockResolvedValue({ vector, fingerprint: 'model' }),
    };
    service = new EmbeddingService(
      prisma,
      { get: () => undefined } as any,
      { runEmbedding: jest.fn() } as any,
      knowledge,
    );
  });
  afterAll(() => {});
  it.each([0, -1, NaN, undefined])(
    'never accepts store sentinel %s through StoreEmbeddingParams',
    async (storeId) => {
      await expect(
        service.storeEmbedding({
          store_id: storeId as number,
          organization_id: 7,
          entity_id: 1,
          entity_type: 'product',
          content: 'x',
        }),
      ).rejects.toThrow();
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(knowledge.generate).not.toHaveBeenCalled();
    },
  );
  it('rejects knowledge types through the business path and never deletes globals', async () => {
    await expect(
      service.storeEmbedding({
        store_id: 1,
        organization_id: 7,
        entity_id: 1,
        entity_type: 'tool',
        content: 'x',
      }),
    ).rejects.toThrow('BUSINESS_ENTITY');
    await expect(service.deleteEmbedding(0, 'tool', 1)).rejects.toThrow();
    expect(prisma.ai_embeddings.deleteMany).not.toHaveBeenCalled();
  });
  it('filters business search by store AND organization AND scope with no global union', async () => {
    const { RequestContextService } =
      await import('../../common/context/request-context.service');
    await RequestContextService.runIsolated(
      {
        store_id: 4,
        organization_id: 7,
        is_owner: false,
        is_super_admin: false,
      },
      async () => {
        await service.searchSimilar({ store_id: 4, query_embedding: vector });
      },
    );
    const [sql, _vector, store, org, types] =
      prisma.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain(
      "knowledge_scope = 'store' AND store_id = $2 AND organization_id = $3",
    );
    expect(sql).not.toMatch(/OR\s+.*store_id/);
    expect([store, org]).toEqual([4, 7]);
    expect(types).not.toContain('tool');
  });
  it('rejects missing/mismatched ALS or knowledge entity filters BEFORE provider/query', async () => {
    const { RequestContextService } =
      await import('../../common/context/request-context.service');
    await expect(service.searchByText(0, 'x')).rejects.toThrow();
    await RequestContextService.runIsolated(
      {
        store_id: 4,
        organization_id: 7,
        is_owner: false,
        is_super_admin: false,
      },
      async () => {
        await expect(
          service.searchSimilar({ store_id: 5, query_embedding: vector }),
        ).rejects.toThrow('MISMATCH');
        await expect(
          service.searchSimilar({
            store_id: 4,
            entity_types: ['tool'],
            query_embedding: vector,
          }),
        ).rejects.toThrow('BUSINESS_ENTITY');
      },
    );
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
  it('inserts global docs using a distinct internal path and a stable integer document ID', async () => {
    await service.storeGlobalKnowledgeEmbedding({
      documentId: 9,
      type: 'tool',
      content: 'synthetic doc',
      hash: 'hash',
      fingerprint: 'model',
    });
    const [sql, type, _vector, metadata, id] =
      prisma.$executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("SELECT 'global', 0, 0");
    expect(sql).toContain("ai_embeddings.knowledge_scope = 'global'");
    expect(type).toBe('tool');
    expect(id).toBe(9);
    expect(JSON.parse(metadata)).toEqual({
      content_hash: 'hash',
      fingerprint: 'model',
    });
  });
  it('rejects incompatible dimension and changed documents before INSERT', async () => {
    knowledge.generate.mockResolvedValue({ vector: [1], fingerprint: 'model' });
    await expect(
      service.storeGlobalKnowledgeEmbedding({
        documentId: 9,
        type: 'tool',
        content: 'synthetic doc',
        hash: 'h',
        fingerprint: 'model',
      }),
    ).rejects.toThrow('VECTOR_INCOMPATIBLE');
    prisma.ai_knowledge_documents.findFirst.mockResolvedValue(null);
    await expect(
      service.storeGlobalKnowledgeEmbedding({
        documentId: 9,
        type: 'tool',
        content: 'synthetic doc',
        hash: 'h',
        fingerprint: 'model',
      }),
    ).rejects.toThrow('DOCUMENT_CHANGED');
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
  it('does not mark an empty CAS insertion successful', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(0);
    await expect(
      service.storeGlobalKnowledgeEmbedding({
        documentId: 9,
        type: 'tool',
        content: 'synthetic doc',
        hash: 'h',
        fingerprint: 'model',
      }),
    ).rejects.toThrow('DOCUMENT_CHANGED');
  });
});
