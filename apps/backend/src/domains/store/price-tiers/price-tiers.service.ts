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
import { resolvePackSize } from '../products/services/packaging.util';
import { resolveTierPricingCostAnchor } from '../products/services/tier-margin.util';
import { assertTiersAllowed } from '../products/services/tiers-variants-exclusive.util';

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
          kind: dto.kind ?? 'customer_tier',
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
      kind,
      sort_by = 'sort_order',
      sort_order = 'asc',
    } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.price_tiersWhereInput = {
      ...(is_active !== undefined && { is_active }),
      // Sin `kind` la lista devuelve los dos ejes, que es lo que necesitan las
      // pantallas de administración; los selectores siempre lo pasan.
      ...(kind !== undefined && { kind }),
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

    // Una presentación que YA descontó stock por empaque no puede volver a ser
    // tarifa de cliente: las líneas vendidas quedarían apuntando a una tarifa
    // cuyo eje ya no explica su `stock_units_consumed`.
    if (dto.kind === 'customer_tier' && existing.kind === 'sale_unit') {
      const soldWithPackaging = await this.prisma.order_items.findFirst({
        where: {
          applied_price_tier_id: id,
          stock_units_consumed: { not: null },
        },
        select: { id: true },
      });
      if (soldWithPackaging) {
        throw new VendixHttpException(ErrorCodes.PRICE_TIER_KIND_LOCKED);
      }
    }

    const data: Prisma.price_tiersUpdateInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.kind !== undefined && { kind: dto.kind }),
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

    const [overrides, assignments] = await Promise.all([
      this.prisma.product_price_tier_overrides.findMany({
        where: { product_id: productId },
        include: {
          price_tier: {
            select: {
              id: true,
              name: true,
              code: true,
              kind: true,
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
      }),
      this.prisma.product_price_tier_assignments.findMany({
        where: { product_id: productId },
        select: { price_tier_id: true, is_default: true },
      }),
    ]);

    // `is_default` vive en el assignment (es del par producto+presentación, no
    // del override, que además puede ser por variante). Se proyecta acá para
    // que el editor lea una sola forma por fila.
    const defaultByTierId = new Map(
      assignments.map((a) => [a.price_tier_id, a.is_default]),
    );

    return overrides.map((override) => ({
      ...override,
      is_default: defaultByTierId.get(override.price_tier_id) ?? false,
    }));
  }

  /**
   * Upsert an override price for (product_id, variant_id?, price_tier_id).
   * Uses the (product_id, variant_id, price_tier_id) unique constraint.
   *
   * Además del precio y el empaque, resuelve dos cosas nuevas:
   *
   * - **Margen cost-anchor** (QUI-425): el margen es un markup sobre el costo
   *   del PAQUETE (`cost_price * packSize`). Si llegan precio y margen juntos,
   *   el precio explícito gana y el margen se recalcula a partir de él.
   * - **Presentación por defecto**: `is_default` se escribe en
   *   `product_price_tier_assignments` (no en el override), porque el default
   *   es del par producto+presentación y no depende de la variante. Marcarlo
   *   habilita el par si hacía falta y desmarca el default anterior del mismo
   *   producto en la MISMA transacción, para que el índice único parcial nunca
   *   vea dos `true` a la vez.
   */
  async upsertProductOverride(
    productId: number,
    tierId: number,
    dto: UpsertProductPriceTierOverrideDto,
  ) {
    const tier = await this.findOne(tierId);

    const product = await this.prisma.products.findFirst({
      where: { id: productId },
      select: { id: true, cost_price: true },
    });
    if (!product) {
      throw new VendixHttpException(
        ErrorCodes.PRICE_TIER_OVERRIDE_PRODUCT_001,
      );
    }

    // Multi-tarifa ⊕ variantes: habilitar una presentación sobre un producto
    // con variantes queda prohibido en el punto de escritura, no solo en la UI.
    if (tier.kind === 'sale_unit') {
      await assertTiersAllowed(this.prisma as any, productId, {
        action: 'upsert_sale_unit_override',
      });
    }

    // Solo una unidad de venta puede ser la presentación por defecto. El índice
    // único parcial no puede validarlo (kind vive en otra tabla), así que la
    // regla se enforcea acá.
    if (dto.is_default === true && tier.kind !== 'sale_unit') {
      throw new VendixHttpException(
        ErrorCodes.PRICE_TIER_DEFAULT_NOT_SALE_UNIT,
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

    // El costo de referencia es el de la variante cuando la hay; si no, el del
    // producto. Sin costo el margen no es calculable y queda null.
    let unitCost = Number(product.cost_price ?? 0);
    if (variantId != null) {
      const variant = await this.prisma.product_variants.findFirst({
        where: { id: variantId, product_id: productId },
        select: { cost_price: true },
      });
      if (variant?.cost_price != null) {
        unitCost = Number(variant.cost_price);
      }
    }

    // packSize efectivo para medir el margen: el override enviado gana sobre el
    // del tier, igual que en la cascada de `packaging.util`.
    const packSize = resolvePackSize(
      tier.units_per_package,
      dto.override_units_per_package ?? existing?.override_units_per_package,
    );

    const { override_price: overridePrice, override_profit_margin: overrideMargin } =
      resolveTierPricingCostAnchor({
        unitCost,
        packSize,
        overridePrice: dto.override_price,
        overrideMargin: dto.override_profit_margin,
      });
    const overrideUnitsPerPackage = dto.override_units_per_package ?? null;

    return this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.product_price_tier_overrides.update({
            where: { id: existing.id },
            data: {
              override_price: overridePrice,
              override_profit_margin: overrideMargin,
              override_units_per_package: overrideUnitsPerPackage,
              updated_at: new Date(),
            },
          })
        : await tx.product_price_tier_overrides.create({
            data: {
              product_id: productId,
              variant_id: variantId,
              price_tier_id: tierId,
              override_price: overridePrice,
              override_profit_margin: overrideMargin,
              override_units_per_package: overrideUnitsPerPackage,
              updated_at: new Date(),
            },
          });

      if (dto.is_default !== undefined) {
        await this.applyDefaultAssignment(
          tx,
          productId,
          tierId,
          dto.is_default,
        );
      }

      return row;
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

  /**
   * Escribe la presentación por defecto del producto dentro de una transacción.
   *
   * El orden es obligatorio: **primero se desmarca** el default anterior y solo
   * después se marca el nuevo. Al revés, el índice único parcial
   * `(product_id) WHERE is_default` vería dos filas en `true` a mitad de la
   * transacción y abortaría.
   *
   * Marcar una presentación como default también **habilita** el par
   * (producto, presentación): `product_price_tier_assignments` es el allowlist
   * que consulta la venta, y un default sin assignment fallaría recién al
   * vender con `PRICE_TIER_NOT_ALLOWED`.
   *
   * El cliente del `$transaction` NO conserva el scoping de tenant, así que
   * este método solo se invoca con `productId`/`tierId` ya validados contra el
   * store por el caller.
   */
  private async applyDefaultAssignment(
    tx: Prisma.TransactionClient,
    productId: number,
    tierId: number,
    isDefault: boolean,
  ): Promise<void> {
    if (!isDefault) {
      await tx.product_price_tier_assignments.updateMany({
        where: { product_id: productId, price_tier_id: tierId },
        data: { is_default: false },
      });
      return;
    }

    await tx.product_price_tier_assignments.updateMany({
      where: {
        product_id: productId,
        is_default: true,
        NOT: { price_tier_id: tierId },
      },
      data: { is_default: false },
    });

    await tx.product_price_tier_assignments.upsert({
      where: {
        product_id_price_tier_id: {
          product_id: productId,
          price_tier_id: tierId,
        },
      },
      update: { is_default: true },
      create: {
        product_id: productId,
        price_tier_id: tierId,
        is_default: true,
      },
    });
  }

  private async unsetOtherDefaults(currentId: number): Promise<void> {
    await this.prisma.price_tiers.updateMany({
      where: { is_default: true, NOT: { id: currentId } },
      data: { is_default: false, updated_at: new Date() },
    });
  }
}
