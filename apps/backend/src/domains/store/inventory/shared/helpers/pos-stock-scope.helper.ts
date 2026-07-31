import type {
  InventoryScope,
  StoreSettings,
} from '../../../settings/interfaces/store-settings.interface';

/**
 * Minimal store shape required to resolve an inventory scope.
 *
 * Accepts any object carrying `default_location_id`. Callers typically pass a
 * `stores` row from Prisma (or a narrowed `select`) — we only need this single
 * field, so we keep the type small to make the helper easy to consume from
 * services that already loaded the store with a `select`.
 */
export interface StoreScopeRef {
  default_location_id: number | null;
}

/**
 * Result of resolving an inventory scope.
 *
 * - When `scope === 'main_location'`, `mainLocationId` is guaranteed to be a
 *   positive integer — callers can safely scope queries to this location.
 * - When `scope === 'all_locations'`, `mainLocationId` is `null` and callers
 *   must aggregate across all active locations of the store.
 *
 * Discriminated by `scope` so TypeScript narrows `mainLocationId` correctly.
 */
export type ResolvedInventoryScope =
  | { scope: 'main_location'; mainLocationId: number }
  | { scope: 'all_locations'; mainLocationId: null };

/**
 * Resolves the effective POS stock scope for the given store.
 *
 * Precedence:
 *   1. `settings.inventory.pos_stock_scope` (already merged with defaults by
 *      `mergeStoreSettingsWithDefaults()` — callers must merge before calling).
 *   2. Defensive fallback: if the configured scope is `main_location` but the
 *      store has no `default_location_id` set, we fall back to `all_locations`
 *      so POS never blocks on a half-bootstrapped store. This should not
 *      happen after the store bootstrap (see `store-bootstrap.helper.ts`), but
 *      we guard against it to avoid silently breaking sales.
 *
 * @param store    Store row (or narrowed select) carrying `default_location_id`.
 * @param settings Store settings already merged with hardcoded defaults.
 */
export function resolvePosStockScope(
  store: StoreScopeRef,
  settings: StoreSettings,
): ResolvedInventoryScope {
  const configured: InventoryScope =
    settings.inventory?.pos_stock_scope ?? 'main_location';
  return resolveScope(store, configured);
}

/**
 * Resolves the effective scope for low-stock alert evaluation.
 *
 * Same precedence and defensive fallback as {@link resolvePosStockScope},
 * driven by `settings.inventory.low_stock_alerts_scope`.
 *
 * @param store    Store row (or narrowed select) carrying `default_location_id`.
 * @param settings Store settings already merged with hardcoded defaults.
 */
export function resolveLowStockAlertsScope(
  store: StoreScopeRef,
  settings: StoreSettings,
): ResolvedInventoryScope {
  const configured: InventoryScope =
    settings.inventory?.low_stock_alerts_scope ?? 'main_location';
  return resolveScope(store, configured);
}

/**
 * Location types whose stock can never be sold through a sales channel.
 *
 * `quarantine` holds goods pending inspection and `damaged_goods` holds goods
 * withdrawn from sale: both are physically present but commercially
 * unavailable, so they must not feed availability in any channel.
 */
export const NON_SELLABLE_LOCATION_TYPES = [
  'quarantine',
  'damaged_goods',
] as const;

/**
 * CANONICAL definition of "a location the store can sell from" (QUI-559).
 *
 * A location is sellable when it belongs to the store, is active, is not the
 * organization's central warehouse, and is not of a non-sellable type. This
 * predicate used to be duplicated inline in every layer of the POS flow, which
 * is exactly how they drifted apart:
 *
 *   - the POS product list summed EVERY `stock_levels` row (no location filter),
 *   - the payment pre-validation summed only sellable locations,
 *   - the reservation and the delivery commit worked on ONE location.
 *
 * The result was a POS showing units it could not charge: the cashier saw 12,
 * the sale was blocked with `409` because only 2 sat in sellable locations (or
 * because the 12 were split across locations and no single one covered the
 * line). Every layer must now derive its filter from here so the three numbers
 * cannot diverge again.
 *
 * @param storeId Store whose sellable locations are requested.
 */
export function sellableLocationsWhere(storeId: number) {
  return {
    store_id: storeId,
    is_active: true,
    is_central_warehouse: false,
    type: { notIn: [...NON_SELLABLE_LOCATION_TYPES] },
  };
}

/**
 * `stock_levels` filter for the stock a channel may actually commit, i.e. the
 * union of every sellable location of the store — independent of the display
 * scope.
 *
 * This is the set the payment validation, the reservation and the delivery
 * commit share.
 */
export function sellableStockLevelsWhere(storeId: number) {
  return { inventory_locations: sellableLocationsWhere(storeId) };
}

/**
 * `stock_levels` filter for what the POS may DISPLAY: the configured scope
 * INTERSECTED with the sellable set.
 *
 * The intersection is the invariant that closes QUI-559: displayed stock is a
 * subset of committable stock, so the POS can never show a unit the sale would
 * later refuse. Under `all_locations` both sets are identical; under
 * `main_location` the display narrows to the default location while the sale
 * may still draw from any sellable location — never the other way around.
 *
 * @param storeId Store being displayed.
 * @param scope   Result of {@link resolvePosStockScope}.
 */
export function displayableStockLevelsWhere(
  storeId: number,
  scope: ResolvedInventoryScope,
) {
  const sellable = sellableStockLevelsWhere(storeId);
  return scope.scope === 'main_location'
    ? { ...sellable, location_id: scope.mainLocationId }
    : sellable;
}

function resolveScope(
  store: StoreScopeRef,
  configured: InventoryScope,
): ResolvedInventoryScope {
  if (configured === 'all_locations') {
    return { scope: 'all_locations', mainLocationId: null };
  }

  // configured === 'main_location'
  if (store.default_location_id == null) {
    // Defensive: store has no default location wired. Fall back to
    // `all_locations` so callers do not silently filter to a missing id.
    return { scope: 'all_locations', mainLocationId: null };
  }

  return {
    scope: 'main_location',
    mainLocationId: store.default_location_id,
  };
}
