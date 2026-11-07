import {
  INDUSTRY_HIDDEN_MODULES,
  STORE_INDUSTRIES,
  StoreIndustry,
  getModulesHiddenByIndustries,
} from './industry-modules.constant';
import {
  LEGACY_INDUSTRY_GATED_KEYS,
  MODULE_INDUSTRIES,
  VERTICAL_MODULE_KEYS,
  industryAllowsKey,
  unionModuleIndustries,
} from './module-industries';
import { APP_MODULES, AppModule } from './app-modules.constant';
import {
  MODULE_GATE_ROUTES,
  MODULE_ROUTES,
  MODULE_ROUTE_ALIASES,
  ORG_MODULE_ROUTES,
} from './store-module-catalog.constant';

/**
 * Literal copy of the hand-written exclusion lists as they were before
 * apps-f4 (commit a567abd9e). The derived `INDUSTRY_HIDDEN_MODULES` must hide
 * exactly the same keys per industry: in audit mode nothing new is hidden.
 */
const PRE_F4_HIDDEN: Record<StoreIndustry, string[]> = {
  retail: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'orders_service_stations',
    'orders_contracts',
  ],
  restaurant: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'memberships',
    'orders_reservations',
    'orders_service_stations',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
  manufacturing: [
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'orders_service_stations',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
  service: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'restaurant_ops',
    'memberships',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
  gym: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'restaurant_ops',
    'orders_reservations',
    'orders_service_stations',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
  construction: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'orders_service_stations',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
  ],
  hospitality: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
  // Born after F4: every legacy-gated key is hidden for it (none lists it).
  administration: [
    'manufacturing',
    'manufacturing_formulas',
    'manufacturing_orders',
    'manufacturing_settings',
    'hospitality',
    'hospitality_rooms',
    'hospitality_reservations',
    'hospitality_rates',
    'restaurant_ops',
    'memberships',
    'orders_reservations',
    'orders_service_stations',
    'orders_contracts',
    'dispatch',
    'orders_dispatch_notes',
    'orders_dispatch_routes',
    'dispatch_fleet',
    'settings_shipping',
    'analytics_dispatch',
    'reports_dispatch',
  ],
};


function flattenKeys(modules: AppModule[], into: string[] = []): string[] {
  for (const module of modules) {
    into.push(module.key);
    if (module.children?.length) flattenKeys(module.children, into);
  }
  return into;
}

describe('MODULE_INDUSTRIES (apps-f4 S1)', () => {
  it('gives every known key an industry rule', () => {
    const known = new Set<string>([
      ...flattenKeys(APP_MODULES['STORE_ADMIN']),
      ...flattenKeys(APP_MODULES['ORG_ADMIN']),
      ...Object.keys(MODULE_ROUTES),
      ...Object.keys(MODULE_ROUTE_ALIASES),
      ...Object.keys(MODULE_GATE_ROUTES),
      ...Object.keys(ORG_MODULE_ROUTES),
    ]);
    const missing = [...known].filter((key) => MODULE_INDUSTRIES[key] === undefined);
    expect(missing).toEqual([]);
  });

  it('keeps every horizontal key on retail or all; only verticals leave retail out', () => {
    const offenders = Object.entries(MODULE_INDUSTRIES).filter(
      ([key, rule]) =>
        rule !== 'all' &&
        !rule.includes('retail') &&
        !VERTICAL_MODULE_KEYS.includes(key),
    );
    expect(offenders).toEqual([]);
  });

  it('never has an empty industry list', () => {
    const empty = Object.entries(MODULE_INDUSTRIES).filter(
      ([, rule]) => rule !== 'all' && rule.length === 0,
    );
    expect(empty).toEqual([]);
  });

  it('derives the legacy exclusion lists exactly as they were before F4', () => {
    for (const industry of STORE_INDUSTRIES) {
      expect([...INDUSTRY_HIDDEN_MODULES[industry]].sort())
        .withContext(industry)
        .toEqual([...PRE_F4_HIDDEN[industry]].sort());
    }
    expect([...LEGACY_INDUSTRY_GATED_KEYS].sort()).toEqual(
      [...new Set(Object.values(PRE_F4_HIDDEN).flat())].sort(),
    );
  });

  it('hides the same keys for single and multi-industry stores as before F4', () => {
    const cases: string[][] = [
      ['retail'],
      ['restaurant'],
      ['gym', 'retail'],
      ['hospitality', 'restaurant'],
      ['service', 'retail'],
      ['construction'],
      [],
    ];
    for (const industries of cases) {
      const expected = industries.length
        ? [...new Set(Object.values(PRE_F4_HIDDEN).flat())].filter((key) =>
            industries.every((industry) =>
              PRE_F4_HIDDEN[industry as StoreIndustry].includes(key),
            ),
          )
        : [];
      expect([...new Set(getModulesHiddenByIndustries(industries))].sort())
        .withContext(industries.join(',') || 'empty')
        .toEqual(expected.sort());
    }
  });

  it('allows a vertical key only to its industries, with union semantics', () => {
    expect(industryAllowsKey('restaurant_ops_recipes', ['retail'])).toBeFalse();
    expect(industryAllowsKey('restaurant_ops_recipes', ['retail', 'restaurant'])).toBeTrue();
    expect(industryAllowsKey('orders_service_stations', ['hospitality'])).toBeTrue();
    expect(industryAllowsKey('dispatch', ['restaurant'])).toBeFalse();
    expect(industryAllowsKey('inventory', ['gym'])).toBeTrue();
  });

  it('reads a store without industries as retail and lets unknown keys pass', () => {
    expect(industryAllowsKey('dispatch', [])).toBeTrue();
    expect(industryAllowsKey('restaurant_ops', null)).toBeFalse();
    expect(industryAllowsKey('not_a_key', ['retail'])).toBeTrue();
  });

  it('derives the organization industry from the union of its stores (S6)', () => {
    expect(unionModuleIndustries([['restaurant'], ['retail', 'restaurant'], null])).toEqual([
      'retail',
      'restaurant',
    ]);
    expect(unionModuleIndustries([])).toEqual(['retail']);
  });
});
