import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { RequestContextService } from '../../common/context/request-context.service';
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
describe('KnowledgeEmbeddingService: metered platform-only embeddings', () => {
  const env = process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
  let engine: any;
  let redis: any;
  let settings: Record<string, string>;
  let service: KnowledgeEmbeddingService;
  let app: any;
  beforeEach(() => {
    process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED = 'true';
    settings = { AI_KNOWLEDGE_DAILY_TOKEN_BUDGET: '100000' };
    app = {
      is_active: true,
      model_type: 'embedding',
      ai_feature_category: 'rag_embeddings',
      config: { id: 4, model_id: 'text-embedding-3-small' },
    };
    engine = {
      getApplication: jest.fn().mockResolvedValue(app),
      runEmbedding: jest.fn().mockResolvedValue({
        success: true,
        embedding: vector,
        model: 'text-embedding-3-small',
      }),
    };
    redis = { eval: jest.fn().mockResolvedValue(1) };
    service = new KnowledgeEmbeddingService(
      { get: (k: string) => settings[k] } as any,
      engine,
      redis,
    );
  });
  afterAll(() => {
    if (env === undefined) delete process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
    else process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED = env;
  });
  it('runs the separate app with platform ALS, no tenant0 and no tenant quota, preserving the outer context', async () => {
    engine.runEmbedding.mockImplementation(async () => {
      const context = RequestContextService.asyncLocalStorage.getStore();
      expect(context?.store_id).toBeUndefined();
      expect(context?.organization_id).toBeUndefined();
      expect(context?.request_id).toMatch(/^platform-knowledge-/);
      return {
        success: true,
        embedding: vector,
        model: 'text-embedding-3-small',
      };
    });
    await RequestContextService.runIsolated(
      {
        store_id: 8,
        organization_id: 9,
        user_id: 10,
        is_owner: true,
        is_super_admin: false,
      },
      async () => {
        await service.generate('catálogo');
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.store_id,
        ).toBe(8);
      },
    );
    expect(engine.runEmbedding).toHaveBeenCalledWith(
      'agent_knowledge_embeddings',
      undefined,
      'catálogo',
    );
    expect(redis.eval.mock.calls[0][2]).toMatch(
      /ai:knowledge:spend-reservation:.*:\d{8}$/,
    );
    expect(redis.eval.mock.calls[0][3]).toBe(Buffer.byteLength('catálogo'));
  });
  it.each(['0', '-1', 'bad', '1.5'])(
    'does not spend with invalid/unapproved budget %s',
    async (budget) => {
      settings.AI_KNOWLEDGE_DAILY_TOKEN_BUDGET = budget;
      await expect(service.generate('x')).rejects.toThrow('BUDGET_UNAVAILABLE');
      expect(engine.runEmbedding).not.toHaveBeenCalled();
    },
  );
  it('fails closed when budget is exhausted or Redis is unavailable', async () => {
    redis.eval.mockResolvedValue(0);
    await expect(service.generate('x')).rejects.toThrow('BUDGET_EXHAUSTED');
    redis.eval.mockRejectedValue(new Error('redis'));
    await expect(service.generate('x')).rejects.toThrow('redis');
    expect(engine.runEmbedding).not.toHaveBeenCalled();
  });
  it('rejects product apps and non-embedding app categories', async () => {
    settings.AI_KNOWLEDGE_EMBEDDING_APP_KEY = 'product_embeddings';
    await expect(service.generate('x')).rejects.toThrow('MUST_BE_SEPARATE');
    delete settings.AI_KNOWLEDGE_EMBEDDING_APP_KEY;
    app.ai_feature_category = 'text_generation';
    await expect(service.generate('x')).rejects.toThrow('INCOMPATIBLE');
    expect(engine.runEmbedding).not.toHaveBeenCalled();
  });
  it.each(['config', 'model', 'response', 'dimension'])(
    'rejects incompatible %s and never uses a direct SDK',
    async (kind) => {
      if (kind === 'config') app.config = null;
      if (kind === 'model') app.config.model_id = 'other';
      if (kind === 'response')
        engine.runEmbedding.mockResolvedValue({
          success: true,
          model: 'other',
          embedding: vector,
        });
      if (kind === 'dimension')
        engine.runEmbedding.mockResolvedValue({
          success: true,
          model: 'text-embedding-3-small',
          embedding: [1],
        });
      await expect(service.generate('x')).rejects.toThrow();
    },
  );
  it('rejects changed fingerprints before dispatch and after in-flight config drift', async () => {
    await expect(service.generate('x', 'old')).rejects.toThrow(
      'FINGERPRINT_CHANGED',
    );
    expect(engine.runEmbedding).not.toHaveBeenCalled();
    engine.runEmbedding.mockImplementation(async () => {
      app.config.id = 22;
      return {
        success: true,
        embedding: vector,
        model: 'text-embedding-3-small',
      };
    });
    await expect(service.generate('x')).rejects.toThrow('FINGERPRINT_CHANGED');
  });
  it('makes no engine call with index disabled', async () => {
    delete process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
    await expect(service.generate('x')).rejects.toThrow('INDEX_DISABLED');
    expect(engine.getApplication).not.toHaveBeenCalled();
  });
  it('separates platform tracing from a caller tenant trace without fabricating a successful business outcome', async () => {
    const root = { kind: 'root' };
    const trace = {
      startTrace: jest.fn(() => root),
      run: jest.fn((_root, work) => work()),
      finishTrace: jest.fn(),
    };
    service = new KnowledgeEmbeddingService(
      { get: (k: string) => settings[k] } as any,
      engine,
      redis,
      trace as any,
    );
    await service.generate('sintético');
    expect(trace.startTrace.mock.calls[0][0]).toMatchObject({
      kind: 'system',
      system_purpose: 'platform_knowledge',
    });
    expect(trace.startTrace.mock.calls[0][0]).not.toHaveProperty('store_id');
    expect(trace.finishTrace).toHaveBeenCalledWith(root, 'partial');
  });
});
