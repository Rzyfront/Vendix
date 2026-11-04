/**
 * MODULE_INDUSTRIES — positive map `panel_ui key → industries that enable it`.
 *
 * Canonical source (apps-f4 S1). It lives in `libs/shared-types` and is copied
 * BYTE FOR BYTE to the two runtimes, because the repo has no executable package
 * shared between Nest and Angular (no path mapping; see
 * `common/validators/password-policy.parity.spec.ts`):
 *
 *   - apps/backend/src/common/access/module-industries.ts
 *   - apps/frontend/src/app/shared/constants/module-industries.ts
 *
 * `apps/backend/src/common/access/module-industries.parity.spec.ts` fails if
 * any copy drifts. Edit this file, then copy it over both mirrors.
 *
 * Rules:
 *   - Every key known to the panel (catalog, sidebar, routes) has an entry.
 *   - `'all'` = every industry. A list = only stores that include one of those
 *     industries (OR semantics: a multi-industry store sees the union).
 *   - Horizontal keys are `'all'` or include `retail`. Only the vertical suites
 *     (`VERTICAL_MODULE_KEYS`) may leave `retail` out.
 *   - A store with no industries is read as `['retail']`, the column default.
 *
 * Audit mode (F4): only `LEGACY_INDUSTRY_GATED_KEYS` hide anything, exactly as
 * the pre-F4 exclusion list did. Every other restriction in this map is only
 * logged until F5 switches the gate on.
 *
 * Pure data + pure functions: no imports, no runtime dependencies.
 */

export const MODULE_INDUSTRY_VALUES = [
  'retail',
  'restaurant',
  'manufacturing',
  'service',
  'gym',
  'construction',
  'hospitality',
] as const;

export type ModuleIndustry = (typeof MODULE_INDUSTRY_VALUES)[number];

export type ModuleIndustryRule = readonly ModuleIndustry[] | 'all';

/** Industry assumed when a store has none (`stores.industries` default). */
export const DEFAULT_MODULE_INDUSTRIES: readonly ModuleIndustry[] = ['retail'];

const RESTAURANT: readonly ModuleIndustry[] = ['restaurant'];
const MANUFACTURING: readonly ModuleIndustry[] = ['manufacturing'];
const GYM: readonly ModuleIndustry[] = ['gym'];
const HOSPITALITY: readonly ModuleIndustry[] = ['hospitality'];
const RETAIL_ONLY: readonly ModuleIndustry[] = ['retail'];

export const MODULE_INDUSTRIES: Readonly<Record<string, ModuleIndustryRule>> = {
  // ── Panel and sales ──────────────────────────────────────────────────
  dashboard: 'all',
  pos: 'all',
  vex: 'all',
  subscription: 'all',
  consultations: 'all',

  // ── Products ─────────────────────────────────────────────────────────
  products: 'all',
  products_list: 'all',
  products_categories: 'all',
  products_brands: 'all',
  settings_price_tiers: 'all',
  ecommerce: 'all',
  apps: 'all',

  // ── Orders ───────────────────────────────────────────────────────────
  orders: 'all',
  orders_sales: 'all',
  orders_purchase_orders: 'all',
  purchase_orders: 'all',
  orders_quotations: 'all',
  orders_layaway: 'all',
  orders_scheduled: 'all',
  orders_contracts: ['construction'],
  orders_reservations: ['service'],
  orders_service_stations: ['service', 'hospitality'],

  // ── Dispatch (retail only, as the pre-F4 exclusion list) ─────────────
  dispatch: RETAIL_ONLY,
  orders_dispatch_notes: RETAIL_ONLY,
  orders_dispatch_routes: RETAIL_ONLY,
  dispatch_fleet: RETAIL_ONLY,
  settings_shipping: RETAIL_ONLY,
  analytics_dispatch: RETAIL_ONLY,
  reports_dispatch: RETAIL_ONLY,

  // ── Inventory ────────────────────────────────────────────────────────
  inventory: 'all',
  inventory_pop: 'all',
  inventory_adjustments: 'all',
  inventory_locations: 'all',
  inventory_suppliers: 'all',
  inventory_movements: 'all',
  inventory_transfers: 'all',
  inventory_serials: 'all',
  inventory_stock_levels: 'all',
  inventory_batches: 'all',

  // ── Customers ────────────────────────────────────────────────────────
  customers: 'all',
  customers_all: 'all',
  customers_inbox: 'all',
  customers_pipeline: 'all',
  customers_tasks: 'all',
  customers_segments: 'all',
  customers_reviews: 'all',
  customers_data_collection: 'all',
  customers_crm: 'all',

  // ── Marketing and channels ───────────────────────────────────────────
  marketing: 'all',
  marketing_promotions: 'all',
  marketing_coupons: 'all',
  marketing_anuncios: 'all',
  marketing_social_sales: 'all',

  // ── Analytics ────────────────────────────────────────────────────────
  analytics: 'all',
  analytics_overview: 'all',
  analytics_sales: 'all',
  analytics_purchases: 'all',
  analytics_reviews: 'all',
  analytics_inventory: 'all',
  analytics_products: 'all',
  analytics_customers: 'all',
  analytics_financial: 'all',
  analytics_payments: 'all',

  // ── Reports ──────────────────────────────────────────────────────────
  reports: 'all',
  reports_overview: 'all',
  reports_sales: 'all',
  reports_inventory: 'all',
  reports_products: 'all',
  reports_purchases: 'all',
  reports_customers: 'all',
  reports_reviews: 'all',
  reports_financial: 'all',
  reports_payments: 'all',
  reports_accounting: 'all',
  reports_payroll: 'all',

  expenses: 'all',

  // ── Restaurant suite ─────────────────────────────────────────────────
  restaurant_ops: RESTAURANT,
  restaurant_ops_recipes: RESTAURANT,
  restaurant_ops_production: RESTAURANT,
  restaurant_ops_kds: RESTAURANT,
  restaurant_ops_tables: RESTAURANT,
  restaurant_ops_menus: RESTAURANT,

  // ── Manufacturing suite ──────────────────────────────────────────────
  manufacturing: MANUFACTURING,
  manufacturing_formulas: MANUFACTURING,
  manufacturing_orders: MANUFACTURING,
  manufacturing_settings: MANUFACTURING,

  // ── Membership suite ─────────────────────────────────────────────────
  memberships: GYM,
  memberships_plans: GYM,
  memberships_members: GYM,
  memberships_access: GYM,

  // ── Hospitality suite ────────────────────────────────────────────────
  hospitality: HOSPITALITY,
  hospitality_rooms: HOSPITALITY,
  hospitality_reservations: HOSPITALITY,
  hospitality_rates: HOSPITALITY,

  // ── Fiscal: invoicing, accounting, payroll, taxes ────────────────────
  invoicing: 'all',
  invoicing_invoices: 'all',
  invoicing_resolutions: 'all',
  invoicing_dian_config: 'all',
  accounting: 'all',
  accounting_journal_entries: 'all',
  accounting_chart_of_accounts: 'all',
  accounting_fiscal_periods: 'all',
  accounting_account_mappings: 'all',
  accounting_flows_dashboard: 'all',
  cartera_dashboard: 'all',
  cartera_receivables: 'all',
  cartera_payables: 'all',
  cartera_aging: 'all',
  accounting_withholding_tax: 'all',
  accounting_exogenous: 'all',
  taxes_ica: 'all',
  taxes: 'all',
  payroll: 'all',
  payroll_employees: 'all',
  payroll_runs: 'all',
  payroll_settlements: 'all',
  payroll_novelties: 'all',
  payroll_advances: 'all',
  payroll_pila: 'all',
  payroll_settings: 'all',
  fiscal_operations: 'all',
  fiscal_dashboard: 'all',
  fiscal_obligations: 'all',
  fiscal_declarations: 'all',
  fiscal_close: 'all',
  fiscal_audit: 'all',
  fiscal_rules: 'all',

  // ── Settings ─────────────────────────────────────────────────────────
  settings: 'all',
  settings_general: 'all',
  settings_payments: 'all',
  settings_payment_methods: 'all',
  settings_print_formats: 'all',
  settings_appearance: 'all',
  settings_security: 'all',
  settings_domains: 'all',
  settings_legal_documents: 'all',
  settings_users: 'all',
  settings_roles: 'all',
  settings_cash_registers: 'all',
  settings_ai_agents: 'all',
  settings_operations: 'all',
  settings_operating_scope: 'all',
  settings_fiscal_scope: 'all',
  settings_fiscal_management: 'all',
  settings_application: 'all',
  settings_support: 'all',

  // ── Help ─────────────────────────────────────────────────────────────
  help: 'all',
  help_support: 'all',
  help_pqrs: 'all',
  help_center: 'all',
  help_videos: 'all',

  // ── ORG_ADMIN only ───────────────────────────────────────────────────
  stores: 'all',
  users: 'all',
  domains: 'all',
  audit: 'all',
};

/**
 * Vertical suites: the only keys allowed to leave `retail` out. The backend
 * guards them per controller (`@IndustryModule`).
 */
export const VERTICAL_MODULE_KEYS: readonly string[] = [
  'orders_contracts',
  'orders_reservations',
  'orders_service_stations',
  'restaurant_ops',
  'restaurant_ops_recipes',
  'restaurant_ops_production',
  'restaurant_ops_kds',
  'restaurant_ops_tables',
  'restaurant_ops_menus',
  'manufacturing',
  'manufacturing_formulas',
  'manufacturing_orders',
  'manufacturing_settings',
  'memberships',
  'memberships_plans',
  'memberships_members',
  'memberships_access',
  'hospitality',
  'hospitality_rooms',
  'hospitality_reservations',
  'hospitality_rates',
];

/**
 * Keys the pre-F4 exclusion list (`INDUSTRY_HIDDEN_MODULES`) already hid.
 * In audit mode these keep hiding exactly as before; every other restriction
 * of the map is only logged. F5 retires this list.
 */
export const LEGACY_INDUSTRY_GATED_KEYS: readonly string[] = [
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
];

/** Known industry values of a store, in enum order. Empty → `['retail']`. */
export function normalizeModuleIndustries(
  industries: readonly string[] | null | undefined,
): ModuleIndustry[] {
  const known = MODULE_INDUSTRY_VALUES.filter((value) =>
    (industries ?? []).includes(value),
  );
  return known.length ? known : [...DEFAULT_MODULE_INDUSTRIES];
}

/**
 * Industry of an organization: the union of its stores' industries
 * (apps-f4 S6, no column). No stores, or none with a known value → `['retail']`.
 */
export function unionModuleIndustries(
  lists: ReadonlyArray<readonly string[] | null | undefined>,
): ModuleIndustry[] {
  const all: string[] = [];
  for (const list of lists) all.push(...(list ?? []));
  return normalizeModuleIndustries(all);
}

/**
 * `true` when at least one of the store industries enables `key`.
 * Unknown keys are allowed (fail-open): the coverage specs keep the map total.
 */
export function industryAllowsKey(
  key: string,
  industries: readonly string[] | null | undefined,
): boolean {
  const rule = MODULE_INDUSTRIES[key];
  if (rule === undefined || rule === 'all') return true;
  const normalized = normalizeModuleIndustries(industries);
  return normalized.some((industry) => rule.includes(industry));
}
