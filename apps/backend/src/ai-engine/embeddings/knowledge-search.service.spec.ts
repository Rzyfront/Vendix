import { normalizeSearchText } from '../../common/utils/search-text.util';
import { KnowledgeSearchService } from './knowledge-search.service';
import { buildToolDocument } from '../tools/tool-catalog';
const doc = (name: string, description: string) =>
  buildToolDocument({
    name,
    description,
    domain: 'inventory',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  });
const vector = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
describe('KnowledgeSearchService B', () => {
  const env = process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
  let raw: jest.Mock;
  let transaction: jest.Mock;
  let embeddings: any;
  let service: KnowledgeSearchService;
  const docs = [
    doc('find_coffee', 'Busca café de bodega'),
    doc('find_orders', 'Busca órdenes'),
  ];
  const ready = docs.map((d, i) => ({
    id: i + 1,
    document_key: d.key,
    content_hash: d.hash,
    indexed_hash: d.hash,
    embedding_fingerprint: 'model-v1',
  }));
  beforeEach(() => {
    process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED = 'true';
    raw = jest.fn(async (sql: string) =>
      sql.includes('document_key') ? ready : [{ id: 1 }, { id: 2 }],
    );
    transaction = jest.fn((fn) =>
      fn({ $executeRawUnsafe: jest.fn(), $queryRawUnsafe: raw }),
    );
    embeddings = {
      configuration: jest.fn().mockResolvedValue({ fingerprint: 'model-v1' }),
      generate: jest
        .fn()
        .mockResolvedValue({ vector, fingerprint: 'model-v1' }),
    };
    service = new KnowledgeSearchService(
      { $transaction: transaction } as any,
      embeddings,
    );
  });
  afterAll(() => {
    if (env === undefined) delete process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
    else process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED = env;
  });
  it('uses authorized global IDs only, explicit namespaces and parameterized PostgreSQL lexical/vector branches', async () => {
    const query = `café'); SELECT secreto --`;
    const result = await service.rank(query, docs.slice(0, 1), 'tenant1');
    expect(result.names).toEqual(['find_coffee']);
    expect(raw).toHaveBeenCalledTimes(3);
    const [lexicalSql, ids, lexicalQuery] = raw.mock.calls[1];
    expect(lexicalSql).not.toContain(query);
    expect(lexicalQuery).toBe(normalizeSearchText(query));
    expect(lexicalSql).toContain("plainto_tsquery('spanish', $2)");
    expect(lexicalSql).toContain("knowledge_scope = 'global'");
    expect(ids).toEqual([1]);
    const [vectorSql, vectorIds] = raw.mock.calls[2];
    expect(vectorSql).toContain('e.store_id = 0 AND e.organization_id = 0');
    expect(vectorSql).toContain('id = ANY($1::int[])');
    expect(vectorIds).toEqual([1]);
    expect(vectorSql).not.toMatch(/OR\s+.*store_id/);
    expect(transaction.mock.calls[0][1]).toEqual({
      timeout: 500,
      maxWait: 150,
    });
  });
  it('degrades to SQL lexical when vector generation fails', async () => {
    embeddings.generate.mockRejectedValue(new Error('provider down'));
    const result = await service.rank('café', docs, 'tenant');
    expect(result.names[0]).toBe('find_coffee');
    expect(result.degraded).toContain('vector_unavailable');
    expect(raw).toHaveBeenCalledTimes(2);
  });
  it('still uses PostgreSQL lexical with no embedding app configured', async () => {
    embeddings.configuration.mockRejectedValue(new Error('missing app'));
    const result = await service.rank('café', docs, 'tenant');
    expect(result.degraded).toContain('vector_unavailable');
    expect(embeddings.generate).not.toHaveBeenCalled();
    expect(raw).toHaveBeenCalledTimes(2);
  });
  it('falls back locally with missing migration/DB/timeout', async () => {
    transaction.mockRejectedValue(new Error('table missing'));
    const result = await service.rank('café', docs, 's');
    expect(result.names[0]).toBe('find_coffee');
    expect(result.degraded).toContain('index_unavailable');
  });
  it('never queries vector on a wrong dimension, NaN or zero vector', async () => {
    for (const bad of [
      [1, 2],
      [...vector.slice(0, -1), NaN],
      Array(1536).fill(0),
    ]) {
      embeddings.generate.mockResolvedValue({
        vector: bad,
        fingerprint: 'model-v1',
      });
      const result = await service.rank(
        'café',
        docs,
        `s${String(bad[0])}${bad.length}`,
      );
      expect(result.degraded).toContain('vector_unavailable');
    }
    expect(raw.mock.calls.some(([sql]) => sql.includes('<=>'))).toBe(false);
  });
  it('filters stale hashes/retired versions before any ranking SQL', async () => {
    raw.mockResolvedValue(
      ready.map((row) => ({ ...row, indexed_hash: 'stale' })),
    );
    const result = await service.rank('café', docs, 's');
    expect(result.degraded).toContain('index_not_ready');
    expect(embeddings.generate).not.toHaveBeenCalled();
  });
  it('does not mix embedding models/fingerprints', async () => {
    embeddings.configuration.mockResolvedValue({ fingerprint: 'model-v2' });
    const result = await service.rank('café', docs, 's');
    expect(result.degraded).toContain('vector_unavailable');
    expect(embeddings.generate).not.toHaveBeenCalled();
  });
  it('caches one intention embedding and invalidates by authority, query, schema and model', async () => {
    await service.rank('café', docs, 'store1');
    expect((await service.rank('café', docs, 'store1')).cacheHit).toBe(true);
    expect(embeddings.generate).toHaveBeenCalledTimes(1);
    await service.rank('café', docs.slice(0, 1), 'store1');
    await service.rank('café', docs, 'store2');
    await service.rank('orden', docs, 'store1');
    expect(embeddings.generate).toHaveBeenCalledTimes(4);
    const keys = [...(service as any).cache.keys()];
    expect(keys.every((k) => /^[a-f0-9]{64}$/.test(k))).toBe(true);
  });
  it('expires selection cache after five minutes', async () => {
    const time = jest.spyOn(Date, 'now').mockReturnValue(1);
    try {
      await service.rank('café', docs, 's');
      time.mockReturnValue(300002);
      await service.rank('café', docs, 's');
      expect(embeddings.generate).toHaveBeenCalledTimes(2);
    } finally {
      time.mockRestore();
    }
  });
  it('does not read DB or providers with flags OFF', async () => {
    delete process.env.AI_TOOL_KNOWLEDGE_INDEX_ENABLED;
    expect((await service.rank('café', docs, 's')).names[0]).toBe(
      'find_coffee',
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(embeddings.configuration).not.toHaveBeenCalled();
  });
  it('uses exact canonical/alias fast path with zero DB or embedding calls', async () => {
    const result = await service.rank('find_coffee', docs, 's');
    expect(result.names[0]).toBe('find_coffee');
    expect(transaction).not.toHaveBeenCalled();
    expect(embeddings.configuration).not.toHaveBeenCalled();
  });
});
