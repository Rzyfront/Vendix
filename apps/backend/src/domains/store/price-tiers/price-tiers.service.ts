import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreatePriceTierDto,
  UpdatePriceTierDto,
  PriceTierQueryDto,
  UpsertProductPriceTierOverrideDto,
} from './dto';

/**
 * PriceTiersService
 *
 * Store-scoped CRUD for `price_tiers` and `product_price_tier_overrides`.
 * All operations rely on `StorePrismaService` auto-scoping so cross-store
 * leakage is impossible.
 */
@Injectable()
export class PriceTiersService {
  constructor(private prisma: StorePrismaService) {}

  // ------------------------------------------------------------------ Tiers

  async create(dto: CreatePriceTierDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Enforce unique (store_id, name)
    const existing = await this.prisma.price_tiers.findFirst({
      where: { name: dto.name },
    });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.PRICE_TIER_DUP_001);
    }

    // Packaging quantity owns the package flag: a tier is a package unit
    // whenever units_per_package >= 2. Falls back to the explicit flag when
    // no quantity is provided.
    const unitsPerPackage = dto.units_per_package ?? null;
    const isPackageUnit =
      unitsPerPackage != null
        ? unitsPerPackage >= 2
        : (dto.is_package_unit ?? false);

    try {
      const created = await this.prisma.price_tiers.create({
        data: {
          store_id,
          name: dto.name,
          code: dto.code ?? null,
          description: dto.description ?? null,
          discount_percentage: dto.discount_percentage ?? 0,
          is_active: dto.is_active ?? true,
          is_default: dto.is_default ?? false,
          is_package_unit: isPackageUnit,
          units_per_package: unitsPerPackage,
          sort_order: dto.sort_order ?? 0,
          updated_at: new Date(),
        },
      });

      // Only one default at a time per store.
      if (created.is_default) {
        await this.unsetOtherDefaults(created.id);
      }

      return created;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_DUP_001);
      }
      throw error;
    }
  }

  async findAll(query: PriceTierQueryDto) {
    const {
      page = 1,
      limit = 50,
      search,
      is_active,
      sort_by = 'sort_order',
      sort_order = 'asc',
    } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.price_tiersWhereInput = {
      ...(is_active !== undefined && { is_active }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.price_tiers.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order === 'desc' ? 'desc' : 'asc' },
      }),
      this.prisma.price_tiers.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const tier = await this.prisma.price_tiers.findFirst({ where: { id } });
    if (!tier) {
      throw new VendixHttpException(ErrorCodes.PRICE_TIER_FIND_001);
    }
    return tier;
  }

  async update(id: number, dto: UpdatePriceTierDto) {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const dup = await this.prisma.price_tiers.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (dup) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_DUP_001);
      }
    }

    const data: Prisma.price_tiersUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.discount_percentage !== undefined && {
        discount_percentage: dto.discount_percentage,
      }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.is_default !== undefined && { is_default: dto.is_default }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
      updated_at: new Date(),
    };

    // Packaging quantity owns the package flag. When units_per_package is
    // provided we persist it AND derive is_package_unit = (qty >= 2) so the
    // two stay consistent. Otherwise fall back to the explicit flag if sent.
    if (dto.units_per_package !== undefined) {
      data.units_per_package = dto.units_per_package;
      data.is_package_unit = (dto.units_per_package ?? 0) >= 2;
    } else if (dto.is_package_unit !== undefined) {
      data.is_package_unit = dto.is_package_unit;
    }

    const updated = await this.prisma.price_tiers.update({
      where: { id },
      data,
    });

    if (dto.is_default === true) {
      await this.unsetOtherDefaults(id);
    }

    return updated;
  }

  /** Soft delete: deactivate the tier so old snapshots stay consistent. */
  async softDelete(id: number) {
    await this.findOne(id);
    return this.prisma.price_tiers.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  async restore(id: number) {
    await this.findOne(id);
    return this.prisma.price_tiers.update({
      where: { id },
      data: { is_active: true, updated_at: new Date() },
    });
  }

  // ----------------------------------------------------------- Overrides

  async findOverridesByProduct(productId: number) {
    // Auto-scoped: product.store_id has to match context store_id.
    const product = await this.prisma.products.findFirst({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new VendixHttpException(
        ErrorCodes.PRICE_TIER_OVERRIDE_PRODUCT_001,
      );
    }

    return this.prisma.product_price_tier_overrides.findMany({
      where: { product_id: productId },
      include: {
        price_tier: {
          select: {
            id: true,
            name: true,
            code: true,
            discount_percentage: true,
            is_active: true,
            is_default: true,
            is_package_unit: true,
            units_per_package: true,
          },
        },
        variant: {
          select: { id: true, sku: true, name: true },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Upsert an override price for (product_id, variant_id?, price_tier_id).
   * Uses the (product_id, variant_id, price_tier_id) unique constraint.
   */
  async upsertProductOverride(
    productId: number,
    tierId: number,
    dto: UpsertProductPriceTierOverrideDto,
  ) {
    await this.findOne(tierId);

    const product = await this.prisma.products.findFirst({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new VendixHttpException(
        ErrorCodes.PRICE_TIER_OVERRIDE_PRODUCT_001,
      );
    }

    const variantId = dto.variant_id ?? null;

    // Avoid using the named unique because nullable columns inside unique
    // constraints can produce P2009 with Prisma. Use findFirst + update/create.
    const existing =
      await this.prisma.product_price_tier_overrides.findFirst({
        where: {
          product_id: productId,
          variant_id: variantId,
          price_tier_id: tierId,
        },
      });

    // An override row may carry a price-only, a quantity-only, or both.
    // override_price is the price of the WHOLE PACKAGE; nullable.
    const overridePrice = dto.override_price ?? null;
    const overrideUnitsPerPackage = dto.override_units_per_package ?? null;

    if (existing) {
      return this.prisma.product_price_tier_overrides.update({
        where: { id: existing.id },
        data: {
          override_price: overridePrice,
          override_units_per_package: overrideUnitsPerPackage,
          updated_at: new Date(),
        },
      });
    }

    return this.prisma.product_price_tier_overrides.create({
      data: {
        product_id: productId,
        variant_id: variantId,
        price_tier_id: tierId,
        override_price: overridePrice,
        override_units_per_package: overrideUnitsPerPackage,
        updated_at: new Date(),
      },
    });
  }

  async removeProductOverride(
    productId: number,
    tierId: number,
    variantId?: number,
  ) {
    const existing =
      await this.prisma.product_price_tier_overrides.findFirst({
        where: {
          product_id: productId,
          variant_id: variantId ?? null,
          price_tier_id: tierId,
        },
      });

    if (!existing) {
      // Idempotent delete: nothing to do.
      return { deleted: false };
    }

    await this.prisma.product_price_tier_overrides.delete({
      where: { id: existing.id },
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------- Internals

  private async unsetOtherDefaults(currentId: number): Promise<void> {
    await this.prisma.price_tiers.updateMany({
      where: { is_default: true, NOT: { id: currentId } },
      data: { is_default: false, updated_at: new Date() },
    });
  }
}
