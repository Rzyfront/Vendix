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
