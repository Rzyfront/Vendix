import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { sellableStockLevelsWhere } from '../helpers/pos-stock-scope.helper';

/** One sellable `stock_levels` row reduced to what allocation needs. */
export interface SellableStockLevel {
  location_id: number;
  quantity_available: number;
}

/** One slice of a line: deduct `quantity` units from `location_id`. */
export interface StockAllocationSlice {
  location_id: number;
  quantity: number;
}

export interface StockAllocation {
  /** Slices that cover (part of) the requested quantity, in deduction order. */
  slices: StockAllocationSlice[];
  /** Units actually covered by `slices` (≤ requested). */
  allocated: number;
  /** Total available across every sellable location of the store. */
  available: number;
  /** Units the sellable set cannot cover (`requested - allocated`, ≥ 0). */
  shortfall: number;
}

/**
 * Allocates a delivery line across the store's SELLABLE locations (QUI-559).
 *
 * Before this service, availability was aggregated across locations but the
 * reservation and the deduction ran against a SINGLE location: a line whose
 * total was covered only by summing two warehouses passed validation and then
 * failed at commit time with `INV_STOCK_002` ("disponible 8, requerido 10").
 * The stock existed and was sellable — it was merely split.
 *
 * The service answers one question: "which locations, and how many units from
 * each, cover this quantity?". It never mutates stock; the caller keeps using
 * `StockLevelManager` primitives per slice, so costing, movements and
 * reservations behave exactly as before — only the number of calls changes.
 */
@Injectable()
export class SellableStockAllocator {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Read the sellable stock levels of one inventory identity, ordered by
   * available units descending (then `location_id` for determinism).
   *
   * `product_variant_id` is filtered explicitly — including the `null` case —
   * because the identity of a `stock_levels` row is the
   * `(product_id, product_variant_id, location_id)` triple: a base line must
   * never absorb its variants' rows.
   */
  async getSellableLevels(
    storeId: number,
    productId: number,
    variantId: number | undefined,
    tx?: Prisma.TransactionClient,
    includeLocationIds: number[] = [],
  ): Promise<SellableStockLevel[]> {
    const db: any = tx ?? this.prisma;
    // `includeLocationIds` widens the set with locations the caller is already
    // committed to (an active reservation). A reservation is an explicit
    // commitment to a location: honouring it even when the location later
    // stopped being sellable keeps orders reserved before this rule existed
    // deliverable, instead of blocking them retroactively.
    const where: any = {
      product_id: productId,
      product_variant_id: variantId ?? null,
    };
    const sellable = sellableStockLevelsWhere(storeId);
    if (includeLocationIds.length > 0) {
      where.OR = [sellable, { location_id: { in: includeLocationIds } }];
    } else {
      Object.assign(where, sellable);
    }

    const rows = await db.stock_levels.findMany({
      where,
      select: { location_id: true, quantity_available: true },
      orderBy: [{ quantity_available: 'desc' }, { location_id: 'asc' }],
    });
    return rows.map((r: any) => ({
      location_id: r.location_id,
      quantity_available: Number(r.quantity_available ?? 0),
    }));
  }

  /**
   * Split `quantity` across `levels`, taking as much as possible from each.
   *
   * `preferredLocationIds` are consumed first regardless of how much they
   * hold: they are the locations the operator already committed to (an active
   * reservation, or the dispatch line's own location), so honouring them keeps
   * the physical intent of the movement. The rest is filled largest-first,
   * which minimises the number of locations a single line touches.
   *
   * Pure function: no queries, no mutation — trivially unit-testable.
   */
  allocate(
    quantity: number,
    levels: SellableStockLevel[],
    preferredLocationIds: number[] = [],
  ): StockAllocation {
    const available = levels.reduce(
      (sum, l) => sum + Math.max(0, l.quantity_available),
      0,
    );

    const byPreference = [
      ...preferredLocationIds
        .map((id) => levels.find((l) => l.location_id === id))
        .filter((l): l is SellableStockLevel => !!l),
      ...levels.filter((l) => !preferredLocationIds.includes(l.location_id)),
    ];

    const slices: StockAllocationSlice[] = [];
    let remaining = Math.max(0, quantity);

    for (const level of byPreference) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Math.max(0, level.quantity_available));
      if (take <= 0) continue;
      slices.push({ location_id: level.location_id, quantity: take });
      remaining -= take;
    }

    const allocated = Math.max(0, quantity) - remaining;
    return { slices, allocated, available, shortfall: remaining };
  }

  /**
   * Convenience: read + allocate in one call.
   */
  async allocateForLine(
    storeId: number,
    productId: number,
    variantId: number | undefined,
    quantity: number,
    preferredLocationIds: number[] = [],
    tx?: Prisma.TransactionClient,
  ): Promise<StockAllocation> {
    const levels = await this.getSellableLevels(
      storeId,
      productId,
      variantId,
      tx,
      preferredLocationIds,
    );
    return this.allocate(quantity, levels, preferredLocationIds);
  }

  /**
   * Absorb an uncovered remainder into a single location so a NON-blocking
   * caller still deducts the full quantity.
   *
   * Only the dispatch-delivery path uses this: the merchandise physically left
   * the warehouse, so refusing to deduct would leave phantom stock. The
   * remainder lands on the caller's intended location (or the largest sellable
   * one), reproducing the pre-existing floor-0 behaviour of a single-location
   * deduction.
   */
  absorbShortfall(
    allocation: StockAllocation,
    fallbackLocationId: number,
  ): StockAllocationSlice[] {
    if (allocation.shortfall <= 0) return allocation.slices;

    const slices = allocation.slices.map((s) => ({ ...s }));
    const target = slices.find((s) => s.location_id === fallbackLocationId);
    if (target) {
      target.quantity += allocation.shortfall;
      return slices;
    }
    slices.push({
      location_id: fallbackLocationId,
      quantity: allocation.shortfall,
    });
    return slices;
  }
}
