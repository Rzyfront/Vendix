import { HelpKnowledgeIndexerService } from './help-knowledge-indexer.service';

export interface FakeDoc {
  id: number;
  document_key: string;
  entity_type: string;
  content: string;
  lexical_text: string;
  metadata: Record<string, unknown>;
  release_hash: string;
  status: string;
  active: boolean;
  content_hash: string;
  indexed_hash: string | null;
  embedding_fingerprint: string | null;
}

/** In-memory ai_knowledge_documents + the minimum of the other delegates the indexer reads. */
export function buildIndexerHarness(seed: {
  articles?: Array<Record<string, unknown>>;
  videos?: Array<Record<string, unknown>>;
}) {
  const docs: FakeDoc[] = [];
  let nextId = 1;
  const matches = (doc: FakeDoc, where: Record<string, any> = {}) =>
    Object.entries(where).every(([field, cond]) => {
      const value = (doc as any)[field];
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('startsWith' in cond && !String(value).startsWith(cond.startsWith)) return false;
        if ('notIn' in cond && cond.notIn.includes(value)) return false;
        if ('in' in cond && !cond.in.includes(value)) return false;
        if ('not' in cond && value === cond.not) return false;
        return true;
      }
      return value === cond || (cond === null && value === undefined);
    });
  const prisma: any = {
    ai_knowledge_documents: {
      findUnique: jest.fn(async ({ where }) => docs.find((d) => d.document_key === where.document_key) ?? null),
      findMany: jest.fn(async ({ where }) => docs.filter((d) => matches(d, where))),
      upsert: jest.fn(async ({ where, create, update }) => {
        const found = docs.find((d) => d.document_key === where.document_key);
        if (found) return Object.assign(found, update);
        const doc = { id: nextId++, ...create } as FakeDoc;
        docs.push(doc);
        return doc;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const rows = docs.filter((d) => matches(d, where));
        rows.forEach((d) => Object.assign(d, data));
        return { count: rows.length };
      }),
    },
    help_articles: {
      findUnique: jest.fn(async ({ where }) => seed.articles?.find((a) => a.id === where.id) ?? null),
      findMany: jest.fn(async () => seed.articles?.filter((a) => a.status === 'PUBLISHED') ?? []),
    },
    videos: {
      findUnique: jest.fn(async ({ where }) => seed.videos?.find((v) => v.id === where.id) ?? null),
      findMany: jest.fn(async () => seed.videos?.filter((v) => v.status === 'PUBLISHED') ?? []),
    },
    video_series: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    video_series_items: { findMany: jest.fn(async () => []) },
    $queryRawUnsafe: jest.fn(async () => []),
  };
  const embeddings = { storeGlobalKnowledgeEmbedding: jest.fn(async () => undefined) };
  const knowledgeEmbeddings = {
    configuration: jest.fn(async () => ({ appKey: 'k', model: 'm', fingerprint: 'fp1' })),
    generate: jest.fn(async () => ({ vector: [0.1], fingerprint: 'fp1' })),
  };
  const service = new HelpKnowledgeIndexerService(prisma, embeddings as any, knowledgeEmbeddings as any);
  return { service, docs, prisma, embeddings, knowledgeEmbeddings };
}
