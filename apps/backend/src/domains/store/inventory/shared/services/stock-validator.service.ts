import {
  Injectable,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { StockLevelManager } from './stock-level-manager.service';
import { SellableStockAllocator } from './sellable-stock-allocator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Una unidad de demanda de stock: "necesito `quantity` de este
 * producto/variante". Usada tanto para líneas de orden (kind='product') como
 * para insumos de receta (kind='ingredient', resuelto por el caller antes de
 * llegar aquí — este servicio no conoce `recipe_items`).
 */
export interface StockDemandLine {
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
  /** Nombre a mostrar si no se puede resolver desde catálogo. */
  product_name?: string;
  /** Para insumos compartidos: qué plato/línea generó esta demanda. */
  used_by?: string;
}

/** Una identidad (producto/variante o insumo) que no alcanza para cubrir lo pedido. */
export interface InsufficientStockItem {
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  kind: 'product' | 'ingredient';
  requested: number;
  available: number;
  used_by?: string[];
}

export interface StockValidationParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity: number;
}

export interface CartItem {
  product_id: number;
  variant_id?: number;
  quantity: number;
}

export interface CartValidationResult {
  isValid: boolean;
  insufficientItems: Array<{
    product_id: number;
    variant_id?: number;
    requested: number;
    available: number;
  }>;
  errors: string[];
}

export interface AvailabilityResult {
  isAvailable: boolean;
  product_id: number;
  variant_id?: number;
  requested: number;
  available: number;
  location_id?: number;
}

/**
 * StockValidatorService
 *
 * Provides read-only stock validation using StockLevelManager.
 * Source of truth: stock_levels.quantity_available (NOT denormalized stock_quantity)
 *
 * Key rules:
 * - Uses StockLevelManager for all stock queries (no direct prisma access to stock_levels)
 * - Validates effective tracking before checking stock
 * - Returns detailed validation results for cart operations
 */
@Injectable()
export class StockValidatorService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly sellableStockAllocator: SellableStockAllocator,
  ) {}

  /**
   * Resolves effective inventory tracking for a product/variant combination.
   *
   * Rule:
   * - If variant.track_inventory_override != null, use that value
   * - Otherwise, fall back to product.track_inventory
   *
   * @returns true if inventory should be tracked, false otherwise
   */
  resolveEffectiveTracking(
    product: { track_inventory: boolean },
    variant?: { track_inventory_override: boolean | null },
  ): boolean {
    // Variant override takes precedence if explicitly set (not null)
    if (variant?.track_inventory_override != null) {
      return variant.track_inventory_override;
    }

    // Fall back to product-level tracking setting
    return product.track_inventory;
  }

  /**
   * Validates stock availability for an entire cart.
   *
   * Uses stock_levels.quantity_available as the source of truth.
   * Does NOT use the denormalized stock_quantity on products/variants.
   *
   * @param cart Array of cart items with product_id, variant_id (optional), and quantity
   * @param allowOversell If true, returns validation result without throwing
   * @param locationId Optional specific location to validate; if not provided, checks across all locations
   * @returns CartValidationResult with validation status and details
   * @throws ConflictException if allowOversell is false and stock is insufficient
   */
  async validateCart(
    cart: CartItem[],
    allowOversell = false,
    locationId?: number,
  ): Promise<CartValidationResult> {
    if (!cart || cart.length === 0) {
      return {
        isValid: true,
        insufficientItems: [],
        errors: [],
      };
    }

    const insufficientItems: CartValidationResult['insufficientItems'] = [];
    const errors: string[] = [];

    for (const item of cart) {
      // Get the effective stock at the specified location or across all locations
      const availability = await this.checkStockAtLocation(
        item.product_id,
        item.variant_id,
        locationId,
      );

      const totalAvailable = availability.reduce(
        (sum, sl) => sum + sl.quantity_available,
        0,
      );

      if (totalAvailable < item.quantity) {
        insufficientItems.push({
          product_id: item.product_id,
          variant_id: item.variant_id,
          requested: item.quantity,
          available: totalAvailable,
        });

        errors.push(
          `Insufficient stock for product ${item.product_id}${item.variant_id ? ` variant ${item.variant_id}` : ''}: requested ${item.quantity}, available ${totalAvailable}`,
        );
      }
    }

    const isValid = insufficientItems.length === 0;

    if (!isValid && !allowOversell) {
      throw new ConflictException({
        message: 'Insufficient stock for one or more items',
        insufficientItems,
      });
    }

    return {
      isValid,
      insufficientItems,
      errors,
    };
  }

  /**
   * Validates availability of a specific product/variant quantity.
   *
   * @param productId Product ID
   * @param variantId Optional variant ID
   * @param quantity Required quantity
   * @param locationId Optional specific location; if not provided, checks across all locations
   * @returns AvailabilityResult indicating if the quantity is available
   */
  async validateAvailability(
    productId: number,
    variantId: number | undefined,
    quantity: number,
    locationId?: number,
  ): Promise<AvailabilityResult> {
    if (quantity <= 0) {
      return {
        isAvailable: true,
        product_id: productId,
        variant_id: variantId,
        requested: quantity,
        available: 0,
        location_id: locationId,
      };
    }

    // Get stock levels using StockLevelManager
    const stockLevels = await this.checkStockAtLocation(
      productId,
      variantId,
      locationId,
    );

    const totalAvailable = stockLevels.reduce(
      (sum, sl) => sum + sl.quantity_available,
      0,
    );

    const isAvailable = totalAvailable >= quantity;

    // Find the primary location for the response (highest available)
    let primaryLocationId: number | undefined;
    if (stockLevels.length > 0) {
      const primary = stockLevels.reduce((prev, current) =>
        prev.quantity_available > current.quantity_available ? prev : current,
      );
      primaryLocationId = primary.location_id;
    }

    return {
      isAvailable,
      product_id: productId,
      variant_id: variantId,
      requested: quantity,
      available: totalAvailable,
      location_id: locationId ?? primaryLocationId,
    };
  }

  /**
   * Check stock levels at a specific location or across all locations.
   *
   * Delegates to `StockLevelManager.getStockLevels`, which is variant-exact
   * (QUI-557): `variantId` ausente significa la línea BASE, no "cualquier fila
   * del producto". Por eso agregar sin `locationId` suma únicamente filas de la
   * misma identidad de inventario y ya no mezcla base con variantes.
   */
  private async checkStockAtLocation(
    productId: number,
    variantId: number | undefined,
    locationId: number | undefined,
  ): Promise<Array<{ location_id: number; quantity_available: number }>> {
    // If locationId is provided, only check that specific location
    if (locationId != null) {
      const stockLevel = await this.getStockLevelAtLocation(
        productId,
        variantId,
        locationId,
      );
      return stockLevel ? [stockLevel] : [];
    }

    // Otherwise, get stock levels across all locations using StockLevelManager
    return this.stockLevelManager.getStockLevels(productId, variantId);
  }

  /**
   * Get stock level at a specific location.
   *
   * Agrega por `location_id` en vez de quedarse con la primera coincidencia
   * (QUI-557). El `@@unique(product_id, product_variant_id, location_id)`
   * garantiza una sola fila por identidad y bodega, así que la suma equivale a
   * esa fila; la diferencia está en que un resultado inesperado con varias
   * filas ya no se resuelve de forma no determinista con "gana la primera".
   */
  private async getStockLevelAtLocation(
    productId: number,
    variantId: number | undefined,
    locationId: number,
  ): Promise<{ location_id: number; quantity_available: number } | null> {
    const stockLevels = await this.stockLevelManager.getStockLevels(
      productId,
      variantId,
    );

    const atLocation = stockLevels.filter(
      (sl) => sl.location_id === locationId,
    );
    if (atLocation.length === 0) return null;

    return {
      location_id: locationId,
      quantity_available: atLocation.reduce(
        (sum, sl) => sum + Number(sl.quantity_available ?? 0),
        0,
      ),
    };
  }

  /**
   * Check if a product tracks inventory (considering variant override).
   * Convenience method combining resolveEffectiveTracking with product/variant data fetch.
   */
  async doesProductTrackInventory(
    productId: number,
    variantId?: number,
  ): Promise<boolean> {
    // Fetch product to get track_inventory
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
      select: { track_inventory: true },
    });

    if (!product) {
      throw new BadRequestException(`Product ${productId} not found`);
    }

    // Fetch variant if variantId provided to get track_inventory_override
    let variant: { track_inventory_override: boolean | null } | undefined;
    if (variantId != null) {
      variant = await this.prisma.product_variants.findUnique({
        where: { id: variantId },
        select: { track_inventory_override: true },
      });
    }

    return this.resolveEffectiveTracking(product, variant);
  }

  /**
   * No-overselling guard for order lines (docs/plans/no-overselling-stock-guard-plan.md).
   *
   * Throws `INV_STOCK_INSUFFICIENT_LINES` naming every product that cannot
   * cover its requested quantity. Untracked products/ingredients (effective
   * tracking `false`) and services are never validated — they are unlimited
   * by definition (`vendix-product-variants`).
   *
   * `opts.orderId`, when given, credits the order's OWN active reservation
   * back into "available" — re-validating a line that already reserved its
   * stock must not count that reservation as a shortfall against itself.
   */
  async assertLinesAvailable(
    lines: StockDemandLine[],
    opts: {
      orderId?: number;
      locationId?: number;
      tx?: Prisma.TransactionClient;
    } = {},
  ): Promise<void> {
    const items = await this.findInsufficientLines(lines, {
      ...opts,
      kind: 'product',
    });
    if (items.length === 0) return;

    throw new VendixHttpException(
      ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
      this.buildProductInsufficientMessage(items),
      { items },
    );
  }

  /**
   * No-overselling guard for recipe ingredients. The caller (kitchen-fire /
   * BOM explosion) already resolved recipe quantities into concrete
   * ingredient product demands — this service only checks catalog stock, it
   * never reads `recipe_items`.
   */
  async assertIngredientsAvailable(
    demands: StockDemandLine[],
    opts: { locationId?: number; tx?: Prisma.TransactionClient } = {},
  ): Promise<void> {
    const items = await this.findInsufficientLines(demands, {
      ...opts,
      kind: 'ingredient',
    });
    if (items.length === 0) return;

    throw new VendixHttpException(
      ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
      this.buildIngredientInsufficientMessage(items),
      { items },
    );
  }

  /**
   * Non-throwing core shared by {@link assertLinesAvailable} and
   * {@link assertIngredientsAvailable}. Aggregates demand by
   * `(product_id, product_variant_id)`, skips untracked/service items, and
   * compares the aggregated quantity against the SAME sellable scope used to
   * reserve and commit stock (`SellableStockAllocator` /
   * `sellableStockLevelsWhere`, QUI-559) — never a re-implemented aggregate.
   */
  async findInsufficientLines(
    lines: StockDemandLine[],
    opts: {
      orderId?: number;
      locationId?: number;
      tx?: Prisma.TransactionClient;
      kind: 'product' | 'ingredient';
    },
  ): Promise<InsufficientStockItem[]> {
    if (!lines || lines.length === 0) return [];

    const db: any = opts.tx ?? this.prisma;

    type Aggregate = {
      product_id: number;
      product_variant_id: number | null;
      quantity: number;
      used_by: string[];
      product_name?: string;
    };
    const aggregates = new Map<string, Aggregate>();

    for (const line of lines) {
      if (!(line.quantity > 0)) continue;
      const variantId = line.product_variant_id ?? null;
      const key = `${line.product_id}-${variantId ?? 'null'}`;
      const existing = aggregates.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        if (line.used_by && !existing.used_by.includes(line.used_by)) {
          existing.used_by.push(line.used_by);
        }
        if (!existing.product_name && line.product_name) {
          existing.product_name = line.product_name;
        }
      } else {
        aggregates.set(key, {
          product_id: line.product_id,
          product_variant_id: variantId,
          quantity: line.quantity,
          used_by: line.used_by ? [line.used_by] : [],
          product_name: line.product_name,
        });
      }
    }

    if (aggregates.size === 0) return [];

    const productIds = [...new Set(
      Array.from(aggregates.values()).map((a) => a.product_id),
    )];
    const variantIds = [...new Set(
      Array.from(aggregates.values())
        .map((a) => a.product_variant_id)
        .filter((v): v is number => v != null),
    )];

    const [products, variants] = await Promise.all([
      db.products.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          store_id: true,
          track_inventory: true,
          product_type: true,
          name: true,
        },
      }),
      variantIds.length > 0
        ? db.product_variants.findMany({
            where: { id: { in: variantIds } },
            select: { id: true, track_inventory_override: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const productById = new Map<number, any>(products.map((p: any) => [p.id, p]));
    const variantById = new Map<number, any>(variants.map((v: any) => [v.id, v]));

    const insufficient: InsufficientStockItem[] = [];

    for (const entry of aggregates.values()) {
      const product = productById.get(entry.product_id);
      // No podemos validar un producto que no existe; ese error es de otra
      // capa (existencia), no de esta (suficiencia de stock).
      if (!product) continue;
      if (product.product_type === 'service') continue;

      const variant =
        entry.product_variant_id != null
          ? variantById.get(entry.product_variant_id)
          : undefined;

      const effectiveTracking = this.resolveEffectiveTracking(product, variant);
      if (effectiveTracking === false) continue;

      const levels = await this.sellableStockAllocator.getSellableLevels(
        product.store_id,
        entry.product_id,
        entry.product_variant_id ?? undefined,
        opts.tx,
      );
      const scopedLevels =
        opts.locationId != null
          ? levels.filter((l) => l.location_id === opts.locationId)
          : levels;

      let available = scopedLevels.reduce(
        (sum, l) => sum + Math.max(0, l.quantity_available),
        0,
      );

      if (opts.kind === 'product' && opts.orderId != null) {
        const ownReservation = await db.stock_reservations.aggregate({
          where: {
            reserved_for_type: 'order',
            reserved_for_id: opts.orderId,
            product_id: entry.product_id,
            product_variant_id: entry.product_variant_id,
            status: 'active',
          },
          _sum: { quantity: true },
        });
        available += Number(ownReservation?._sum?.quantity ?? 0);
      }

      if (entry.quantity > available) {
        insufficient.push({
          product_id: entry.product_id,
          product_variant_id: entry.product_variant_id,
          product_name:
            variant?.name ?? product.name ?? entry.product_name ??
            `Producto ${entry.product_id}`,
          kind: opts.kind,
          requested: entry.quantity,
          available,
          used_by: entry.used_by.length > 0 ? entry.used_by : undefined,
        });
      }
    }

    return insufficient;
  }

  private buildProductInsufficientMessage(
    items: InsufficientStockItem[],
  ): string {
    const list = items
      .map(
        (i) => `${i.product_name} (pedido ${i.requested}, disponible ${i.available})`,
      )
      .join('; ');
    return `Sin stock suficiente: ${list}. Quítalo de la orden o desactiva «Maneja inventario» en el producto.`;
  }

  private buildIngredientInsufficientMessage(
    items: InsufficientStockItem[],
  ): string {
    const list = items
      .map((i) => {
        const usedByClause =
          i.used_by && i.used_by.length > 0
            ? `, usado en ${i.used_by.join(', ')}`
            : '';
        return `${i.product_name} (requerido ${i.requested}, disponible ${i.available}${usedByClause})`;
      })
      .join('; ');
    return `Insumo sin stock suficiente: ${list}. Ajusta la receta o reabastece el insumo antes de continuar.`;
  }
}
