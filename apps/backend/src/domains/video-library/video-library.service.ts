import { Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { S3Service } from '../../common/services/s3.service';
import { VideoQueryDto } from './dto/video-query.dto';
import { Prisma } from '@prisma/client';
import {
  tokenizeQuery,
  calculateRelevance,
} from '../../common/helpers/keywords.helper';

@Injectable()
export class VideoLibraryService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async findAll(query: VideoQueryDto) {
    const { page = 1, limit = 20, category, module, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.videosWhereInput = {
      status: 'PUBLISHED',
      ...(category && {
        category: isNaN(Number(category))
          ? { slug: category }
          : { OR: [{ slug: category }, { id: Number(category) }] },
      }),
      ...(module && { module }),
      ...(search && (() => {
        const cleanSearch = search.trim();
        const tokens = tokenizeQuery(cleanSearch);
        return {
          OR: [
            { title: { contains: cleanSearch, mode: 'insensitive' as const } },
            { summary: { contains: cleanSearch, mode: 'insensitive' as const } },
            { tags: { has: cleanSearch.toLowerCase() } },
            { keywords: { has: cleanSearch.toLowerCase() } },
            ...tokens.flatMap((t) => [
              { title: { contains: t, mode: 'insensitive' as const } },
              { summary: { contains: t, mode: 'insensitive' as const } },
              { tags: { has: t } },
              { keywords: { has: t } },
            ]),
          ],
        };
      })()),
    };

    const [data, total] = await Promise.all([
      this.globalPrisma.videos.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { is_featured: 'desc' },
          { sort_order: 'asc' },
          { created_at: 'desc' },
        ],
        include: {
          category: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
      }),
      this.globalPrisma.videos.count({ where }),
    ]);

    const signedData = await Promise.all(
      data.map(async (video) => ({
        ...video,
        thumbnail_url: await this.resolveMediaUrl(video.thumbnail_url),
        video_url: await this.resolveMediaUrl(video.video_url),
      })),
    );

    if (search) {
      const tokens = tokenizeQuery(search);
      signedData.sort(
        (a, b) => calculateRelevance(b, tokens) - calculateRelevance(a, tokens),
      );
    }

    return {
      data: signedData,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async search(q: string, limit = 10) {
    if (!q || !q.trim()) return [];

    const cleanQuery = q.trim();
    const tokens = tokenizeQuery(cleanQuery);

    const matching = (token: string): Prisma.videosWhereInput => ({
      OR: [
        { title: { contains: token, mode: 'insensitive' as const } },
        { summary: { contains: token, mode: 'insensitive' as const } },
        { tags: { has: token } },
        { keywords: { has: token } },
        { category: { name: { contains: token, mode: 'insensitive' as const } } },
      ],
    });

    const clauses = tokens.length
      ? tokens.map(matching)
      : [matching(cleanQuery)];

    const queryVideos = (whereInput: Prisma.videosWhereInput, take = limit) =>
      this.globalPrisma.videos.findMany({
        where: { status: 'PUBLISHED', ...whereInput },
        take,
        orderBy: [{ is_featured: 'desc' }, { view_count: 'desc' }],
        include: {
          category: {
            select: { id: true, name: true, slug: true, icon: true },
          },
        },
      });

    const strict = await queryVideos({ AND: clauses });
    let candidates = strict;

    if (strict.length < limit && clauses.length > 1) {
      const seen = new Set(strict.map((v) => v.id));
      const loose = (
        await queryVideos({ OR: clauses }, Math.min(60, limit * 5))
      ).filter((v) => !seen.has(v.id));
      candidates = [...strict, ...loose];
    }

    const ranked = candidates
      .map((video, index) => ({
        video,
        index,
        score: calculateRelevance(video, tokens),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((entry) => entry.video)
      .slice(0, limit);

    return Promise.all(
      ranked.map(async (v) => ({
        ...v,
        thumbnail_url: await this.resolveMediaUrl(v.thumbnail_url),
        video_url: await this.resolveMediaUrl(v.video_url),
      })),
    );
  }

  async findBySlug(slug: string) {
    const video = await this.globalPrisma.videos.findUnique({
      where: { slug },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    if (!video || video.status !== 'PUBLISHED') {
      throw new NotFoundException('Video no encontrado');
    }

    // Fetch up to 8 related videos in the same category or overall popular
    const related = await this.globalPrisma.videos.findMany({
      where: {
        status: 'PUBLISHED',
        id: { not: video.id },
        category_id: video.category_id,
      },
      take: 8,
      orderBy: [{ is_featured: 'desc' }, { view_count: 'desc' }],
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    const [resolvedVideo, resolvedRelated] = await Promise.all([
      this.resolveMediaItem(video),
      Promise.all(related.map((v) => this.resolveMediaItem(v))),
    ]);

    return {
      ...resolvedVideo,
      related_videos: resolvedRelated,
    };
  }

  async incrementView(id: number) {
    const updated = await this.globalPrisma.videos.update({
      where: { id },
      data: {
        view_count: { increment: 1 },
      },
      select: { id: true, view_count: true },
    });

    return { view_count: updated.view_count };
  }

  async toggleLike(id: number, liked?: boolean) {
    const current = await this.globalPrisma.videos.findUnique({
      where: { id },
      select: { like_count: true },
    });

    if (!current) {
      throw new NotFoundException('Video no encontrado');
    }

    const currentLikes = current.like_count || 0;
    const newLikes =
      liked === false ? Math.max(0, currentLikes - 1) : currentLikes + 1;

    const updated = await this.globalPrisma.videos.update({
      where: { id },
      data: {
        like_count: newLikes,
      },
      select: { id: true, like_count: true },
    });

    return { like_count: updated.like_count };
  }

  async getCategories() {
    return this.globalPrisma.video_categories.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            videos: {
              where: { status: 'PUBLISHED' },
            },
          },
        },
      },
    });
  }

  private async resolveMediaItem(item: any) {
    return {
      ...item,
      thumbnail_url: await this.resolveMediaUrl(item.thumbnail_url),
      video_url: await this.resolveMediaUrl(item.video_url),
    };
  }

  private async resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    try {
      return await this.s3Service.signUrl(url);
    } catch {
      return url;
    }
  }
}
