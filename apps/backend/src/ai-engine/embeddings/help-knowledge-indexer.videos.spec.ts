import {
  computeVideoSearchText,
  isVideoSearchTextInsufficient,
  VIDEO_SEARCH_TEXT_MIN_CHARS,
} from './help-knowledge-indexer.service';
import { buildIndexerHarness } from './help-knowledge-indexer.testing';

const video = (over: Record<string, unknown> = {}) => ({
  id: 3,
  title: 'Cierre de caja en el POS',
  slug: 'cierre-de-caja-en-el-pos',
  summary: 'Aprende a cerrar tu turno.',
  description: 'Mostramos el arqueo ciego y cómo registrar la diferencia de efectivo al terminar la jornada.',
  tags: ['conciliacion'],
  keywords: ['sobrante'],
  module: 'pos',
  status: 'PUBLISHED',
  category: { name: 'Punto de venta', description: 'Todo sobre el POS' },
  ...over,
});

describe('help video indexing without transcription (T26 / D4)', () => {
  it('computeVideoSearchText joins title, summary, description, tags, keywords, module and category', () => {
    const text = computeVideoSearchText(video());
    for (const part of [
      'Cierre de caja en el POS',
      'Aprende a cerrar tu turno.',
      'arqueo ciego',
      'conciliacion',
      'sobrante',
      'pos',
      'Punto de venta',
      'Todo sobre el POS',
    ])
      expect(text).toContain(part);
  });

  it('finds a video by a word that only lives in its description or its tags', async () => {
    const h = buildIndexerHarness({ videos: [video()] });
    await h.service.onVideoChanged({ id: 3 });
    expect(h.docs).toHaveLength(1);
    const doc = h.docs[0];
    expect(doc).toMatchObject({
      document_key: 'help_video:3',
      entity_type: 'help_video',
      release_hash: 'managed',
      active: true,
    });
    expect(doc.metadata.origin).toBe('managed');
    expect(doc.lexical_text.toLowerCase()).toContain('arqueo'); // only in description
    expect(doc.lexical_text.toLowerCase()).toContain('conciliacion'); // only in tags
    expect(doc.lexical_text).not.toMatch(/transcri/i);
    expect(h.embeddings.storeGlobalKnowledgeEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'help_video', content: doc.content }),
    );
  });

  it('flags a title-only video as insufficient and a well described one as sufficient', () => {
    expect(
      isVideoSearchTextInsufficient({ title: 'Video 1', summary: 'Corto', description: null, tags: [], keywords: [] }),
    ).toBe(true);
    expect(isVideoSearchTextInsufficient(video())).toBe(false);
    expect(VIDEO_SEARCH_TEXT_MIN_CHARS).toBeGreaterThan(0);
  });

  it('does not count the title, the module or the category as evidence', () => {
    expect(
      isVideoSearchTextInsufficient({
        title: 'x'.repeat(250),
        summary: 'ok',
        module: 'pos',
        category: { name: 'a'.repeat(200), description: 'b'.repeat(200) },
      }),
    ).toBe(true);
  });

  it('retires the video document when it is archived, drafted or deleted', async () => {
    const seed = [video()];
    const h = buildIndexerHarness({ videos: seed });
    await h.service.onVideoChanged({ id: 3 });
    seed[0] = video({ status: 'ARCHIVED' }) as any;
    await h.service.onVideoChanged({ id: 3 });
    expect(h.docs[0]).toMatchObject({ active: false, status: 'retired' });
    seed.length = 0;
    await h.service.onVideoChanged({ id: 3 });
    expect(h.docs[0].active).toBe(false);
  });

  it('never indexes a draft video', async () => {
    const h = buildIndexerHarness({ videos: [video({ status: 'DRAFT' })] });
    await h.service.onVideoChanged({ id: 3 });
    expect(h.docs).toHaveLength(0);
  });

  it('refreshes the learning paths that contain a changed video', async () => {
    const h = buildIndexerHarness({ videos: [video()] });
    h.prisma.video_series_items.findMany.mockResolvedValue([{ series_id: 11 }, { series_id: 11 }]);
    h.prisma.video_series.findUnique.mockResolvedValue({
      id: 11, title: 'Ruta de caja', slug: 'ruta-de-caja', summary: 'Aprende caja', description: null,
      module: 'pos', status: 'PUBLISHED', items: [{ video_id: 3, position: 1 }],
    });
    await h.service.onVideoChanged({ id: 3 });
    const path = h.docs.find((d) => d.document_key === 'learning_path:11');
    expect(path).toMatchObject({ entity_type: 'learning_path', release_hash: 'managed', active: true });
    expect(path!.content).toContain('Cierre de caja en el POS');
  });
});
