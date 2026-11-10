import { storeIsRestaurant } from '../../../../common/helpers/industry-capabilities.helper';
import { sellableStockLevelsWhere } from '../../inventory/shared/helpers/pos-stock-scope.helper';
import {
  FulfillmentDestination,
  LineDestinationProductFacts,
  ResolvedLineDestination,
  resolveLineDestination,
} from './resolve-line-destination.util';

export interface DestinationLineRef {
  product_id?: number | null;
  product_variant_id?: number | null;
}

export interface LineDestinationContext {
  productById: Map<number, LineDestinationProductFacts>;
  /** Key `${product_id}:${product_variant_id ?? 'base'}` -> sellable units. */
  stockByKey: Map<string, number>;
}

const stockKey = (productId: number, variantId?: number | null) =>
  `${productId}:${variantId ?? 'base'}`;

/**
 * Batch-loads, in at most three queries, what the resolver needs for every
 * line (product facts, active-recipe flag, sellable stock). Safe to call
 * inside a transaction: no per-line queries. Stock follows the same sellable
 * scope the payment validation, reservation and commit share.
 */
export async function loadLineDestinationContext(
  client: any,
  storeId: number,
  lines: DestinationLineRef[],
  opts: { orderId?: number } = {},
): Promise<LineDestinationContext> {
  const productIds = Array.from(
    new Set(lines.map((l) => l.product_id).filter((id): id is number => !!id)),
  );
  const ctx: LineDestinationContext = {
    productById: new Map(),
    stockByKey: new Map(),
  };
  if (productIds.length === 0) return ctx;

  const [products, levels, ownReservations] = await Promise.all([
    client.products.findMany({
      where: { id: { in: productIds }, store_id: storeId },
      select: {
        id: true,
        product_type: true,
        is_batch_produced: true,
        track_inventory: true,
        _count: { select: { recipes: { where: { is_active: true } } } },
      },
    }),
    client.stock_levels.findMany({
      where: { product_id: { in: productIds }, ...sellableStockLevelsWhere(storeId) },
      select: { product_id: true, product_variant_id: true, quantity_available: true },
    }),
    // Edit path: the order's OWN active reservation is still held while the
    // resolver runs, so it must count as available for that order.
    opts.orderId != null
      ? client.stock_reservations.findMany({
          where: {
            reserved_for_type: 'order',
            reserved_for_id: opts.orderId,
            status: 'active',
            product_id: { in: productIds },
          },
          select: { product_id: true, product_variant_id: true, quantity: true },
        })
      : Promise.resolve([]),
  ]);

  for (const row of products as Array<{
    id: number;
    product_type: string | null;
    is_batch_produced: boolean | null;
    track_inventory: boolean | null;
    _count?: { recipes?: number };
  }>) {
    ctx.productById.set(row.id, {
      product_type: row.product_type ?? null,
      is_batch_produced: row.is_batch_produced === true,
      track_inventory: row.track_inventory !== false,
      has_active_recipe: Number(row._count?.recipes ?? 0) > 0,
    });
  }
  for (const level of levels as Array<{
    product_id: number;
    product_variant_id: number | null;
    quantity_available: number | null;
  }>) {
    const key = stockKey(level.product_id, level.product_variant_id);
    ctx.stockByKey.set(
      key,
      (ctx.stockByKey.get(key) ?? 0) + Math.max(0, Number(level.quantity_available ?? 0)),
    );
  }
  for (const reservation of ownReservations as Array<{
    product_id: number;
    product_variant_id: number | null;
    quantity: number | null;
  }>) {
    const key = stockKey(reservation.product_id, reservation.product_variant_id);
    ctx.stockByKey.set(
      key,
      (ctx.stockByKey.get(key) ?? 0) + Math.max(0, Number(reservation.quantity ?? 0)),
    );
  }
  return ctx;
}

/** Resolves one line from a preloaded context. Custom lines resolve to `null`. */
export function resolveLineDestinationFromContext(
  ctx: LineDestinationContext,
  params: {
    isRestaurant: boolean;
    isScheduled: boolean;
    line: DestinationLineRef & {
      quantity?: number | null;
      requested?: string | null;
      skip_kds?: boolean | null;
    };
  },
): ResolvedLineDestination {
  const { line } = params;
  const product = line.product_id ? (ctx.productById.get(line.product_id) ?? null) : null;
  return resolveLineDestination({
    isRestaurant: params.isRestaurant,
    product,
    availableStock: line.product_id
      ? (ctx.stockByKey.get(stockKey(line.product_id, line.product_variant_id)) ?? 0)
      : 0,
    quantity: line.quantity ?? 1,
    isScheduled: params.isScheduled,
    requested: line.requested,
    clientSkipKds: line.skip_kds,
  });
}

/** Existing line of an order being edited, keyed by `${product_id}:${variant_id}`. */
export type PreviousLineDestinations = Map<
  string,
  { fulfillment_destination?: string | null } | undefined
>;

export const previousLineKey = (line: DestinationLineRef): string =>
  `${line.product_id ?? 'null'}:${line.product_variant_id ?? 'null'}`;

/**
 * One call for every write point: reads the store industry, and for
 * restaurants batch-loads the catalog and stock once. Non-restaurant stores
 * resolve to all-null without touching the catalog (lines are built exactly as
 * before). `previous` (edit paths) keeps what an existing line already has: a
 * legacy line (NULL destination) stays null, and a line with a destination
 * re-validates it against the matrix as the cashier's choice.
 */
export async function resolveLineDestinations(
  client: any,
  storeId: number,
  items: Array<
    DestinationLineRef & {
      quantity?: number | null;
      requested?: string | null;
      skip_kds?: boolean | null;
    }
  >,
  opts: {
    isScheduled?: boolean;
    previous?: PreviousLineDestinations;
    /** Edit path: counts this order's own active reservations as available. */
    orderId?: number;
  } = {},
): Promise<Array<ResolvedLineDestination | null>> {
  const storeRow = await client.stores.findUnique({
    where: { id: storeId },
    select: { industries: true },
  });
  if (!storeIsRestaurant(storeRow?.industries)) {
    return items.map(() => null);
  }
  const ctx = await loadLineDestinationContext(client, storeId, items, {
    orderId: opts.orderId,
  });
  return items.map((item) => {
    const prev = opts.previous?.get(previousLineKey(item));
    if (prev && !prev.fulfillment_destination) return null;
    return resolveLineDestinationFromContext(ctx, {
      isRestaurant: true,
      isScheduled: opts.isScheduled === true,
      line: {
        ...item,
        // The client's explicit choice wins; otherwise an existing line keeps
        // its persisted destination as the requested one.
        requested: item.requested ?? prev?.fulfillment_destination ?? null,
      },
    });
  });
}

export type { FulfillmentDestination };
