import {
  chunkArticle,
  HelpKnowledgeIndexerService,
} from './help-knowledge-indexer.service';
import { buildIndexerHarness } from './help-knowledge-indexer.testing';

const article = (over: Record<string, unknown> = {}) => ({
  id: 7,
  title: 'Cómo hacer un cierre de caja',
  slug: 'como-hacer-un-cierre-de-caja',
  summary: 'Paso a paso para cerrar la caja del día.',
  status: 'PUBLISHED',
  tags: ['caja'],
  keywords: ['arqueo'],
  module: 'pos',
  category: { name: 'Caja' },
  content: '# Antes de empezar\nRevisa los pagos.\n\n## Contar efectivo\nCuenta los billetes.\n\n## Cerrar\nPulsa Cerrar caja.',
  ...over,
});

describe('help article indexing (T25)', () => {
  it('chunks markdown by section, title and summary travel in the first chunk', () => {
    const chunks = chunkArticle(article() as any);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].text).toContain('Cómo hacer un cierre de caja');
    expect(chunks[0].text).toContain('arqueo');
    expect(chunks.map((c) => c.heading)).toEqual(
      expect.arrayContaining(['Contar efectivo', 'Cerrar']),
    );
  });

  it('a just-published article becomes searchable: managed global docs + embeddings per section', async () => {
    const h = buildIndexerHarness({ articles: [article()] });
    await h.service.onArticleChanged({ id: 7 });

    const keys = h.docs.map((d) => d.document_key);
    expect(keys[0]).toBe('help_article:7:0');
    expect(h.docs.length).toBeGreaterThanOrEqual(3);
    for (const doc of h.docs) {
      expect(doc.entity_type).toBe('help_article');
      expect(doc.release_hash).toBe('managed');
      expect(doc.metadata.origin).toBe('managed');
      expect(doc.metadata.source_id).toBe(7);
      expect(doc.active).toBe(true);
      expect(doc.status).toBe('ready');
      expect(doc.embedding_fingerprint).toBe('fp1');
    }
    const cut = h.docs.find((d) => d.content.includes('Cuenta los billetes'));
    expect(cut).toBeDefined();
    expect(h.embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledTimes(h.docs.length);
    expect(h.embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'help_article', fingerprint: 'fp1' }),
    );
  });

  it('never indexes a draft or an archived article', async () => {
    const h = buildIndexerHarness({
      articles: [article({ id: 1, status: 'DRAFT' }), article({ id: 2, status: 'ARCHIVED' })],
    });
    await h.service.onArticleChanged({ id: 1 });
    await h.service.onArticleChanged({ id: 2 });
    expect(h.docs).toHaveLength(0);
    expect(h.embeddings.storeGlobalKnowledgeEmbedding).not.toHaveBeenCalled();
  });

  it('unpublishing retires every section; republishing with fewer sections retires the stale ones', async () => {
    const seed = [article()];
    const h = buildIndexerHarness({ articles: seed });
    await h.service.onArticleChanged({ id: 7 });
    const before = h.docs.length;

    seed[0] = article({ content: '# Solo\nUna sola sección.' }) as any;
    await h.service.onArticleChanged({ id: 7 });
    expect(h.docs.filter((d) => d.active)).toHaveLength(chunkArticle(seed[0] as any).length);
    expect(h.docs.length).toBe(before);

    seed[0] = article({ status: 'DRAFT' }) as any;
    await h.service.onArticleChanged({ id: 7 });
    expect(h.docs.every((d) => !d.active && d.status === 'retired')).toBe(true);
  });

  it('deleting the article (row gone) retires its documents', async () => {
    const seed = [article()];
    const h = buildIndexerHarness({ articles: seed });
    await h.service.onArticleChanged({ id: 7 });
    seed.length = 0;
    await h.service.onArticleChanged({ id: 7 });
    expect(h.docs.every((d) => !d.active)).toBe(true);
  });

  it('keeps the lexical index when the embedding app is unavailable', async () => {
    const h = buildIndexerHarness({ articles: [article()] });
    h.knowledgeEmbeddings.configuration.mockRejectedValue(new Error('KNOWLEDGE_APP_INCOMPATIBLE'));
    await h.service.syncArticle(7);
    expect(h.docs.length).toBeGreaterThan(0);
    expect(h.docs.every((d) => d.active && d.embedding_fingerprint === null)).toBe(true);
  });

  it('is idempotent: an unchanged article does not re-embed', async () => {
    const h = buildIndexerHarness({ articles: [article()] });
    await h.service.syncArticle(7);
    h.embeddings.storeGlobalKnowledgeEmbedding.mockClear();
    await h.service.syncArticle(7);
    expect(h.embeddings.storeGlobalKnowledgeEmbedding).not.toHaveBeenCalled();
  });

  it('backfill indexes published articles and retires managed docs of vanished sources', async () => {
    const h = buildIndexerHarness({ articles: [article()] });
    await h.service.syncArticle(7);
    h.docs.push({ ...h.docs[0], id: 99, document_key: 'help_article:55:0', metadata: { source_id: 55 } });
    const result = await h.service.backfill();
    expect(result.articles).toBe(1);
    expect(h.docs.find((d) => d.document_key === 'help_article:55:0')?.active).toBe(false);
    expect(h.docs.find((d) => d.document_key === 'help_article:7:0')?.active).toBe(true);
  });

  it('is a provider that listens to the events the admin services emit', () => {
    expect(HelpKnowledgeIndexerService.prototype.onArticleChanged).toBeDefined();
  });
});
