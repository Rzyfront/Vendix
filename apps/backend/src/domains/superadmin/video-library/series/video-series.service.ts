import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import {
  CreateVideoSeriesDto,
  UpdateVideoSeriesDto,
  VideoSeriesItemDto,
  VideoSeriesQueryDto,
} from './dto/video-series.dto';

export const LEARNING_PATH_CHANGED_EVENT = 'help.learning_path.changed';

export interface LearningPathChangedEvent {
  series_id: number;
  status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED' | 'DELETED';
}

const ITEMS_INCLUDE = {
  items: {
    orderBy: { position: 'asc' as const },
    include: {
      video: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          duration_seconds: true,
          thumbnail_url: true,
        },
      },
      article: { select: { id: true, title: true, slug: true } },
    },
  },
};

/**
 * Superadmin CRUD for video series (learning paths). Series, items and
 * progress live in global (unscoped) tables. FKs are RESTRICT by design, so
 * items are always removed explicitly inside the same transaction.
 */
@Injectable()
export class VideoSeriesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async findAll(query: VideoSeriesQueryDto) {
    const { page = 1, limit = 20, status, search } = query;
    const where: Record<string, unknown> = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { summary: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.video_series.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.video_series.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) || 1 },
    };
  }

  async findOne(id: number) {
    const series = await this.prisma.video_series.findUnique({
      where: { id },
      include: ITEMS_INCLUDE,
    });
    if (!series) this.notFound();
    return series;
  }

  async create(userId: number | undefined, dto: CreateVideoSeriesDto) {
    const items = dto.items ?? [];
    await this.assertItems(items);
    const slug = await this.uniqueSlug(dto.title);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const series = await tx.video_series.create({
        data: {
          title: dto.title,
          slug,
          summary: dto.summary ?? null,
          description: dto.description ?? null,
          module: dto.module ?? null,
          thumbnail_url: dto.thumbnail_url ?? null,
          sort_order: dto.sort_order ?? 0,
          status: 'DRAFT',
          created_by_id: userId ?? null,
        },
      });
      if (items.length) {
        await tx.video_series_items.createMany({
          data: this.toItemRows(series.id, items),
        });
      }
      return series;
    });
  }

  async update(id: number, dto: UpdateVideoSeriesDto) {
    const existing = await this.prisma.video_series.findUnique({
      where: { id },
    });
    if (!existing) this.notFound();
    if (dto.items) await this.assertItems(dto.items);

    const slug =
      dto.title && dto.title !== existing.title
        ? await this.uniqueSlug(dto.title, id)
        : undefined;

    const updated = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const series = await tx.video_series.update({
          where: { id },
          data: {
            ...(dto.title !== undefined && { title: dto.title }),
            ...(slug && { slug }),
            ...(dto.summary !== undefined && { summary: dto.summary }),
            ...(dto.description !== undefined && {
              description: dto.description,
            }),
            ...(dto.module !== undefined && { module: dto.module }),
            ...(dto.thumbnail_url !== undefined && {
              thumbnail_url: dto.thumbnail_url,
            }),
            ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
            updated_at: new Date(),
          },
        });
        if (dto.items) {
          await tx.video_series_items.deleteMany({ where: { series_id: id } });
          if (dto.items.length) {
            await tx.video_series_items.createMany({
              data: this.toItemRows(id, dto.items),
            });
          }
        }
        return series;
      },
    );

    if (existing.status === 'PUBLISHED') this.emitChanged(id, 'PUBLISHED');
    return updated;
  }

  async publish(id: number) {
    const series = await this.prisma.video_series.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!series) this.notFound();
    if (!series.items?.length) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Agrega al menos un video antes de publicar la serie.',
      );
    }
    const updated = await this.prisma.video_series.update({
      where: { id },
      data: { status: 'PUBLISHED', updated_at: new Date() },
    });
    this.emitChanged(id, 'PUBLISHED');
    return updated;
  }

  async unpublish(id: number) {
    const series = await this.prisma.video_series.findUnique({ where: { id } });
    if (!series) this.notFound();
    const updated = await this.prisma.video_series.update({
      where: { id },
      data: { status: 'DRAFT', updated_at: new Date() },
    });
    this.emitChanged(id, 'DRAFT');
    return updated;
  }

  async remove(id: number) {
    const series = await this.prisma.video_series.findUnique({ where: { id } });
    if (!series) this.notFound();
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.video_series_items.deleteMany({ where: { series_id: id } });
      await tx.video_series.delete({ where: { id } });
    });
    this.emitChanged(id, 'DELETED');
    return { deleted: 1 };
  }

  // ---- helpers ----

  private emitChanged(series_id: number, status: LearningPathChangedEvent['status']) {
    const payload: LearningPathChangedEvent = { series_id, status };
    this.events.emit(LEARNING_PATH_CHANGED_EVENT, payload);
  }

  private notFound(): never {
    throw new VendixHttpException(
      ErrorCodes.SYS_NOT_FOUND_001,
      'No se encontró la serie de videos.',
    );
  }

  private toItemRows(seriesId: number, items: VideoSeriesItemDto[]) {
    return items.map((item, index) => ({
      series_id: seriesId,
      video_id: item.video_id,
      article_id: item.article_id ?? null,
      position: index + 1,
    }));
  }

  private async assertItems(items: VideoSeriesItemDto[]) {
    const ids = items.map((i) => i.video_id);
    if (new Set(ids).size !== ids.length) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Un video no puede repetirse dentro de la misma serie.',
      );
    }
    if (!ids.length) return;
    const found = await this.prisma.videos.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new VendixHttpException(
        ErrorCodes.VIDEO_NOT_FOUND,
        'Alguno de los videos de la serie ya no existe.',
      );
    }
  }

  private async uniqueSlug(title: string, excludeId?: number): Promise<string> {
    const base = this.slugify(title) || 'serie';
    const clash = await this.prisma.video_series.findUnique({
      where: { slug: base },
    });
    return clash && clash.id !== excludeId ? `${base}-${Date.now()}` : base;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 200);
  }
}
