import { ToolCatalogIndexerService } from './tool-catalog-indexer.service';
import { AIToolRegistry } from './ai-tool-registry';
import { AIEmbeddingProcessor } from '../queue/processors/ai-embedding.processor';
import { RequestContextService } from '../../common/context/request-context.service';
const tool = (name: string, version = '1') => ({
  name,
  version,
  domain: 'orders',
  description: `Consulta sintética ${name}`,
  parameters: { type: 'object', properties: {} },
  readOnly: true,
});
describe('ToolCatalogIndexerService B', () => {
  let registry: AIToolRegistry;
  let prisma: any;
  let queue: any;
  let embeddings: any;
  let knowledge: any;
  let service: ToolCatalogIndexerService;
  let rows: Map<string, any>;
  beforeEach(() => {
    rows = new Map();
    registry = new AIToolRegistry({} as any);
    prisma = {
      ai_knowledge_documents: {
        findUnique: jest.fn(async ({ where }) => rows.get(where.document_key)),
        upsert: jest.fn(async ({ create, update, where }) => {
          const row = rows.get(where.document_key);
          const next = row
            ? { ...row, ...update }
            : { ...create, id: rows.size + 1 };
          rows.set(where.document_key, next);
          return next;
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          for (const row of rows.values())
            if (
              where.id === row.id &&
              where.content_hash === row.content_hash &&
              where.release_hash === row.release_hash
            )
              Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };
    queue = { add: jest.fn(), getJob: jest.fn().mockResolvedValue(undefined) };
    embeddings = { storeGlobalKnowledgeEmbedding: jest.fn() };
    knowledge = {
      configuration: jest.fn().mockResolvedValue({ fingerprint: 'model-v1' }),
    };
    service = new ToolCatalogIndexerService(
      registry,
      prisma,
      embeddings,
      knowledge,
      queue,
    );
  });
  afterAll(() => {});
  it('waits until all module-init factories registered, snapshots complete catalog in batches ≤50', async () => {
    registry.register(tool('early'));
    await service.enqueueSnapshot();
    expect(queue.add).not.toHaveBeenCalled();
    for (let i = 0; i < 105; i++) registry.register(tool(`late_${i}`));
    await service.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(3);
    expect(queue.add.mock.calls.map(([, job]) => job.documents.length)).toEqual(
      [50, 50, 6],
    );
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
    });
    const manifest = service.getReleaseManifest();
    expect(manifest.documents).toHaveLength(106);
    expect(
      prisma.ai_knowledge_documents.updateMany.mock.calls[0][0].where,
    ).toMatchObject({ knowledge_scope: 'global', entity_type: 'tool' });
  });
  it('re-enqueues a batch whose deterministic jobId is stuck as failed, keeps live ones', async () => {
    registry.register(tool('list_orders'));
    const failed = {
      isFailed: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValueOnce(failed);
    await service.onApplicationBootstrap();
    expect(failed.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const live = {
      isFailed: jest.fn().mockResolvedValue(false),
      remove: jest.fn(),
    };
    queue.getJob.mockResolvedValueOnce(live);
    await service.enqueueSnapshot();
    expect(live.remove).not.toHaveBeenCalled();
    expect(queue.getJob.mock.calls[0][0]).toBe(
      queue.add.mock.calls[0][2].jobId,
    );
  });
  it('is idempotent by stable document key/hash and model fingerprint', async () => {
    registry.register(tool('list_orders'));
    await service.onApplicationBootstrap();
    const job = queue.add.mock.calls[0][1];
    await service.indexBatch(job);
    await service.indexBatch(job);
    expect(rows.size).toBe(1);
    expect(embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledTimes(1);
    expect([...rows.values()][0]).toMatchObject({
      status: 'ready',
      active: true,
      indexed_hash: service.getReleaseManifest().documents[0].hash,
    });
  });
  it('invalidates schema/alias/description changes and rejects stale/forged queue jobs', async () => {
    registry.register(tool('list_orders'));
    await service.onApplicationBootstrap();
    const old = queue.add.mock.calls[0][1];
    registry.registerAlias('orders_old', 'list_orders');
    await expect(service.indexBatch(old)).rejects.toThrow(
      'STALE_KNOWLEDGE_RELEASE',
    );
    const manifest = service.getReleaseManifest();
    await expect(
      service.indexBatch({
        release_hash: manifest.hash,
        documents: [{ key: 'tool:fake:1', hash: 'x' }],
      }),
    ).rejects.toThrow('INVALID_KNOWLEDGE_JOB');
    expect(embeddings.storeGlobalKnowledgeEmbedding).not.toHaveBeenCalled();
  });
  it('logically retires removed tools from a FULL snapshot, not a batch', async () => {
    registry.register(tool('list_orders'));
    registry.register(tool('retired'));
    await service.onApplicationBootstrap();
    registry.removeTool('retired');
    await service.enqueueSnapshot();
    const where = prisma.ai_knowledge_documents.updateMany.mock.calls
      .filter(([a]) => a.where.entity_type === 'tool')
      .at(-1)[0].where;
    expect(where.canonical_name.notIn).toEqual(['list_orders']);
    expect(where).not.toHaveProperty('document_key');
  });
  it('activates a new version only after embedding ready and retires old versions logically', async () => {
    registry.register(tool('list_orders', '2'));
    await service.onApplicationBootstrap();
    const job = queue.add.mock.calls[0][1];
    embeddings.storeGlobalKnowledgeEmbedding.mockImplementation(async () => {
      expect([...rows.values()][0]).toMatchObject({
        active: true,
        status: 'ready',
      });
    });
    await service.indexBatch(job);
    const retirement = prisma.ai_knowledge_documents.updateMany.mock.calls.find(
      ([arg]) => arg.where.version,
    )?.[0];
    expect(retirement).toMatchObject({
      where: { version: { not: '2' }, canonical_name: 'list_orders' },
      data: { active: false, status: 'retired' },
    });
  });
  it('does not retire newer versions when the embedding publication loses its CAS', async () => {
    registry.register(tool('list_orders', '2'));
    await service.onApplicationBootstrap();
    prisma.ai_knowledge_documents.updateMany.mockImplementation(
      async ({ where }) => ({
        count: where.id && where.status === 'ready' ? 0 : 1,
      }),
    );
    await service.indexBatch(queue.add.mock.calls[0][1]);
    expect(
      prisma.ai_knowledge_documents.updateMany.mock.calls.some(
        ([arg]) => arg.where.version,
      ),
    ).toBe(false);
  });
  it('keeps lexical catalog active on embedding failure without leaking errors', async () => {
    registry.register(tool('list_orders'));
    await service.onApplicationBootstrap();
    embeddings.storeGlobalKnowledgeEmbedding.mockRejectedValue(
      new Error('private secret'),
    );
    await expect(
      service.indexBatch(queue.add.mock.calls[0][1]),
    ).resolves.toBeUndefined();
    expect([...rows.values()][0]).toMatchObject({
      status: 'ready',
      active: true,
      embedding_fingerprint: null,
      error_code: 'KNOWLEDGE_INDEX_FAILED',
    });
    expect(JSON.stringify([...rows.values()])).not.toContain('private secret');
  });
  it('automatically enqueues at bootstrap and rejects stale jobs', async () => {
    registry.register(tool('list_orders'));
    const manifest = service.getReleaseManifest();
    await expect(
      service.indexBatch({ release_hash: manifest.hash, documents: [] }),
    ).rejects.toThrow('BOOT_BARRIER');
    expect(queue.add).not.toHaveBeenCalled();
    await service.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalled();
    await expect(
      service.indexBatch({ release_hash: 'x', documents: [] }),
    ).rejects.toThrow('STALE_KNOWLEDGE_RELEASE');
  });
  it('safe bootstrap failures leave the local catalog available', async () => {
    registry.register(tool('list_orders'));
    prisma.ai_knowledge_documents.updateMany.mockRejectedValue(
      new Error('migration absent'),
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(service.isBootstrapped()).toBe(true);
    expect(service.getReleaseManifest().documents).toHaveLength(1);
  });
  it('worker dispatches index-knowledge without fabricating context/store0 or touching business embedding', async () => {
    const indexBatch = jest.fn(async () =>
      expect(
        RequestContextService.asyncLocalStorage.getStore()?.store_id,
      ).toBeUndefined(),
    );
    const storeEmbedding = jest.fn();
    const worker = new AIEmbeddingProcessor(
      { storeEmbedding } as any,
      { indexBatch } as any,
    );
    const job = { release_hash: 'release', documents: [] };
    await worker.process({ name: 'index-knowledge', data: job } as any);
    expect(indexBatch).toHaveBeenCalledWith(job);
    expect(storeEmbedding).not.toHaveBeenCalled();
    await expect(
      worker.process({ name: 'arbitrary', data: {} } as any),
    ).rejects.toThrow('UNKNOWN_EMBEDDING_JOB');
  });
  it('resolves the new production provider graph with Nest DI and mocked external boundaries (no init/DB)', async () => {
    const { Test } = await import('@nestjs/testing');
    const { getQueueToken } = await import('@nestjs/bullmq');
    const { ConfigService } = await import('@nestjs/config');
    const { GlobalPrismaService } =
      await import('../../prisma/services/global-prisma.service');
    const { AIEngineService } = await import('../ai-engine.service');
    const { EmbeddingService } =
      await import('../embeddings/embedding.service');
    const { KnowledgeEmbeddingService } =
      await import('../embeddings/knowledge-embedding.service');
    const { KnowledgeSearchService } =
      await import('../embeddings/knowledge-search.service');
    const { ToolRouterService } = await import('./tool-router.service');
    const { REDIS_CLIENT } = await import('../../common/redis/redis.module');
    const { VexiConfirmationService } =
      await import('../../domains/store/vexi/vexi-confirmation.service');
    const module = await Test.createTestingModule({
      providers: [
        ToolCatalogIndexerService,
        AIToolRegistry,
        EmbeddingService,
        KnowledgeEmbeddingService,
        KnowledgeSearchService,
        ToolRouterService,
        AIEmbeddingProcessor,
        { provide: GlobalPrismaService, useValue: prisma },
        { provide: AIEngineService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: REDIS_CLIENT, useValue: {} },
        { provide: VexiConfirmationService, useValue: {} },
        { provide: getQueueToken('ai-embedding'), useValue: queue },
      ],
    }).compile();
    try {
      expect(module.get(ToolRouterService)).toBeInstanceOf(ToolRouterService);
      expect((module.get(AIEmbeddingProcessor) as any).knowledgeIndexer).toBe(
        module.get(ToolCatalogIndexerService),
      );
      expect(prisma.ai_knowledge_documents.upsert).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });
  it('keeps migration additive/idempotent by inspection, without pretending this is QA double-apply', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../prisma/migrations/20261018100000_ai_tool_knowledge_catalog/migration.sql',
      ),
      'utf8',
    );
    const commands = sql.replace(/--[^\n]*/g, '');
    expect(sql).toContain('DATA IMPACT:');
    expect(commands).not.toMatch(/\b(?:TRUNCATE|DROP|DELETE|CASCADE)\b/i);
    expect(commands).not.toMatch(/\bUPDATE\s+\w+\s+SET/i);
    expect(commands).toContain('ADD COLUMN IF NOT EXISTS knowledge_scope');
    expect(commands).toContain(
      "conname = 'ai_embeddings_knowledge_scope_check'",
    );
    expect(commands).toContain(
      "knowledge_scope = 'global' AND store_id = 0 AND organization_id = 0",
    );
    expect(commands).toContain('NOT VALID');
    expect(commands).not.toMatch(/RAISE EXCEPTION/);
  });
  it('C indexes section documents as global process on the same queue and retires removed process sections', async () => {
    registry.register(tool('list_orders'));
    const doc = {
      key: 'process:cerrar-caja:1:steps',
      name: 'cerrar-caja:steps',
      version: '1',
      domain: 'playbooks',
      hash: 'a'.repeat(64),
      content: 'Cerrar caja con conteo explícito',
      lexicalText: 'cerrar caja conteo',
      aliases: [],
      dependencies: [],
      metadata: { entity_type: 'process' },
    };
    const playbooks = {
      getKnowledgeManifest: jest.fn(() => ({
        hash: 'process-release',
        documents: [doc],
      })),
    };
    const loader = {
      initializeRelease: jest.fn().mockResolvedValue(undefined),
    };
    service = new ToolCatalogIndexerService(
      registry,
      prisma,
      embeddings,
      knowledge,
      queue,
      playbooks as any,
      loader as any,
    );
    await service.onApplicationBootstrap();
    expect(loader.initializeRelease).toHaveBeenCalledTimes(1);
    const job = queue.add.mock.calls[0][1];
    await service.indexBatch(job);
    expect(embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'process',
        documentId: expect.any(Number),
      }),
    );
    expect(rows.get(doc.key)).toMatchObject({
      entity_type: 'process',
      knowledge_scope: 'global',
      store_id: null,
      organization_id: null,
      active: true,
    });
    playbooks.getKnowledgeManifest.mockReturnValue({
      hash: 'off',
      documents: [],
    });
    prisma.ai_knowledge_documents.updateMany.mockClear();
    await service.enqueueSnapshot();
    expect(
      prisma.ai_knowledge_documents.updateMany.mock.calls.some(
        ([arg]) => arg.where.entity_type === 'process',
      ),
    ).toBe(true);
    await expect(service.indexBatch(job)).rejects.toThrow(
      'STALE_KNOWLEDGE_RELEASE',
    );
  });
});

it('indexes lexical documents automatically when the embedding app is unavailable', async () => {
  const registry = new AIToolRegistry({} as any);
  registry.register(tool('list_orders'));
  const upsert = jest.fn(async ({ create }) => ({ id: 1, ...create }));
  const service = new ToolCatalogIndexerService(
    registry,
    {
      ai_knowledge_documents: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        upsert,
      },
    } as any,
    { storeGlobalKnowledgeEmbedding: jest.fn() } as any,
    {
      configuration: jest.fn().mockRejectedValue(new Error('absent app')),
    } as any,
    { add: jest.fn(), getJob: jest.fn().mockResolvedValue(undefined) } as any,
  );
  await service.onApplicationBootstrap();
  const manifest = service.getReleaseManifest();
  await expect(
    service.indexBatch({
      release_hash: manifest.hash,
      documents: manifest.documents.map((d) => ({ key: d.key, hash: d.hash })),
    }),
  ).resolves.toBeUndefined();
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      create: expect.objectContaining({
        active: true,
        status: 'ready',
        embedding_fingerprint: null,
      }),
    }),
  );
});
