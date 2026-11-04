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
  /**
   * Locations the allocation was RESTRICTED to ("Bodega de la caja"), or
   * `null`/absent when it ran over every sellable location. Non-blocking
   * callers absorb a shortfall into `restricted_location_ids[0]` so an
   * accepted oversell never lands outside the register's warehouse.
   */
  restricted_location_ids?: number[] | null;
}

/** Options for {@link SellableStockAllocator.allocateForLine}. */
export interface AllocateForLineOpts {
  /**
   * Order the line belongs to. When given (and no explicit restriction), the
   * allocator resolves the order's sale location under the POS
   * `register_location` scope via {@link SellableStockAllocator.resolveOrderSaleLocationIds}.
   */
  orderId?: number | null;
  /** Explicit restriction; `null` forces "no restriction". Wins over `orderId`. */
  restrictToLocationIds?: number[] | null;
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
    restrictToLocationIds: number[] | null = null,
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
    if (restrictToLocationIds && restrictToLocationIds.length > 0) {
      // "Bodega de la caja": only the restricted locations. A reservation is
      // still honoured when it sits INSIDE the restriction, never outside it.
      const restrictedSellable = {
        ...sellable,
        location_id: { in: restrictToLocationIds },
      };
      const includeInside = includeLocationIds.filter((id) =>
        restrictToLocationIds.includes(id),
      );
      if (includeInside.length > 0) {
        where.OR = [
          restrictedSellable,
          { location_id: { in: includeInside } },
        ];
      } else {
        Object.assign(where, restrictedSellable);
      }
    } else if (includeLocationIds.length > 0) {
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
   *
   * `opts.orderId` lets every order-bound caller (POS payment, order flow,
   * tables, delivery commit) inherit the order's sale-location restriction
   * from ONE place instead of re-deriving it per path.
   */
  async allocateForLine(
    storeId: number,
    productId: number,
    variantId: number | undefined,
    quantity: number,
    preferredLocationIds: number[] = [],
    tx?: Prisma.TransactionClient,
    opts: AllocateForLineOpts = {},
  ): Promise<StockAllocation> {
    const restricted =
      opts.restrictToLocationIds !== undefined
        ? opts.restrictToLocationIds
        : opts.orderId != null
          ? await this.resolveOrderSaleLocationIds(opts.orderId, tx)
          : null;
    const levels = await this.getSellableLevels(
      storeId,
      productId,
      variantId,
      tx,
      preferredLocationIds,
      restricted,
    );
    const preferred = restricted
      ? preferredLocationIds.filter((id) => restricted.includes(id))
      : preferredLocationIds;
    return {
      ...this.allocate(quantity, levels, preferred),
      restricted_location_ids: restricted,
    };
  }

  /**
   * Sale location of an order under the POS `register_location` scope
   * ("Bodega de la caja"): `orders.origin_cash_session_id → register.location_id`.
   *
   * Returns `null` (no restriction — the pre-existing behaviour) when the
   * store is on another scope, the order was not born in a cash session, or
   * the register has no warehouse. Settings are read raw (no merge): an unset
   * `pos_stock_scope` defaults to `main_location`, i.e. no restriction.
   */
  async resolveOrderSaleLocationIds(
    orderId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number[] | null> {
    const db: any = tx ?? this.prisma;
    const order = await db.orders.findFirst({
      where: { id: orderId },
      select: { store_id: true, origin_cash_session_id: true },
    });
    if (!order?.origin_cash_session_id) return null;

    const settingsRow = await db.store_settings.findFirst({
      where: { store_id: order.store_id },
      select: { settings: true },
    });
    const scope = (settingsRow?.settings as any)?.inventory?.pos_stock_scope;
    if (scope !== 'register_location') return null;

    const session = await db.cash_register_sessions.findFirst({
      where: { id: order.origin_cash_session_id, store_id: order.store_id },
      select: { register: { select: { location_id: true } } },
    });
    const locationId = session?.register?.location_id;
    return locationId != null ? [locationId] : null;
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
