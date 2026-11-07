import {
  LEGACY_INDUSTRY_GATED_KEYS,
  MODULE_INDUSTRIES,
} from './module-industries';

export const STORE_INDUSTRIES = [
  'retail',
  'restaurant',
  'manufacturing',
  'service',
  'gym',
  'construction',
  'hospitality',
  'administration',
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
  construction: {
    value: 'construction',
    label: 'Construcción',
    description: 'Obras, contratos y AIU',
    icon: 'building-2',
  },
  hospitality: {
    value: 'hospitality',
    label: 'Hotelería',
    description: 'Habitaciones, reservas y recepción',
    icon: 'hotel',
  },
  administration: {
    value: 'administration',
    label: 'Administración',
    description: 'Flujos de trabajo, aprobaciones y documentos',
    icon: 'clipboard-list',
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
 * Map of panel_ui module keys hidden per industry — DERIVED (apps-f4 S1).
 *
 * The source of truth is the positive map `MODULE_INDUSTRIES`
 * (`module-industries.ts`, mirror of `libs/shared-types/module-industries.ts`).
 * This exclusion view keeps the pre-F4 behavior byte for byte: it only covers
 * `LEGACY_INDUSTRY_GATED_KEYS`, the keys the old hand-written lists hid, so in
 * audit mode the sidebar and the URL guard hide exactly what they hid before.
 * `module-industries.spec.ts` pins the derived lists against the old
 * literal ones. Every other restriction of the positive map (for example the
 * `restaurant_ops_*` children) is only logged until F5.
 *
 * - Key: a `StoreIndustry` value (lowercase, as it crosses the wire).
 * - Value: legacy-gated keys whose positive rule does not include it.
 */
export const INDUSTRY_HIDDEN_MODULES: Record<StoreIndustry, string[]> =
  STORE_INDUSTRIES.reduce(
    (acc, industry) => {
      acc[industry] = LEGACY_INDUSTRY_GATED_KEYS.filter((key) => {
        const rule = MODULE_INDUSTRIES[key];
        return rule !== undefined && rule !== 'all' && !rule.includes(industry);
      });
      return acc;
    },
    {} as Record<StoreIndustry, string[]>,
  );

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
  if (allKnown.length === 0) {
    return [];
  }

  return allKnown.filter((key) =>
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
 * `restaurant` and `manufacturing`; designed to grow as the suite expands.
 */
export const INDUSTRIES_SUPPORTING_INGREDIENTS = ['restaurant', 'manufacturing'] as const;
