import type { industry_enum } from '@prisma/client';

/**
 * List of `industry_enum` values that support the `is_ingredient` product
 * capacity. Mirrors the frontend `INDUSTRIES_SUPPORTING_INGREDIENTS` constant
 * in `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`.
 * Add new entries here when a new industry opts into the ingredient
 * capacity; downstream services and DTOs will pick it up automatically.
 */
export const INDUSTRIES_SUPPORTING_INGREDIENTS: industry_enum[] = [
  'restaurant',
];

/**
 * Backend capability resolver: returns true when at least one of the given
 * store industries supports the `is_ingredient` capacity.
 *
 * OR semantics: a multi-industry store (e.g. hotel = service + restaurant)
 * is considered to support ingredients if ANY of its industries does.
 *
 * Used by:
 * - `products.service.ts` to gate the `is_ingredient` field on write
 *   (Fase 1: hidden when not supported).
 * - `purchase-orders.service.ts` to validate `order_type === 'ingredient'`
 *   (Fase 2).
 *
 * Safe to call with `null`/`undefined`/empty arrays; returns `false` then.
 */
export function storeIndustriesSupportIngredients(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_INGREDIENTS as readonly string[]).includes(
      industry as string,
    ),
  );
}

/**
 * List of `industry_enum` values that support the contracts flow
 * (A.2, ADR-02: quotation with `destination=contract`, contract record,
 * preloaded AIU invoice). Mirrors the frontend `INDUSTRY_HIDDEN_MODULES`
 * rule for the `orders_contracts` module key in
 * `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`:
 * every industry EXCEPT `construction` hides it. Add new entries here (and
 * remove the key from that industry's hidden list) if another industry
 * enters the AIU regime.
 */
export const INDUSTRIES_SUPPORTING_CONTRACTS: industry_enum[] = [
  'construction',
];

/**
 * Backend capability resolver: returns true when at least one of the given
 * store industries supports the contracts flow (today only `construction`).
 *
 * OR semantics: a multi-industry store (e.g. `construction` + `retail`)
 * keeps the flow —mirrors `getModulesHiddenByIndustries` on the frontend,
 * where a module is hidden only if hidden for EVERY industry of the store.
 * Safe to call with `null`/`undefined`/empty arrays; returns `false` then.
 *
 * Used by `ConstructionIndustryGuard` (`common/guards`) to answer 403 with
 * `CONTRACT_INDUSTRY_001` (ERR-03). C.1/D.1 reuse it for their controllers.
 */
export function storeSupportsContracts(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_CONTRACTS as readonly string[]).includes(
      industry as string,
    ),
  );
}

/**
 * Backend capability resolver: returns true when at least one of the given
 * store industries is `restaurant`. Mirrors the canonical store-industry
 * gating (`stores.industries`) used by `Vendix-core` for restaurant-only
 * features (KDS, fire-to-kitchen, table sessions, recipes).
 *
 * Plan KDS fire-flows: the auto-fire path (POS payment, table close, split)
 * is gated here so non-restaurant stores never see the new code paths. The
 * manual selective fire endpoint (POST /store/kitchen-fire) also uses this
 * resolver and returns `RESTAURANT_NOT_ENABLED` when it returns false.
 *
 * OR semantics: a multi-industry store that includes `restaurant` is treated
 * as a restaurant for KDS purposes. Safe to call with null/undefined/empty
 * arrays; returns false then.
 */
export function storeIsRestaurant(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) => industry === 'restaurant');
}

/**
 * Industrias con estaciones de servicio (bahías, sillas, mesas de reparación):
 * espejo del frontend, donde `orders_service_stations` solo queda visible si la
 * tienda incluye `service`.
 */
export const INDUSTRIES_SUPPORTING_SERVICE_STATIONS: industry_enum[] = ['service'];

/** OR: una tienda multi-industria que incluye `service` puede usar estaciones. */
export function storeSupportsServiceStations(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_SERVICE_STATIONS as readonly string[]).includes(industry as string),
  );
}

/**
 * List of `industry_enum` values that support the lodging flow (rooms,
 * reservations, front desk, folio). Mirrors the frontend
 * `INDUSTRY_HIDDEN_MODULES` rule for the `hospitality` module keys in
 * `apps/frontend/src/app/shared/constants/industry-modules.constant.ts`:
 * every industry EXCEPT `hospitality` hides them.
 */
export const INDUSTRIES_SUPPORTING_LODGING: industry_enum[] = ['hospitality'];

/**
 * Backend capability resolver: returns true when at least one of the given
 * store industries supports the lodging flow (today only `hospitality`).
 *
 * OR semantics: a hotel with a restaurant (`hospitality` + `restaurant`)
 * keeps the flow. Safe to call with `null`/`undefined`/empty arrays;
 * returns `false` then.
 */
export function storeSupportsLodging(
  industries: industry_enum[] | string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_LODGING as readonly string[]).includes(
      industry as string,
    ),
  );
}
