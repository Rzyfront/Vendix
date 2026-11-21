import { AIToolRegistry } from '../ai-tool-registry';
import { createHelpTools, HelpToolsPrisma } from './help.tools';

const published = { status: 'PUBLISHED' };

function build(over: { hits?: any[]; articles?: any[]; videos?: any[]; series?: any[] } = {}) {
  const articles = over.articles ?? [
    { id: 1, title: 'Cierre de caja', slug: 'cierre-de-caja', summary: 'Cierra el turno', content: '# Pasos', type: 'GUIDE', status: 'PUBLISHED', video_id: 5 },
    { id: 2, title: 'Borrador', slug: 'borrador', summary: 's', content: 'x', status: 'DRAFT', video_id: null },
  ];
  const videos = over.videos ?? [{ id: 5, title: 'Video de caja', slug: 'video-de-caja', summary: 'v', status: 'PUBLISHED' }];
  const series = over.series ?? [];
  const match = (rows: any[], where: any) =>
    rows.filter((r) =>
      Object.entries(where).every(([k, c]: [string, any]) =>
        c && typeof c === 'object' && 'in' in c ? c.in.includes(r[k]) : r[k] === c));
  const prisma = {
    help_articles: { findFirst: jest.fn(async ({ where }) => match(articles, where)[0] ?? null), findMany: jest.fn(async ({ where }) => match(articles, where)) },
    videos: { findFirst: jest.fn(async ({ where }) => match(videos, where)[0] ?? null), findMany: jest.fn(async ({ where }) => match(videos, where)) },
    video_series: { findFirst: jest.fn(async ({ where }) => match(series, where)[0] ?? null), findMany: jest.fn(async ({ where }) => match(series, where)) },
    user_learning_progress: { findMany: jest.fn(async () => []), upsert: jest.fn(async ({ create }) => create) },
  };
  const indexer = { search: jest.fn(async () => over.hits ?? []) };
  const tools = createHelpTools({ prisma: prisma as unknown as HelpToolsPrisma, indexer });
  const run = async (name: string, args: Record<string, unknown>, ctx = { user_id: 9, store_id: 1, organization_id: 1 }) =>
    JSON.parse(await tools.find((t) => t.name === name)!.handler!(args, ctx));
  return { tools, prisma, indexer, run };
}

describe('help tools (T28)', () => {
  it('registers four tools the registry accepts (public, read-only except progress)', () => {
    const { tools } = build();
    const registry = new AIToolRegistry();
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
    const { run } = build({
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
    const { run, prisma } = build();
    expect((await run('get_help_article', { id: 2 })).found).toBe(false);
    expect((await run('get_help_article', { id: 999 })).found).toBe(false);
    expect(prisma.help_articles.findFirst.mock.calls[0][0].where.status).toBe('PUBLISHED');
  });

  it('get_learning_path returns ordered items with the current user progress and the next video', async () => {
    const series = [{ id: 11, title: 'Ruta POS', slug: 'ruta-pos', summary: 's', status: 'PUBLISHED',
      items: [{ video_id: 5, article_id: 1, position: 1 }, { video_id: 6, article_id: null, position: 2 }] }];
    const videos = [
      { id: 5, title: 'V5', slug: 'v5', summary: '', status: 'PUBLISHED' },
      { id: 6, title: 'V6', slug: 'v6', summary: '', status: 'PUBLISHED' },
    ];
    const h = build({ series, videos });
    h.prisma.user_learning_progress.findMany.mockResolvedValue([{ video_id: 5, seconds_watched: 60, completed: true }]);
    const out = await h.run('get_learning_path', { id: 11 });
    expect(out.series.items.map((i: any) => i.video.id)).toEqual([5, 6]);
    expect(out.series.items[0].progress).toEqual({ seconds_watched: 60, completed: true });
    expect(out.series.items[0].article.title).toBe('Cierre de caja');
    expect(out.next_video_id).toBe(6);
    expect(h.prisma.user_learning_progress.findMany.mock.calls[0][0].where.user_id).toBe(9);
  });

  it('mark_learning_progress upserts the CURRENT user progress for a published video only', async () => {
    const { run, prisma } = build();
    const out = await run('mark_learning_progress', { video_id: 5, series_id: 11, seconds_watched: 120, completed: true });
    expect(out.saved).toBe(true);
    const call = prisma.user_learning_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ user_id_video_id: { user_id: 9, video_id: 5 } });
    expect(call.create).toMatchObject({ user_id: 9, video_id: 5, series_id: 11, completed: true });
    expect((await run('mark_learning_progress', { video_id: 77 })).found).toBe(false);
    expect((await run('mark_learning_progress', { video_id: 5 }, {} as any)).error).toBeDefined();
  });
});
