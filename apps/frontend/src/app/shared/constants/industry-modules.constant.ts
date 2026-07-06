export const STORE_INDUSTRIES = [
  'retail',
  'restaurant',
  'manufacturing',
  'service',
  'gym',
] as const;

export type StoreIndustry = (typeof STORE_INDUSTRIES)[number];

/**
 * Map of panel_ui module keys hidden per industry.
 *
 * - Key: a `StoreIndustry` value (lowercase, matches the backend `StoreIndustry`
 *   TS enum values that cross the wire — NOT the UPPER_CASE keys).
 * - Value: module keys to hide for that industry.
 *
 * Phase I (Restaurant Suite): the `restaurant_ops` parent module is hidden for
 * every industry EXCEPT `restaurant`. Retail, manufacturing and service stores
 * never see it; the OR-semantics in `getModulesHiddenByIndustries` keeps a
 * multi-industry store (e.g. hotel = `service` + `restaurant`) visible because
 * the module is NOT hidden in the `restaurant` half of the intersection.
 *
 * Membership Suite: the generalized `memberships` module (plans, members,
 * access) is visible ⟺ the store's industry ∈ {gym, service}. It is hidden for
 * retail / restaurant / manufacturing. Both `gym` and `service` omit
 * `memberships` from their hidden lists so the OR-semantics intersection keeps
 * the suite visible for either industry (and for a store that has both). A gym
 * that also sells shakes adds `restaurant` to its industries to unlock the
 * restaurant suite too — the intersection empties for both `memberships` and
 * `restaurant_ops`, so a `['gym','restaurant']` store sees BOTH suites. Note
 * `gym` and `service` still hide `restaurant_ops` on their own, so a pure gym
 * or pure service store never sees the restaurant suite.
 *
 * Service Suite: the `orders_reservations` module (booking calendar, providers,
 * schedules) is visible ⟺ the store's industry includes `service`. Every other
 * industry (retail / restaurant / manufacturing / gym) lists it as hidden, so
 * the OR-semantics intersection keeps it visible only when `service` is one of
 * the store's industries (a `['service','retail']` store still sees it because
 * the `service` half of the intersection does not hide it). This mirrors the
 * inverse gating of `restaurant_ops` for the restaurant suite.
 */
export const INDUSTRY_HIDDEN_MODULES: Record<StoreIndustry, string[]> = {
  retail: ['restaurant_ops', 'memberships', 'orders_reservations'],
  restaurant: ['memberships', 'orders_reservations'],
  manufacturing: ['restaurant_ops', 'memberships', 'orders_reservations'],
  service: ['restaurant_ops'],
  gym: ['restaurant_ops', 'orders_reservations'],
};

/**
 * OR semantics: a module is hidden only if it is hidden for EVERY industry
 * of the store. A multi-industry store (e.g. hotel = service + restaurant +
 * retail) sees the union of what each industry allows.
 *
 * Algorithm: start with the full set of hidden keys across all known
 * industries, then reduce to the intersection of per-industry hidden lists.
 * If `industries` is empty/undefined, or every entry is unknown, no module
 * is hidden.
 *
 * Unknown industry values (e.g. legacy data, a typo, or a value not yet
 * shipped to the frontend) are treated as having an empty hidden list —
 * they do not contribute to the intersection, so they cannot accidentally
 * hide a module.
 */
export function getModulesHiddenByIndustries(
  industries: string[] | null | undefined,
): string[] {
  if (!industries || industries.length === 0) {
    return [];
  }

  const allKnown = STORE_INDUSTRIES.reduce<string[]>(
    (acc, industry) => acc.concat(INDUSTRY_HIDDEN_MODULES[industry] ?? []),
    [],
  );
  const knownSet = new Set(allKnown);

  const candidateKeys = allKnown.filter((key) => knownSet.has(key));
  if (candidateKeys.length === 0) {
    return [];
  }

  return candidateKeys.filter((key) =>
    industries.every((industry) => {
      const list = INDUSTRY_HIDDEN_MODULES[industry as StoreIndustry];
      return Array.isArray(list) && list.includes(key);
    }),
  );
}


/**
 * Capability resolver: returns true when at least one of the given store
 * industries supports the "ingredient / insumo" capacity.
 *
 * Used as the single source of truth for the orthogonal `is_ingredient` flag
 * across the product form, the POP modal and the AI scan profile. Replaces
 * scattered `industries().includes('restaurant')` checks.
 *
 * Semantics: a multi-industry store (e.g. hotel = service + restaurant) is
 * considered to support ingredients if ANY of its industries does (OR).
 * An empty/undefined list defaults to `false` (no industry, no capacity).
 *
 * Adding a new industry that supports the capacity is a one-line change here.
 */
export function industriesSupportIngredients(
  industries: string[] | null | undefined,
): boolean {
  if (!industries || industries.length === 0) {
    return false;
  }
  return industries.some((industry) =>
    (INDUSTRIES_SUPPORTING_INGREDIENTS as readonly string[]).includes(industry),
  );
}

/**
 * List of store industries that support the `is_ingredient` product capacity.
 * Today only `restaurant`; designed to grow as the suite expands.
 */
export const INDUSTRIES_SUPPORTING_INGREDIENTS = ['restaurant'] as const;
