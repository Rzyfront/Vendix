/**
 * QUI-999 — single source of truth for where a restaurant sale line is
 * fulfilled. Pure: no I/O. Every write point that creates restaurant sale
 * lines (POS, ecommerce, tables, item changes, order create/edit) resolves the
 * destination here and persists `fulfillment_destination` + `skip_kds`.
 *
 * Decision matrix (same for "Para ya" and "Programado", the scheduled column
 * only changes WHEN the destination is consumed, never WHICH one it is):
 *
 * | Product                           | Destination                              |
 * | Producible, with stock            | cashier picks: stock (default) / production |
 * | Producible, no stock / no inventory | production                             |
 * | Prepared, not producible          | kds                                      |
 * | Other, with stock                 | stock                                    |
 * | Other, no stock                   | stock (the no-overselling guard blocks)  |
 * | Other, no inventory               | stock (the sale is only recorded)        |
 *
 * Producible = `is_batch_produced` AND an active recipe.
 *
 * Manufacturing stores use the same matrix for producible products (they go to
 * production, i.e. Planta). Without restaurant there is no KDS: every other
 * line keeps the legacy no-decision (`null`).
 */

export type FulfillmentDestination = 'kds' | 'production' | 'stock';

export interface LineDestinationProductFacts {
  product_type: string | null;
  is_batch_produced: boolean;
  track_inventory: boolean;
  has_active_recipe: boolean;
}

export interface ResolveLineDestinationInput {
  isRestaurant: boolean;
  /** Store includes `manufacturing`: producible lines follow the matrix. */
  isManufacturing?: boolean;
  /** `null` for custom lines (no catalog product). */
  product: LineDestinationProductFacts | null;
  /** Sellable stock of the line's product/variant. */
  availableStock: number;
  /** Units the line sells. Defaults to 1. */
  quantity?: number;
  /** Scheduled sale. Does not change the destination (see matrix above). */
  isScheduled: boolean;
  /** The cashier's choice (`stock` | `production`). Only honored when `choosable`. */
  requested?: string | null;
  /** Client `skip_kds`, kept as-is wherever the matrix does not decide. */
  clientSkipKds?: boolean | null;
}

export interface ResolvedLineDestination {
  /** `null` = no matrix decision (store without restaurant/manufacturing, custom/service line, or a non-producible line in a manufacturing-only store). */
  destination: FulfillmentDestination | null;
  skip_kds: boolean;
  /** True only where the matrix lets the cashier pick. */
  choosable: boolean;
}

export const CHOOSABLE_DESTINATIONS: readonly FulfillmentDestination[] = [
  'stock',
  'production',
];

export function isProducible(
  product: Pick<LineDestinationProductFacts, 'is_batch_produced' | 'has_active_recipe'>,
): boolean {
  return product.is_batch_produced === true && product.has_active_recipe === true;
}

/**
 * Own-stock predicate: a `production` line never validates, reserves or
 * deducts its own stock (the production order moves it). Legacy NULL lines and
 * every other destination keep today's behavior.
 */
export function lineConsumesOwnStock(line: {
  fulfillment_destination?: string | null;
}): boolean {
  return line.fulfillment_destination !== 'production';
}

export function resolveLineDestination(
  input: ResolveLineDestinationInput,
): ResolvedLineDestination {
  const clientSkipKds = input.clientSkipKds === true;

  const usesMatrix = input.isRestaurant || input.isManufacturing === true;
  if (!usesMatrix || !input.product) {
    return { destination: null, skip_kds: clientSkipKds, choosable: false };
  }

  const { product } = input;

  // Services never touch stock or the kitchen: no matrix decision.
  if (product.product_type === 'service') {
    return { destination: null, skip_kds: clientSkipKds, choosable: false };
  }

  if (isProducible(product)) {
    const quantity = input.quantity != null && input.quantity > 0 ? input.quantity : 1;
    const hasStock = product.track_inventory === true && input.availableStock >= quantity;
    if (!hasStock) {
      return { destination: 'production', skip_kds: true, choosable: false };
    }
    const requested = input.requested as FulfillmentDestination | null | undefined;
    const destination: FulfillmentDestination =
      requested && CHOOSABLE_DESTINATIONS.includes(requested) ? requested : 'stock';
    return { destination, skip_kds: true, choosable: true };
  }

  // Manufacturing without restaurant: no KDS and no decision for the rest.
  if (!input.isRestaurant) {
    return { destination: null, skip_kds: clientSkipKds, choosable: false };
  }

  if (product.product_type === 'prepared') {
    return { destination: 'kds', skip_kds: false, choosable: false };
  }

  return { destination: 'stock', skip_kds: true, choosable: false };
}
