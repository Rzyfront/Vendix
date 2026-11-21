import { HelpKnowledgeIndexerService } from './help-knowledge-indexer.service';

type Row = Record<string, any>;

/**
 * Agent reads behind the Vex help tools (T28): published-only rows and the
 * caller's own learning progress. These are the query assertions that used to
 * live in `tools/domains/help.tools.spec.ts`, now pinned on the service that
 * owns them.
 */
function build(over: { articles?: Row[]; videos?: Row[]; series?: Row[]; progress?: Row[] } = {}) {
  const articles = over.articles ?? [
    { id: 1, title: 'Cierre de caja', slug: 'cierre-de-caja', summary: 'Cierra el turno', content: '# Pasos', type: 'GUIDE', status: 'PUBLISHED', video_id: 5 },
    { id: 2, title: 'Borrador', slug: 'borrador', summary: 's', content: 'x', status: 'DRAFT', video_id: null },
  ];
  const videos = over.videos ?? [
    { id: 5, title: 'Video de caja', slug: 'video-de-caja', summary: 'v', status: 'PUBLISHED' },
    { id: 7, title: 'Video borrador', slug: 'video-borrador', summary: 'b', status: 'DRAFT' },
  ];
  const series = over.series ?? [];
  const progress = over.progress ?? [];
  const match = (rows: Row[], where: Row) =>
    rows.filter((r) =>
      Object.entries(where).every(([k, c]) =>
        c && typeof c === 'object' && 'in' in c ? c.in.includes(r[k]) : r[k] === c));
  const delegate = (rows: Row[]) => ({
    findFirst: jest.fn(async ({ where }: Row) => match(rows, where)[0] ?? null),
    findMany: jest.fn(async ({ where }: Row) => match(rows, where)),
  });
  const db = {
    help_articles: delegate(articles),
    videos: delegate(videos),
    video_series: delegate(series),
    user_learning_progress: {
      findMany: jest.fn(async ({ where }: Row) => match(progress, where)),
      upsert: jest.fn(async ({ create }: Row) => create),
    },
  };
  const service = new HelpKnowledgeIndexerService(db as never, {} as never, {} as never);
  return { service, db };
}

describe('help knowledge agent reads (T28)', () => {
  it('resolves search hits against PUBLISHED rows only, with the narrow columns the tools read', async () => {
    const { service, db } = build();
    const out = await service.resolvePublishedHitsForAgent({ articles: [1, 2], videos: [5, 404], paths: [] });
    expect(out.articles.map((a) => a.id)).toEqual([1]);
    expect(out.videos.map((v) => v.id)).toEqual([5]);
    expect(out.paths).toEqual([]);
    const articleQuery = db.help_articles.findMany.mock.calls[0][0];
    expect(articleQuery.where).toEqual({ id: { in: [1, 2] }, status: 'PUBLISHED' });
    expect(Object.keys(articleQuery.select)).toEqual(['id', 'title', 'slug', 'summary', 'video_id']);
    expect(db.videos.findMany.mock.calls[0][0].where.status).toBe('PUBLISHED');
    expect(db.video_series.findMany).not.toHaveBeenCalled(); // no path hits, no query
  });

  it('returns a published article with its linked published video', async () => {
    const { service } = build();
    const out = await service.findPublishedArticleForAgent({ slug: 'cierre-de-caja' });
    expect(out?.article).toMatchObject({ id: 1, content: '# Pasos' });
    expect(out?.video).toMatchObject({ id: 5, title: 'Video de caja' });
  });

  it('refuses drafts and unknown articles, filtering by PUBLISHED', async () => {
    const { service, db } = build();
    expect(await service.findPublishedArticleForAgent({ id: 2 })).toBeNull();
    expect(await service.findPublishedArticleForAgent({ id: 999 })).toBeNull();
    expect(db.help_articles.findFirst.mock.calls[0][0].where.status).toBe('PUBLISHED');
  });

  it('never queries without an id or a slug (it would match any published row)', async () => {
    const { service, db } = build();
    expect(await service.findPublishedArticleForAgent({ slug: '  ' })).toBeNull();
    expect(await service.findPublishedLearningPathForAgent({}, 9)).toBeNull();
    expect(db.help_articles.findFirst).not.toHaveBeenCalled();
    expect(db.video_series.findFirst).not.toHaveBeenCalled();
  });

  it('lists up to 20 published learning paths in catalog order', async () => {
    const { service, db } = build({ series: [{ id: 11, title: 'Ruta POS', slug: 'ruta-pos', status: 'PUBLISHED' }] });
    await service.listPublishedLearningPathsForAgent();
    const query = db.video_series.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ status: 'PUBLISHED' });
    expect(query.take).toBe(20);
    expect(query.orderBy).toEqual([{ sort_order: 'asc' }, { title: 'asc' }]);
  });

  it('reads a learning path in item order with the progress of the given user only', async () => {
    const series = [{ id: 11, title: 'Ruta POS', slug: 'ruta-pos', summary: 's', status: 'PUBLISHED',
      items: [{ video_id: 5, article_id: 1, position: 1 }, { video_id: 6, article_id: null, position: 2 }] }];
    const videos = [
      { id: 5, title: 'V5', slug: 'v5', summary: '', status: 'PUBLISHED' },
      { id: 6, title: 'V6', slug: 'v6', summary: '', status: 'PUBLISHED' },
    ];
    const progress = [
      { user_id: 9, video_id: 5, seconds_watched: 60, completed: true },
      { user_id: 3, video_id: 6, seconds_watched: 10, completed: true },
    ];
    const { service, db } = build({ series, videos, progress });
    const out = await service.findPublishedLearningPathForAgent({ id: 11 }, 9);
    expect(db.video_series.findFirst.mock.calls[0][0]).toEqual({
      where: { status: 'PUBLISHED', id: 11 },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    expect(db.user_learning_progress.findMany.mock.calls[0][0].where).toEqual({ user_id: 9, video_id: { in: [5, 6] } });
    expect(out?.progress).toEqual([{ user_id: 9, video_id: 5, seconds_watched: 60, completed: true }]);
    expect(out?.articles.map((a) => a.id)).toEqual([1]);
  });

  it('reads no progress without a user', async () => {
    const series = [{ id: 11, title: 'Ruta', slug: 'ruta', status: 'PUBLISHED', items: [{ video_id: 5, article_id: null, position: 1 }] }];
    const { service, db } = build({ series });
    const out = await service.findPublishedLearningPathForAgent({ id: 11 }, null);
    expect(out?.progress).toEqual([]);
    expect(db.user_learning_progress.findMany).not.toHaveBeenCalled();
  });

  it('upserts the given user progress for a published video only', async () => {
    const { service, db } = build();
    const out = await service.saveLearningProgressForAgent(9, { video_id: 5, series_id: 11, seconds_watched: 120, completed: true });
    expect(out?.video).toEqual(expect.objectContaining({ id: 5 }));
    const call = db.user_learning_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ user_id_video_id: { user_id: 9, video_id: 5 } });
    expect(call.create).toMatchObject({ user_id: 9, video_id: 5, series_id: 11, seconds_watched: 120, completed: true });
    expect(call.create.completed_at).toBeInstanceOf(Date);
    expect(call.update).toMatchObject({ series_id: 11, seconds_watched: 120, completed: true });
    expect(db.videos.findFirst.mock.calls[0][0].where).toEqual({ id: 5, status: 'PUBLISHED' });
  });

  it('on update only touches the fields it was given', async () => {
    const { service, db } = build();
    await service.saveLearningProgressForAgent(9, { video_id: 5, series_id: null });
    const { update } = db.user_learning_progress.upsert.mock.calls[0][0];
    expect(Object.keys(update)).toEqual(['updated_at']);
  });

  it('writes nothing for a draft or unknown video', async () => {
    const { service, db } = build();
    expect(await service.saveLearningProgressForAgent(9, { video_id: 7, completed: true })).toBeNull();
    expect(await service.saveLearningProgressForAgent(9, { video_id: 77 })).toBeNull();
    expect(db.user_learning_progress.upsert).not.toHaveBeenCalled();
  });
});
