import { VideoSeriesService } from './video-series.service';
import { LearningPathsService } from '../../../video-library/series/learning-paths.service';

type Mock = jest.Mock;

function buildPrisma() {
  const calls: string[] = [];
  const prisma: any = {
    calls,
    video_series: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => {
        calls.push('series.create');
        return Promise.resolve({ id: 7, status: 'DRAFT', ...data });
      }),
      update: jest.fn().mockImplementation(({ where, data }) => {
        calls.push('series.update');
        return Promise.resolve({ id: where.id, ...data });
      }),
      delete: jest.fn().mockImplementation(() => {
        calls.push('series.delete');
        return Promise.resolve({});
      }),
    },
    video_series_items: {
      createMany: jest.fn().mockImplementation(() => {
        calls.push('items.createMany');
        return Promise.resolve({ count: 0 });
      }),
      deleteMany: jest.fn().mockImplementation(() => {
        calls.push('items.deleteMany');
        return Promise.resolve({ count: 0 });
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    videos: { findMany: jest.fn(), findFirst: jest.fn() },
    help_articles: { findMany: jest.fn().mockResolvedValue([]) },
    user_learning_progress: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ create, update }) =>
        Promise.resolve({ id: 1, ...create, ...update }),
      ),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: any) => unknown) => cb(prisma));
  return prisma;
}

describe('VideoSeriesService (superadmin)', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let events: { emit: Mock };
  let service: VideoSeriesService;

  beforeEach(() => {
    prisma = buildPrisma();
    events = { emit: jest.fn() };
    service = new VideoSeriesService(prisma, events as any);
    const existingVideos = [11, 12, 13];
    prisma.videos.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        existingVideos.filter((id) => where.id.in.includes(id)).map((id) => ({ id })),
      ),
    );
    prisma.video_series.findUnique.mockResolvedValue(null);
  });

  it('creates a series with items stored in the given order', async () => {
    await service.create(5, {
      title: 'Primeros pasos',
      items: [
        { video_id: 13 },
        { video_id: 11, article_id: 99 },
        { video_id: 12 },
      ],
    });

    expect(prisma.video_series.create.mock.calls[0][0].data).toMatchObject({
      title: 'Primeros pasos',
      slug: 'primeros-pasos',
      status: 'DRAFT',
      created_by_id: 5,
    });
    expect(prisma.video_series_items.createMany.mock.calls[0][0].data).toEqual([
      { series_id: 7, video_id: 13, article_id: null, position: 1 },
      { series_id: 7, video_id: 11, article_id: 99, position: 2 },
      { series_id: 7, video_id: 12, article_id: null, position: 3 },
    ]);
  });

  it('rejects duplicated or unknown videos', async () => {
    await expect(
      service.create(5, { title: 'x', items: [{ video_id: 11 }, { video_id: 11 }] }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ error_code: expect.any(String) }) });
    await expect(
      service.create(5, { title: 'x', items: [{ video_id: 11 }, { video_id: 404 }] }),
    ).rejects.toBeDefined();
    expect(prisma.video_series.create).not.toHaveBeenCalled();
  });

  it('reorders items by rewriting positions in one transaction', async () => {
    prisma.video_series.findUnique.mockResolvedValue({ id: 7, status: 'DRAFT' });
    await service.update(7, {
      items: [{ video_id: 12 }, { video_id: 11 }],
    });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.calls.indexOf('items.deleteMany')).toBeLessThan(
      prisma.calls.indexOf('items.createMany'),
    );
    expect(prisma.video_series_items.createMany.mock.calls[0][0].data).toEqual([
      { series_id: 7, video_id: 12, article_id: null, position: 1 },
      { series_id: 7, video_id: 11, article_id: null, position: 2 },
    ]);
  });

  it('publishes a series and emits help.learning_path.changed with its id', async () => {
    prisma.video_series.findUnique.mockResolvedValue({
      id: 7,
      status: 'DRAFT',
      items: [{ id: 1 }],
    });
    await service.publish(7);

    expect(prisma.video_series.update.mock.calls[0][0].data.status).toBe('PUBLISHED');
    expect(events.emit).toHaveBeenCalledWith(
      'help.learning_path.changed',
      expect.objectContaining({ series_id: 7, status: 'PUBLISHED' }),
    );
  });

  it('refuses to publish an empty series', async () => {
    prisma.video_series.findUnique.mockResolvedValue({ id: 7, status: 'DRAFT', items: [] });
    await expect(service.publish(7)).rejects.toBeDefined();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('delete removes the items first and then the series, never cascading', async () => {
    prisma.video_series.findUnique.mockResolvedValue({ id: 7, status: 'DRAFT' });
    await service.remove(7);

    expect(prisma.calls).toEqual(['items.deleteMany', 'series.delete']);
    expect(events.emit).toHaveBeenCalledWith(
      'help.learning_path.changed',
      expect.objectContaining({ series_id: 7, status: 'DELETED' }),
    );
  });
});

describe('LearningPathsService (store side)', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let service: LearningPathsService;
  const s3 = { signUrl: jest.fn(async (u: string) => `signed:${u}`) };

  beforeEach(() => {
    prisma = buildPrisma();
    service = new LearningPathsService(prisma, s3 as any);
  });

  it('lists only published series', async () => {
    await service.list(3);
    expect(prisma.video_series.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'PUBLISHED',
    });
  });

  it('does not expose a draft series by id', async () => {
    prisma.video_series.findFirst = jest.fn().mockResolvedValue(null);
    await expect(service.getOne(7, 3)).rejects.toBeDefined();
    expect(prisma.video_series.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 7,
      status: 'PUBLISHED',
    });
  });

  it('returns ordered items with the progress of the current user only', async () => {
    prisma.video_series.findFirst = jest.fn().mockResolvedValue({
      id: 7,
      title: 'Ruta',
      slug: 'ruta',
      summary: null,
      items: [
        {
          position: 1,
          article: null,
          video: { id: 11, title: 'A', slug: 'a', summary: '', video_url: 'u', video_source: 'YOUTUBE', external_id: 'x', duration_seconds: 60, thumbnail_url: null },
        },
        {
          position: 2,
          article: { id: 9, title: 'Art', slug: 'art', summary: 's' },
          video: { id: 12, title: 'B', slug: 'b', summary: '', video_url: 'u', video_source: 'YOUTUBE', external_id: 'y', duration_seconds: 30, thumbnail_url: null },
        },
      ],
    });
    prisma.user_learning_progress.findMany.mockResolvedValue([
      { video_id: 11, seconds_watched: 60, completed: true },
    ]);

    const result = await service.getOne(7, 3);

    expect(prisma.user_learning_progress.findMany.mock.calls[0][0].where).toMatchObject({
      user_id: 3,
      video_id: { in: [11, 12] },
    });
    expect(result.items.map((i: any) => i.position)).toEqual([1, 2]);
    expect(result.items[0].progress).toEqual({ seconds_watched: 60, completed: true });
    expect(result.items[1].progress).toBeNull();
    expect(result.items[1].article).toEqual({ id: 9, title: 'Art', slug: 'art', summary: 's' });
  });

  it('upserts progress keyed by the current user and never lowers completion', async () => {
    prisma.videos.findFirst.mockResolvedValue({ id: 11 });
    prisma.user_learning_progress.findUnique.mockResolvedValue({
      seconds_watched: 90,
      completed: true,
      completed_at: new Date('2026-01-01'),
    });
    await service.saveProgress(3, { video_id: 11, series_id: 7, seconds_watched: 20 });

    expect(prisma.videos.findFirst.mock.calls[0][0].where).toEqual({
      id: 11,
      status: 'PUBLISHED',
    });
    const arg = prisma.user_learning_progress.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ user_id_video_id: { user_id: 3, video_id: 11 } });
    expect(arg.create).toMatchObject({ user_id: 3, video_id: 11, series_id: 7 });
    expect(arg.update.completed).toBe(true);
    expect(arg.update.seconds_watched).toBe(90);
  });

  it('refuses progress for a video that is not published', async () => {
    prisma.videos.findFirst.mockResolvedValue(null);
    await expect(
      service.saveProgress(3, { video_id: 99, series_id: 7, seconds_watched: 10 }),
    ).rejects.toBeDefined();
    expect(prisma.user_learning_progress.upsert).not.toHaveBeenCalled();
  });
});
