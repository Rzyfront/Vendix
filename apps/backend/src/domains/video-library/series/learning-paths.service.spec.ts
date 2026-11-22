import { LearningPathsService } from './learning-paths.service';

type Video = { id: number; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' };
type Progress = {
  user_id: number;
  video_id: number;
  series_id: number | null;
  seconds_watched: number;
  completed: boolean;
  completed_at: Date | null;
};

function setup(videos: Video[]) {
  const progress: Progress[] = [];
  const prisma = {
    videos: {
      findFirst: jest.fn(
        async ({ where }: { where: { id: number; status: string } }) =>
          videos.find((v) => v.id === where.id && v.status === where.status) ??
          null,
      ),
    },
    user_learning_progress: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { user_id_video_id: { user_id: number; video_id: number } };
        }) =>
          progress.find(
            (p) =>
              p.user_id === where.user_id_video_id.user_id &&
              p.video_id === where.user_id_video_id.video_id,
          ) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { user_id_video_id: { user_id: number; video_id: number } };
          create: Progress;
          update: Partial<Progress>;
        }) => {
          const row = progress.find(
            (p) =>
              p.user_id === where.user_id_video_id.user_id &&
              p.video_id === where.user_id_video_id.video_id,
          );
          if (row) return Object.assign(row, update);
          progress.push(create);
          return create;
        },
      ),
    },
  };
  const service = new LearningPathsService(prisma as never, {} as never);
  return { service, prisma, progress };
}

describe('LearningPathsService.saveProgress (H3)', () => {
  it.each([
    ['a video that does not exist', 404],
    ['a draft video', 2],
    ['an archived video', 3],
  ])(
    'rejects progress on %s with a domain error and writes no row',
    async (_label, id) => {
      const { service, prisma, progress } = setup([
        { id: 1, status: 'PUBLISHED' },
        { id: 2, status: 'DRAFT' },
        { id: 3, status: 'ARCHIVED' },
      ]);
      await expect(
        service.saveProgress(7, { video_id: id, seconds_watched: 30 }),
      ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
      expect(prisma.user_learning_progress.upsert).not.toHaveBeenCalled();
      expect(progress).toHaveLength(0);
    },
  );

  it('saves progress on a published video and never un-completes it', async () => {
    const { service, progress } = setup([{ id: 1, status: 'PUBLISHED' }]);
    await service.saveProgress(7, {
      video_id: 1,
      seconds_watched: 90,
      completed: true,
    });
    await service.saveProgress(7, {
      video_id: 1,
      seconds_watched: 10,
      completed: false,
    });
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      user_id: 7,
      video_id: 1,
      seconds_watched: 90,
      completed: true,
    });
    expect(progress[0].completed_at).toBeInstanceOf(Date);
  });
});
