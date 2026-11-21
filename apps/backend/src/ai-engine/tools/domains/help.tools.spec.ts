import { AIToolRegistry } from '../ai-tool-registry';
import { createHelpTools, HelpKnowledgeForAgent } from './help.tools';

type Row = Record<string, any>;

/**
 * The tools only see the help knowledge service. This fake behaves like it:
 * PUBLISHED rows only, progress keyed by the user it is given. The query shape
 * (status filter, user_id, upsert keys) is pinned in
 * `embeddings/help-knowledge-indexer.agent.spec.ts`.
 */
function build(over: { hits?: Row[]; articles?: Row[]; videos?: Row[]; series?: Row[] } = {}) {
  const articles = over.articles ?? [
    { id: 1, title: 'Cierre de caja', slug: 'cierre-de-caja', summary: 'Cierra el turno', content: '# Pasos', type: 'GUIDE', status: 'PUBLISHED', video_id: 5 },
    { id: 2, title: 'Borrador', slug: 'borrador', summary: 's', content: 'x', status: 'DRAFT', video_id: null },
  ];
  const videos = over.videos ?? [{ id: 5, title: 'Video de caja', slug: 'video-de-caja', summary: 'v', status: 'PUBLISHED' }];
  const series = over.series ?? [];
  const published = (rows: Row[]) => rows.filter((r) => r.status === 'PUBLISHED');
  const byRef = (rows: Row[], ref: { id?: number | null; slug?: string | null }) =>
    published(rows).find((r) => (ref.id ? r.id === ref.id : r.slug === ref.slug)) ?? null;
  const progressRows: Row[] = [];

  const knowledge = {
    search: jest.fn(async (): Promise<Row[]> => over.hits ?? []),
    resolvePublishedHitsForAgent: jest.fn(async (ids: { articles: number[]; videos: number[]; paths: number[] }) => ({
      articles: published(articles).filter((r) => ids.articles.includes(r.id)),
      videos: published(videos).filter((r) => ids.videos.includes(r.id)),
      paths: published(series).filter((r) => ids.paths.includes(r.id)),
    })),
    findPublishedArticleForAgent: jest.fn(async (ref: { id?: number | null; slug?: string | null }) => {
      const article = byRef(articles, ref);
      if (!article) return null;
      const video = article.video_id ? byRef(videos, { id: article.video_id }) : null;
      return { article, video };
    }),
    listPublishedLearningPathsForAgent: jest.fn(async () => published(series)),
    findPublishedLearningPathForAgent: jest.fn(async (ref: { id?: number | null; slug?: string | null }, userId: number | null) => {
      const path = byRef(series, ref);
      if (!path) return null;
      const videoIds = path.items.map((i: Row) => i.video_id);
      return {
        series: path,
        videos: published(videos).filter((v) => videoIds.includes(v.id)),
        articles: published(articles).filter((a) => path.items.some((i: Row) => i.article_id === a.id)),
        progress: userId ? progressRows.filter((p) => videoIds.includes(p.video_id)) : [],
      };
    }),
    saveLearningProgressForAgent: jest.fn(async (_userId: number, input: Row) => {
      const video = byRef(videos, { id: input.video_id });
      if (!video) return null;
      return {
        video: { id: video.id, title: video.title },
        progress: { seconds_watched: input.seconds_watched ?? 0, completed: input.completed ?? false },
      };
    }),
  };
  const tools = createHelpTools({ knowledge: knowledge as unknown as HelpKnowledgeForAgent });
  const run = async (name: string, args: Record<string, unknown>, ctx = { user_id: 9, store_id: 1, organization_id: 1 }) =>
    JSON.parse(await tools.find((t) => t.name === name)!.handler!(args, ctx));
  return { tools, knowledge, progressRows, run };
}

describe('help tools (T28)', () => {
  it('registers four tools the registry accepts (public, read-only except progress)', () => {
    const { tools } = build();
    const registry = new AIToolRegistry({} as never);
    expect(() => registry.registerMany(tools)).not.toThrow();
    expect(tools.map((t) => t.name)).toEqual(['search_help', 'get_help_article', 'get_learning_path', 'mark_learning_progress']);
    expect(tools.filter((t) => t.readOnly).map((t) => t.name)).not.toContain('mark_learning_progress');
    expect(tools.some((t) => t.requiresConfirmation)).toBe(false);
  });

  it('descriptions carry the learning.format rule and the cite-the-title rule', () => {
    const { tools } = build();
    const search = tools.find((t) => t.name === 'search_help')!;
    expect(search.description).toContain('¿Video o paso a paso?');
    expect(search.description).toContain('learning.format');
    expect(search.description).toContain('remember');
    expect(search.description).toMatch(/Cita/i);
  });

  it('search returns only real published rows with type, id, title, slug, summary, score', async () => {
    const { run, knowledge } = build({
      hits: [
        { type: 'help_article', id: 1, score: 0.9, document_key: 'k' },
        { type: 'help_article', id: 2, score: 0.8, document_key: 'k' }, // draft now: stale index entry
        { type: 'help_video', id: 5, score: 0.7, document_key: 'k' },
        { type: 'help_video', id: 404, score: 0.6, document_key: 'k' }, // row gone
      ],
    });
    const out = await run('search_help', { query: 'cierre de caja' });
    expect(out.found).toBe(true);
    expect(out.items).toEqual([
      { type: 'article', id: 1, title: 'Cierre de caja', slug: 'cierre-de-caja', summary: 'Cierra el turno', score: 0.9 },
      { type: 'video', id: 5, title: 'Video de caja', slug: 'video-de-caja', summary: 'v', score: 0.7 },
    ]);
    // Every hit is resolved against its source row; none is trusted from the index alone.
    expect(knowledge.resolvePublishedHitsForAgent).toHaveBeenCalledWith({ articles: [1, 2], videos: [5, 404], paths: [] });
  });

  it('search with nothing found returns an explicit empty result telling the model not to invent', async () => {
    const { run } = build({ hits: [] });
    const out = await run('search_help', { query: 'algo inexistente' });
    expect(out).toMatchObject({ found: false, items: [] });
    expect(out.message).toMatch(/NO inventes/);
  });

  it('get_help_article returns markdown and the linked video for a published article', async () => {
    const { run } = build();
    const out = await run('get_help_article', { slug: 'cierre-de-caja' });
    expect(out.article.content).toBe('# Pasos');
    expect(out.video).toMatchObject({ id: 5, title: 'Video de caja' });
  });

  it('get_help_article refuses drafts and unknown articles', async () => {
    const { run, knowledge } = build();
    expect((await run('get_help_article', { id: 2 })).found).toBe(false);
    expect((await run('get_help_article', { id: 999 })).found).toBe(false);
    expect(knowledge.findPublishedArticleForAgent.mock.calls.map((c) => c[0])).toEqual([{ id: 2 }, { id: 999 }]);
  });

  it('get_learning_path returns ordered items with the current user progress and the next video', async () => {
    const series = [{ id: 11, title: 'Ruta POS', slug: 'ruta-pos', summary: 's', status: 'PUBLISHED',
      items: [{ video_id: 5, article_id: 1, position: 1 }, { video_id: 6, article_id: null, position: 2 }] }];
    const videos = [
      { id: 5, title: 'V5', slug: 'v5', summary: '', status: 'PUBLISHED' },
      { id: 6, title: 'V6', slug: 'v6', summary: '', status: 'PUBLISHED' },
    ];
    const h = build({ series, videos });
    h.progressRows.push({ video_id: 5, seconds_watched: 60, completed: true });
    const out = await h.run('get_learning_path', { id: 11 });
    expect(out.series.items.map((i: Row) => i.video.id)).toEqual([5, 6]);
    expect(out.series.items[0].progress).toEqual({ seconds_watched: 60, completed: true });
    expect(out.series.items[0].article.title).toBe('Cierre de caja');
    expect(out.next_video_id).toBe(6);
    // The progress read is the CURRENT user's: the user id comes from the tool context.
    expect(h.knowledge.findPublishedLearningPathForAgent).toHaveBeenCalledWith({ id: 11 }, 9);
  });

  it('mark_learning_progress upserts the CURRENT user progress for a published video only', async () => {
    const { run, knowledge } = build();
    const out = await run('mark_learning_progress', { video_id: 5, series_id: 11, seconds_watched: 120, completed: true });
    expect(out.saved).toBe(true);
    expect(out.progress).toEqual({ seconds_watched: 120, completed: true });
    expect(knowledge.saveLearningProgressForAgent).toHaveBeenCalledWith(9, {
      video_id: 5, series_id: 11, seconds_watched: 120, completed: true,
    });
    expect((await run('mark_learning_progress', { video_id: 77 })).found).toBe(false);
    knowledge.saveLearningProgressForAgent.mockClear();
    expect((await run('mark_learning_progress', { video_id: 5 }, {} as never)).error).toBeDefined();
    expect(knowledge.saveLearningProgressForAgent).not.toHaveBeenCalled();
  });
});
