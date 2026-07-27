export const STORE_INDUSTRIES = [
  'retail',
  'restaurant',
  'manufacturing',
  'service',
  'gym',
] as const;

export type StoreIndustry = (typeof STORE_INDUSTRIES)[number];

/**
 * Rich per-industry presentation metadata (label + description + icon), keyed
 * by every `StoreIndustry`. Single source of truth for how an industry is
 * RENDERED in any surface (onboarding cards, store create/edit modals, general
 * settings). Because it is a `Record<StoreIndustry, …>`, adding a value to
 * `STORE_INDUSTRIES` (the frontend mirror of the backend `industry_enum`)
 * without a metadata entry is a COMPILE ERROR — the industry list rendered to
 * users can never silently drift from the enum again.
 *
 * `icon` values are Lucide keys already registered in the icon registry
 * (`shared/components/icon/icons.registry.ts`) — no new icons are introduced.
 */
export interface IndustryMeta {
  value: StoreIndustry;
  label: string;
  description: string;
  icon: string;
}

export const INDUSTRY_METADATA: Record<StoreIndustry, IndustryMeta> = {
  retail: {
    value: 'retail',
    label: 'Retail',
    description: 'Venta de productos físicos',
    icon: 'store',
  },
  restaurant: {
    value: 'restaurant',
    label: 'Restaurante',
    description: 'Menú, mesas y cocina',
    icon: 'flame',
  },
  manufacturing: {
    value: 'manufacturing',
    label: 'Manufactura',
    description: 'Producción y elaboración',
    icon: 'boxes',
  },
  service: {
    value: 'service',
    label: 'Servicios',
    description: 'Citas, reservas y atención',
    icon: 'briefcase',
  },
  gym: {
    value: 'gym',
    label: 'Gimnasio',
    description: 'Membresías, accesos y aforo',
    icon: 'dumbbell',
  },
};

/**
 * Canonical, ordered list of industry options for pickers. Derived from
 * `STORE_INDUSTRIES` so the order mirrors the enum and every industry appears
 * exactly once. Card-based consumers (onboarding) use the full `IndustryMeta`;
 * `{value,label}` consumers (multi-selectors) map over it.
 */
export const INDUSTRY_OPTIONS: ReadonlyArray<IndustryMeta> =
  STORE_INDUSTRIES.map((value) => INDUSTRY_METADATA[value]);

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
 * access) is visible ⟺ the store's industry includes `gym`. It is hidden for
 * retail / restaurant / manufacturing / service. `gym` omits `memberships`
 * from its hidden list so the OR-semantics intersection keeps the suite
 * visible whenever `gym` is one of the store's industries (a `['gym','retail']`
 * store still sees it because the `gym` half of the intersection does not hide
 * it). A gym that also sells shakes adds `restaurant` to its industries to
 * unlock the restaurant suite too — the intersection empties for both
 * `memberships` and `restaurant_ops`, so a `['gym','restaurant']` store sees
 * BOTH suites. Note `gym` still hides `restaurant_ops` on its own, so a pure gym
 * store never sees the restaurant suite. `service` (citas/reservas) is its own
 * suite gated via `orders_reservations`; it does NOT unlock memberships.
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
  restaurant: [
    'memberships',
    'orders_reservations',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
  ],
  manufacturing: [
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
  ],
  service: [
    'restaurant_ops',
    'memberships',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
  ],
  gym: [
    'restaurant_ops',
    'orders_reservations',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
  ],
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
