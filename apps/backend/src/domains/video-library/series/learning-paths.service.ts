import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { LearningProgressDto } from './dto/learning-progress.dto';

const VIDEO_SELECT = {
  id: true,
  title: true,
  slug: true,
  summary: true,
  video_url: true,
  video_source: true,
  external_id: true,
  duration_seconds: true,
  thumbnail_url: true,
} as const;

/**
 * Store-side reading of published learning paths plus per-user progress.
 * Only PUBLISHED series are visible; progress is always filtered by the
 * authenticated user id (the table has no tenant column on purpose).
 */
@Injectable()
export class LearningPathsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly s3: S3Service,
  ) {}

  async list(userId: number) {
    const series = await this.prisma.video_series.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        summary: true,
        module: true,
        thumbnail_url: true,
        items: {
          where: { video: { status: 'PUBLISHED' } },
          select: { video_id: true },
        },
      },
    });

    const videoIds = [
      ...new Set(
        series.flatMap((s: any) => s.items.map((i: any) => i.video_id as number)),
      ),
    ];
    const done = new Set<number>(
      videoIds.length
        ? (
            await this.prisma.user_learning_progress.findMany({
              where: {
                user_id: userId,
                completed: true,
                video_id: { in: videoIds },
              },
              select: { video_id: true },
            })
          ).map((p: { video_id: number }) => p.video_id)
        : [],
    );

    return Promise.all(
      series.map(async (s: any) => ({
        id: s.id,
        title: s.title,
        slug: s.slug,
        summary: s.summary,
        module: s.module,
        thumbnail_url: await this.resolveMediaUrl(s.thumbnail_url),
        video_count: s.items.length,
        completed_count: s.items.filter((i: any) => done.has(i.video_id)).length,
      })),
    );
  }

  async getOne(id: number, userId: number) {
    const series = await this.prisma.video_series.findFirst({
      where: { id, status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        slug: true,
        summary: true,
        items: {
          where: { video: { status: 'PUBLISHED' } },
          orderBy: { position: 'asc' },
          select: {
            position: true,
            video: { select: VIDEO_SELECT },
            article: {
              select: { id: true, title: true, slug: true, summary: true },
            },
          },
        },
      },
    });
    if (!series) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'No se encontró la ruta de aprendizaje.',
      );
    }

    const videoIds: number[] = series.items.map((i: any) => i.video.id);
    const progress = videoIds.length
      ? await this.prisma.user_learning_progress.findMany({
          where: { user_id: userId, video_id: { in: videoIds } },
          select: { video_id: true, seconds_watched: true, completed: true },
        })
      : [];
    const byVideo = new Map<number, { seconds_watched: number; completed: boolean }>(
      progress.map((p: any) => [
        p.video_id,
        { seconds_watched: p.seconds_watched, completed: p.completed },
      ]),
    );

    return {
      id: series.id,
      title: series.title,
      slug: series.slug,
      summary: series.summary,
      items: await Promise.all(
        series.items.map(async (item: any) => ({
          position: item.position,
          video: {
            ...item.video,
            video_url: await this.resolveMediaUrl(item.video.video_url),
            thumbnail_url: await this.resolveMediaUrl(item.video.thumbnail_url),
          },
          article: item.article ?? null,
          progress: byVideo.get(item.video.id) ?? null,
        })),
      ),
    };
  }

  async saveProgress(userId: number, dto: LearningProgressDto) {
    // Same rule as the agent path (`saveLearningProgressForAgent`): progress
    // only on a video that exists and is published. The table has no FK, so
    // without this check an unknown id would leave an orphan row.
    const video = await this.prisma.videos.findFirst({
      where: { id: dto.video_id, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (!video) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'No se encontró el video publicado.',
      );
    }

    const existing = await this.prisma.user_learning_progress.findUnique({
      where: { user_id_video_id: { user_id: userId, video_id: dto.video_id } },
    });
    // Progress only moves forward: a re-watch never un-completes a video.
    const completed = Boolean(existing?.completed || dto.completed);
    const seconds_watched = Math.max(
      existing?.seconds_watched ?? 0,
      dto.seconds_watched,
    );
    const completed_at = completed
      ? (existing?.completed_at ?? new Date())
      : null;

    return this.prisma.user_learning_progress.upsert({
      where: { user_id_video_id: { user_id: userId, video_id: dto.video_id } },
      create: {
        user_id: userId,
        video_id: dto.video_id,
        series_id: dto.series_id ?? null,
        seconds_watched,
        completed,
        completed_at,
      },
      update: {
        ...(dto.series_id !== undefined && { series_id: dto.series_id }),
        seconds_watched,
        completed,
        completed_at,
        updated_at: new Date(),
      },
    });
  }

  private async resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (/^https?:\/\//.test(url)) return url;
    try {
      return (await this.s3.signUrl(url)) || url;
    } catch {
      return url;
    }
  }
}
