import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { QueryPromotionsDto } from './dto/query-promotions.dto';

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryPromotionsDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      state,
      type,
      scope,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.promotionsWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(state && { state: state as any }),
      ...(type && { type: type as any }),
      ...(scope && { scope: scope as any }),
    };

    const [data, total] = await Promise.all([
      this.prisma.promotions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          _count: {
            select: {
              promotion_products: true,
              promotion_categories: true,
            },
          },
        },
      }),
      this.prisma.promotions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const promotion = await this.prisma.promotions.findFirst({
      where: { id },
      include: {
        promotion_products: {
          include: {
            products: {
              select: { id: true, name: true, sku: true, base_price: true },
            },
          },
        },
        promotion_categories: {
          include: {
            categories: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: {
            order_promotions: true,
          },
        },
      },
    });

    if (!promotion) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return promotion;
  }

  async getSummary() {
    const now = new Date();

    const [total_active, total_scheduled, usage_agg, discount_agg] =
      await Promise.all([
        this.prisma.promotions.count({
          where: {
            state: 'active',
            start_date: { lte: now },
            OR: [{ end_date: null }, { end_date: { gte: now } }],
          },
        }),
        this.prisma.promotions.count({
          where: {
            state: { in: ['active', 'scheduled'] },
            start_date: { gt: now },
          },
        }),
        this.prisma.promotions.aggregate({
          where: { state: { in: ['active', 'paused', 'expired'] } },
          _sum: { usage_count: true },
        }),
        this.prisma.order_promotions.aggregate({
          _sum: { discount_amount: true },
        }),
      ]);

    return {
      total_active,
      total_scheduled,
      total_usage: usage_agg._sum.usage_count || 0,
      total_discount_given: Number(discount_agg._sum.discount_amount || 0),
    };
  }

  async getActive() {
    const now = new Date();

    return this.prisma.promotions.findMany({
      where: {
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
      },
      include: {
        promotion_products: true,
        promotion_categories: true,
      },
      orderBy: { priority: 'desc' },
    });
  }

  async create(dto: CreatePromotionDto) {
    const scope = dto.scope || 'order';
    const { product_ids, category_ids, ...promotionData } = dto;

    // Normalize payload: only keep IDs that match the configured scope.
    const normalizedProductIds =
      scope === 'product' ? this.sanitizeIds(product_ids) : [];
    const normalizedCategoryIds =
      scope === 'category' ? this.sanitizeIds(category_ids) : [];

    this.validateScopeSelection(scope, normalizedProductIds, normalizedCategoryIds);

    const data: any = {
      ...promotionData,
      scope,
      start_date: new Date(dto.start_date),
      end_date: dto.end_date ? new Date(dto.end_date) : null,
      state: 'draft',
      usage_count: 0,
    };

    // Nested create for product associations (only when scope === 'product')
    if (normalizedProductIds.length) {
      data.promotion_products = {
        create: normalizedProductIds.map((product_id) => ({ product_id })),
      };
    }

    // Nested create for category associations (only when scope === 'category')
    if (normalizedCategoryIds.length) {
      data.promotion_categories = {
        create: normalizedCategoryIds.map((category_id) => ({ category_id })),
      };
    }

    return this.prisma.promotions.create({
      data,
      include: {
        promotion_products: true,
        promotion_categories: true,
      },
    });
  }

  async update(id: number, dto: UpdatePromotionDto) {
    const existing = await this.prisma.promotions.findFirst({
      where: { id },
      include: {
        promotion_products: true,
        promotion_categories: true,
      },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    const { product_ids, category_ids, ...updateData } = dto;
    const effectiveScope = (dto.scope || existing.scope) as
      | 'order'
      | 'product'
      | 'category';

    // Resolve effective ID arrays after merging with existing values.
    const mergedProductIds =
      product_ids ?? existing.promotion_products.map((pp) => pp.product_id);
    const mergedCategoryIds =
      category_ids ?? existing.promotion_categories.map((pc) => pc.category_id);

    // Normalize: ignore IDs that do not belong to the effective scope.
    const normalizedProductIds =
      effectiveScope === 'product' ? this.sanitizeIds(mergedProductIds) : [];
    const normalizedCategoryIds =
      effectiveScope === 'category' ? this.sanitizeIds(mergedCategoryIds) : [];

    this.validateScopeSelection(
      effectiveScope,
      normalizedProductIds,
      normalizedCategoryIds,
    );

    // Prepare date conversions
    const data: any = { ...updateData };
    if (dto.scope) data.scope = effectiveScope;
    if (dto.start_date) data.start_date = new Date(dto.start_date);
    if (dto.end_date !== undefined) {
      data.end_date = dto.end_date ? new Date(dto.end_date) : null;
    }

    // Decide whether to rewrite each association table.
    // - If user sent the field explicitly, replace with normalized value.
    // - If user changed scope away from product/category, clear the now-orphan IDs.
    const shouldRewriteProducts =
      product_ids !== undefined || effectiveScope !== 'product';
    const shouldRewriteCategories =
      category_ids !== undefined || effectiveScope !== 'category';

    return this.prisma.$transaction(async (tx) => {
      if (shouldRewriteProducts) {
        await tx.promotion_products.deleteMany({
          where: { promotion_id: id },
        });
        if (normalizedProductIds.length) {
          await tx.promotion_products.createMany({
            data: normalizedProductIds.map((product_id) => ({
              promotion_id: id,
              product_id,
            })),
          });
        }
      }

      if (shouldRewriteCategories) {
        await tx.promotion_categories.deleteMany({
          where: { promotion_id: id },
        });
        if (normalizedCategoryIds.length) {
          await tx.promotion_categories.createMany({
            data: normalizedCategoryIds.map((category_id) => ({
              promotion_id: id,
              category_id,
            })),
          });
        }
      }

      return tx.promotions.update({
        where: { id },
        data,
        include: {
          promotion_products: true,
          promotion_categories: true,
        },
      });
    });
  }

  async activate(id: number) {
    const promotion = await this.prisma.promotions.findFirst({
      where: { id },
    });

    if (!promotion) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    const now = new Date();
    const new_state =
      new Date(promotion.start_date) > now ? 'scheduled' : 'active';

    return this.prisma.promotions.update({
      where: { id },
      data: { state: new_state },
    });
  }

  async pause(id: number) {
    const promotion = await this.prisma.promotions.findFirst({
      where: { id },
    });

    if (!promotion) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return this.prisma.promotions.update({
      where: { id },
      data: { state: 'paused' },
    });
  }

  async cancel(id: number) {
    const promotion = await this.prisma.promotions.findFirst({
      where: { id },
    });

    if (!promotion) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return this.prisma.promotions.update({
      where: { id },
      data: { state: 'cancelled' },
    });
  }

  async remove(id: number) {
    const promotion = await this.prisma.promotions.findFirst({
      where: { id },
    });

    if (!promotion) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (promotion.state !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Solo se pueden eliminar promociones en estado borrador',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.promotion_products.deleteMany({
        where: { promotion_id: id },
      });
      await tx.promotion_categories.deleteMany({
        where: { promotion_id: id },
      });
      await tx.promotions.delete({ where: { id } });
    });
  }

  private validateScopeSelection(
    scope: 'order' | 'product' | 'category',
    productIds?: number[],
    categoryIds?: number[],
  ): void {
    if (scope === 'product' && (!productIds || productIds.length === 0)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Selecciona al menos un producto para esta promocion',
      );
    }

    if (scope === 'category' && (!categoryIds || categoryIds.length === 0)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Selecciona al menos una categoria para esta promocion',
      );
    }

    if (scope !== 'product' && scope !== 'category' && scope !== 'order') {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'El alcance de la promocion no es valido',
      );
    }
  }

  /**
   * Sanitize a list of incoming IDs:
   * - drops null/undefined/NaN/<=0 entries
   * - coerces numeric strings to numbers
   * - removes duplicates preserving order
   */
  private sanitizeIds(ids?: Array<number | string | null | undefined>): number[] {
    if (!Array.isArray(ids)) return [];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const raw of ids) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const intVal = Math.trunc(n);
      if (seen.has(intVal)) continue;
      seen.add(intVal);
      out.push(intVal);
    }
    return out;
  }
}
