import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '../../../common/services/s3.service';
import { S3PathHelper } from '../../../common/helpers/s3-path.helper';
import { ImageContext } from '@common/config/image-presets';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  CreateVideoDto,
  UpdateVideoDto,
  CreateCategoryDto,
  UpdateCategoryDto,
  AdminVideoQueryDto,
  VideoSourceTypeEnum,
} from './dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class VideoLibraryAdminService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) {}

  // ==========================================
  // VIDEOS CRUD
  // ==========================================

  async findAllVideos(query: AdminVideoQueryDto) {
    const { page = 1, limit = 20, status, video_source, category, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.videosWhereInput = {
      ...(status && { status: status as any }),
      ...(video_source && { video_source: video_source as any }),
      ...(category && { category: { slug: category } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { summary: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.globalPrisma.videos.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
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

  async findVideoById(id: number) {
    const video = await this.globalPrisma.videos.findUnique({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    if (!video) {
      throw new VendixHttpException(ErrorCodes.VIDEO_NOT_FOUND);
    }

    return {
      ...video,
      thumbnail_url: await this.resolveMediaUrl(video.thumbnail_url),
      video_url: await this.resolveMediaUrl(video.video_url),
    };
  }

  async createVideo(userId: number, dto: CreateVideoDto) {
    const baseSlug = this.generateSlug(dto.title);
    const existing = await this.globalPrisma.videos.findUnique({
      where: { slug: baseSlug },
    });
    const finalSlug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;

    // Detect YouTube / Loom / Vimeo
    const parsed = this.parseVideoUrl(dto.video_url, dto.video_source);
    const external_id = dto.external_id || parsed.external_id;
    const video_source = dto.video_source || parsed.video_source;

    // Default YouTube high-res thumbnail if empty
    let thumbnail_url = dto.thumbnail_url;
    if (!thumbnail_url && video_source === VideoSourceTypeEnum.YOUTUBE && external_id) {
      thumbnail_url = `https://img.youtube.com/vi/${external_id}/maxresdefault.jpg`;
    }

    const video = await this.globalPrisma.videos.create({
      data: {
        title: dto.title,
        slug: finalSlug,
        summary: dto.summary,
        description: dto.description || null,
        video_url: dto.video_url,
        video_source: video_source as any,
        external_id: external_id || null,
        duration_seconds: dto.duration_seconds || 0,
        thumbnail_url: thumbnail_url || null,
        status: (dto.status || 'DRAFT') as any,
        category_id: dto.category_id,
        module: dto.module || null,
        tags: dto.tags || [],
        is_featured: dto.is_featured || false,
        sort_order: dto.sort_order || 0,
        created_by_id: userId,
        store_id: dto.store_id || null,
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    return {
      ...video,
      thumbnail_url: await this.resolveMediaUrl(video.thumbnail_url),
      video_url: await this.resolveMediaUrl(video.video_url),
    };
  }

  async updateVideo(id: number, dto: UpdateVideoDto) {
    const video = await this.globalPrisma.videos.findUnique({
      where: { id },
    });

    if (!video) {
      throw new VendixHttpException(ErrorCodes.VIDEO_NOT_FOUND);
    }

    let slug: string | undefined;
    if (dto.title && dto.title !== video.title) {
      const newSlug = this.generateSlug(dto.title);
      const existing = await this.globalPrisma.videos.findFirst({
        where: { slug: newSlug, id: { not: id } },
      });
      slug = existing ? `${newSlug}-${Date.now()}` : newSlug;
    }

    let external_id = dto.external_id;
    let video_source = dto.video_source;
    if (dto.video_url && dto.video_url !== video.video_url) {
      const parsed = this.parseVideoUrl(dto.video_url, dto.video_source);
      external_id = external_id || parsed.external_id;
      video_source = video_source || parsed.video_source;
    }

    const updated = await this.globalPrisma.videos.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(slug && { slug }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.video_url && { video_url: dto.video_url }),
        ...(video_source && { video_source: video_source as any }),
        ...(external_id !== undefined && { external_id }),
        ...(dto.duration_seconds !== undefined && { duration_seconds: dto.duration_seconds }),
        ...(dto.thumbnail_url !== undefined && { thumbnail_url: dto.thumbnail_url }),
        ...(dto.status && { status: dto.status as any }),
        ...(dto.category_id && { category_id: dto.category_id }),
        ...(dto.module !== undefined && { module: dto.module }),
        ...(dto.tags && { tags: dto.tags }),
        ...(dto.is_featured !== undefined && { is_featured: dto.is_featured }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        ...(dto.store_id !== undefined && { store_id: dto.store_id }),
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true, icon: true },
        },
      },
    });

    return {
      ...updated,
      thumbnail_url: await this.resolveMediaUrl(updated.thumbnail_url),
      video_url: await this.resolveMediaUrl(updated.video_url),
    };
  }

  async deleteVideo(id: number) {
    const video = await this.globalPrisma.videos.findUnique({
      where: { id },
    });

    if (!video) {
      throw new VendixHttpException(ErrorCodes.VIDEO_NOT_FOUND);
    }

    await this.globalPrisma.videos.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ==========================================
  // STATS
  // ==========================================

  async getVideoStats() {
    const [total, published, draft, viewsResult] = await Promise.all([
      this.globalPrisma.videos.count(),
      this.globalPrisma.videos.count({ where: { status: 'PUBLISHED' } }),
      this.globalPrisma.videos.count({ where: { status: 'DRAFT' } }),
      this.globalPrisma.videos.aggregate({
        _sum: { view_count: true },
      }),
    ]);

    return {
      total,
      published,
      draft,
      total_views: viewsResult._sum.view_count || 0,
    };
  }

  // ==========================================
  // CATEGORIES CRUD
  // ==========================================

  async findAllCategories() {
    return this.globalPrisma.video_categories.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { videos: true },
        },
      },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    const baseSlug = this.generateSlug(dto.name);
    const existing = await this.globalPrisma.video_categories.findUnique({
      where: { slug: baseSlug },
    });
    const slug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;

    return this.globalPrisma.video_categories.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description || null,
        icon: dto.icon || null,
        sort_order: dto.sort_order || 0,
        is_active: dto.is_active !== undefined ? dto.is_active : true,
      },
    });
  }

  async updateCategory(id: number, dto: UpdateCategoryDto) {
    const category = await this.globalPrisma.video_categories.findUnique({
      where: { id },
    });

    if (!category) {
      throw new VendixHttpException(ErrorCodes.VIDEO_CATEGORY_NOT_FOUND);
    }

    let slug: string | undefined;
    if (dto.name && dto.name !== category.name) {
      const newSlug = this.generateSlug(dto.name);
      const existing = await this.globalPrisma.video_categories.findFirst({
        where: { slug: newSlug, id: { not: id } },
      });
      slug = existing ? `${newSlug}-${Date.now()}` : newSlug;
    }

    return this.globalPrisma.video_categories.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(slug && { slug }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.icon !== undefined && { icon: dto.icon }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });
  }

  async deleteCategory(id: number) {
    const category = await this.globalPrisma.video_categories.findUnique({
      where: { id },
      include: {
        _count: {
          select: { videos: true },
        },
      },
    });

    if (!category) {
      throw new VendixHttpException(ErrorCodes.VIDEO_CATEGORY_NOT_FOUND);
    }

    if (category._count.videos > 0) {
      throw new VendixHttpException(ErrorCodes.VIDEO_CATEGORY_HAS_VIDEOS);
    }

    await this.globalPrisma.video_categories.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ==========================================
  // THUMBNAIL UPLOAD
  // ==========================================

  async uploadThumbnail(file: Express.Multer.File) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.HELP_IMAGE_REQUIRED);
    }

    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.HELP_IMAGE_TYPE_INVALID);
    }

    const s3Path = await this.s3Service.uploadImage(file, ImageContext.ARTICLE);
    const signedUrl = await this.s3Service.signUrl(s3Path);

    return {
      key: s3Path,
      url: signedUrl,
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private generateSlug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);
  }

  private parseVideoUrl(
    url: string,
    existingSource?: VideoSourceTypeEnum,
  ): { video_source: VideoSourceTypeEnum; external_id?: string } {
    if (!url) {
      return { video_source: existingSource || VideoSourceTypeEnum.YOUTUBE };
    }

    // YouTube regex
    const ytMatch = url.match(
      /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    );
    if (ytMatch) {
      return { video_source: VideoSourceTypeEnum.YOUTUBE, external_id: ytMatch[1] };
    }

    // Loom regex
    const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    if (loomMatch) {
      return { video_source: VideoSourceTypeEnum.LOOM, external_id: loomMatch[1] };
    }

    // Vimeo regex
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      return { video_source: VideoSourceTypeEnum.VIMEO, external_id: vimeoMatch[1] };
    }

    return {
      video_source: existingSource || (url.includes('s3') ? VideoSourceTypeEnum.DIRECT_S3 : VideoSourceTypeEnum.YOUTUBE),
    };
  }

  private async resolveMediaUrl(url: string | null | undefined): Promise<string | null> {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Assume S3 key
    try {
      return await this.s3Service.signUrl(url);
    } catch {
      return url;
    }
  }
}
