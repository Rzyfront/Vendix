export const STORE_INDUSTRIES = [
  'retail',
  'restaurant',
  'manufacturing',
  'service',
] as const;

export type StoreIndustry = (typeof STORE_INDUSTRIES)[number];

/**
 * Map of panel_ui module keys hidden per industry.
 *
 * - Key: a `StoreIndustry` value (lowercase, matches the backend `StoreIndustry`
 *   TS enum values that cross the wire — NOT the UPPER_CASE keys).
 * - Value: module keys to hide for that industry.
 *
 * The arrays are intentionally EMPTY in this plan (foundation only).
 * Follow-up plans (restaurant Operations / recipes, KDS, manufacturing
 * workflows) will populate this map. Until then, every value is `[]` and
 * `getModulesHiddenByIndustries` returns `[]` for any combination of
 * industries — the sidebar is byte-identical to today.
 */
export const INDUSTRY_HIDDEN_MODULES: Record<StoreIndustry, string[]> = {
  retail: [],
  restaurant: [],
  manufacturing: [],
  service: [],
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
