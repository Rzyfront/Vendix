import { APP_MODULES, AppModule } from './app-modules.constant';

/**
 * A store module as Vexi needs to talk about it: what it is called, what it is
 * for, and — the part the repo never had in one place — where it lives.
 */
export interface StoreModuleCatalogEntry {
  /** `panel_ui` key. The join key for every visibility layer. */
  key: string;
  /** Spanish label as rendered in the sidebar. */
  label: string;
  /** Absolute router path, already resolved past legacy redirects. */
  route: string;
  /** One line on what the module does, for the model to paraphrase. */
  description: string;
  /** Present on submodules; the `key` of the group they hang from. */
  parentKey?: string;
}

/**
 * `panel_ui` key → canonical absolute route.
 *
 * This map is the missing third source. `APP_MODULES` has keys, labels and
 * descriptions but no routes; the sidebar has labels and routes but no keys;
 * `MenuFilterService.moduleKeyMap` joins the first two **by Spanish label**,
 * which is why the join is already broken in production — "Inventario",
 * "Productos", "Clientes", "Reseñas", "Compras", "Ventas", "Resumen",
 * "Financiero", "Contabilidad" and "Nómina" each name two different sidebar
 * entries (the module itself and its analytics/reports tab). Keying on the
 * `panel_ui` key instead makes the join total and unambiguous.
 *
 * Parent groups have no route of their own in the sidebar, so they point at
 * their most useful child: sending the user to "Inventario" has to land
 * somewhere, and a dead group header is a worse answer than its first tab.
 *
 * Routes are the **canonical** ones. Several older flat paths still resolve
 * via `redirectTo` (`/admin/accounting/aging` → `cartera/aging`,
 * `/admin/taxes/ica` → `accounting/taxes/ica`); this map records the target,
 * not the redirect, so Vexi never navigates through a bounce.
 */
export const MODULE_ROUTES: Record<string, string> = {
  dashboard: '/admin/dashboard',
  pos: '/admin/pos',

  // Productos
  products: '/admin/products',
  products_list: '/admin/products',
  products_categories: '/admin/products/categories',
  products_brands: '/admin/products/brands',
  settings_price_tiers: '/admin/price-tiers',

  ecommerce: '/admin/ecommerce',

  // Órdenes
  orders: '/admin/orders/sales',
  orders_sales: '/admin/orders/sales',
  orders_purchase_orders: '/admin/orders/purchase-orders',
  orders_quotations: '/admin/orders/quotations',
  orders_layaway: '/admin/orders/layaway',
  orders_reservations: '/admin/reservations',

  // Despacho
  dispatch: '/admin/orders/dispatch-notes',
  orders_dispatch_notes: '/admin/orders/dispatch-notes',
  orders_dispatch_routes: '/admin/orders/planillas',
  settings_shipping: '/admin/settings/shipping',
  dispatch_fleet: '/admin/orders/fleet',

  // Inventario
  inventory: '/admin/inventory/pop',
  inventory_pop: '/admin/inventory/pop',
  inventory_adjustments: '/admin/inventory/adjustments',
  inventory_locations: '/admin/inventory/locations',
  inventory_suppliers: '/admin/inventory/suppliers',
  inventory_movements: '/admin/inventory/movements',
  inventory_transfers: '/admin/inventory/transfers',
  inventory_serials: '/admin/inventory/serials',

  // Clientes
  customers: '/admin/customers/all',
  customers_all: '/admin/customers/all',
  customers_reviews: '/admin/customers/reviews',
  customers_data_collection: '/admin/data-collection',
  customers_crm: '/admin/customers/crm',

  // Marketing
  marketing: '/admin/marketing/promotions',
  marketing_promotions: '/admin/marketing/promotions',
  marketing_coupons: '/admin/marketing/coupons',
  marketing_anuncios: '/admin/marketing/anuncios',
  marketing_social_sales: '/admin/marketing/social-sales',

  // Analíticas
  analytics: '/admin/analytics/overview',
  analytics_overview: '/admin/analytics/overview',
  analytics_sales: '/admin/analytics/sales',
  analytics_purchases: '/admin/analytics/purchases',
  analytics_reviews: '/admin/analytics/reviews',
  analytics_inventory: '/admin/analytics/inventory',
  analytics_products: '/admin/analytics/products',
  analytics_customers: '/admin/analytics/customers',
  analytics_financial: '/admin/analytics/financial',

  expenses: '/admin/expenses',

  // Operaciones de restaurante
  restaurant_ops: '/admin/restaurant-ops/tables',
  restaurant_ops_recipes: '/admin/restaurant-ops/recipes',
  restaurant_ops_production: '/admin/restaurant-ops/production',
  restaurant_ops_kds: '/admin/restaurant-ops/kds',
  restaurant_ops_tables: '/admin/restaurant-ops/tables',
  restaurant_ops_menus: '/admin/restaurant-ops/menus',

  // Membresías
  memberships: '/admin/memberships/members',
  memberships_plans: '/admin/memberships/plans',
  memberships_members: '/admin/memberships/members',
  memberships_access: '/admin/memberships/access',

  // Facturación electrónica
  invoicing: '/admin/invoicing',
  invoicing_invoices: '/admin/invoicing/invoices',
  invoicing_resolutions: '/admin/invoicing/resolutions',
  invoicing_dian_config: '/admin/invoicing/dian-config',

  reports: '/admin/reports/overview',

  // Contabilidad. Los sub-tabs viven bajo super-pestañas
  // (configuration / cartera / taxes); las rutas planas antiguas redirigen.
  accounting: '/admin/accounting',
  accounting_journal_entries: '/admin/accounting/journal-entries',
  accounting_chart_of_accounts: '/admin/accounting/chart-of-accounts',
  accounting_fiscal_periods: '/admin/accounting/fiscal-periods',
  accounting_account_mappings: '/admin/accounting/configuration/mappings',
  accounting_flows_dashboard: '/admin/accounting/configuration/flows',
  cartera_dashboard: '/admin/accounting/cartera/dashboard',
  cartera_receivables: '/admin/accounting/cartera/receivables',
  cartera_payables: '/admin/accounting/cartera/payables',
  cartera_aging: '/admin/accounting/cartera/aging',
  accounting_withholding_tax: '/admin/accounting/taxes/withholding',
  accounting_exogenous: '/admin/accounting/taxes/exogenous',
  taxes_ica: '/admin/accounting/taxes/ica',

  // Nómina
  payroll: '/admin/payroll',
  payroll_employees: '/admin/payroll/employees',
  payroll_runs: '/admin/payroll/runs',
  payroll_settlements: '/admin/payroll/settlements',
  payroll_novelties: '/admin/payroll/novelties',
  payroll_advances: '/admin/payroll/advances',
  payroll_pila: '/admin/payroll/pila',
  payroll_settings: '/admin/payroll/settings',

  // Operación fiscal
  fiscal_operations: '/admin/fiscal',
  fiscal_dashboard: '/admin/fiscal/dashboard',
  fiscal_obligations: '/admin/fiscal/obligations',
  fiscal_declarations: '/admin/fiscal/declarations',
  fiscal_close: '/admin/fiscal/close',
  fiscal_audit: '/admin/fiscal/audit',
  fiscal_rules: '/admin/fiscal/rules',

  // Configuración
  settings: '/admin/settings/general',
  settings_general: '/admin/settings/general',
  settings_payments: '/admin/settings/payments',
  settings_print_formats: '/admin/settings/print-formats',
  settings_appearance: '/admin/settings/appearance',
  settings_security: '/admin/settings/security',
  settings_domains: '/admin/settings/domains',
  settings_legal_documents: '/admin/settings/legal-documents',
  settings_users: '/admin/settings/users',
  settings_roles: '/admin/settings/roles',
  settings_cash_registers: '/admin/cash-registers',

  // Ayuda
  help: '/admin/help/center',
  help_support: '/admin/help/support',
  help_pqrs: '/admin/pqrs',
  help_center: '/admin/help/center',
};

function flatten(
  modules: AppModule[],
  parentKey: string | undefined,
  into: StoreModuleCatalogEntry[],
): void {
  for (const module of modules) {
    const route = MODULE_ROUTES[module.key];
    // A module with no route is not addressable, so it cannot be offered as a
    // destination. It is skipped rather than emitted with an empty route: the
    // spec asserts the catalog has no orphans, and a silent `''` would let a
    // missing entry reach `ui_navigate` as a navigation to nowhere.
    if (route) {
      into.push({
        key: module.key,
        label: module.label,
        route,
        description: module.description ?? module.label,
        ...(parentKey ? { parentKey } : {}),
      });
    }
    if (module.children?.length) {
      flatten(module.children, module.key, into);
    }
  }
}

/**
 * Flat catalog of every addressable STORE_ADMIN module.
 *
 * Derived, not hand-written: labels and descriptions come from `APP_MODULES`
 * (the same source the "Módulos del Panel" editor renders), routes come from
 * `MODULE_ROUTES`. Adding a module to `APP_MODULES` and giving it a route is
 * all it takes for Vexi to know about it — there is no third list to remember.
 */
export const STORE_MODULE_CATALOG: StoreModuleCatalogEntry[] = (() => {
  const entries: StoreModuleCatalogEntry[] = [];
  flatten(APP_MODULES.STORE_ADMIN, undefined, entries);
  return entries;
})();

/** Index by `panel_ui` key, for the O(1) lookups the UI dispatcher needs. */
export const STORE_MODULE_BY_KEY: Record<string, StoreModuleCatalogEntry> =
  STORE_MODULE_CATALOG.reduce(
    (acc, entry) => {
      acc[entry.key] = entry;
      return acc;
    },
    {} as Record<string, StoreModuleCatalogEntry>,
  );

/**
 * Best-effort resolution of free text ("punto de compra", "compras", "pop")
 * onto a module. Used when the model passes a name instead of a key.
 *
 * Deliberately conservative: exact key, then exact label, then a single
 * unambiguous substring hit. An ambiguous match returns `null` so the caller
 * asks instead of guessing — landing the user in the wrong module is worse
 * than one extra question.
 */
export function resolveStoreModule(
  query: string,
): StoreModuleCatalogEntry | null {
  const needle = query
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!needle) return null;

  const normalize = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const byKey = STORE_MODULE_BY_KEY[query.trim()];
  if (byKey) return byKey;

  const exactLabel = STORE_MODULE_CATALOG.filter(
    (entry) => normalize(entry.label) === needle,
  );
  if (exactLabel.length === 1) return exactLabel[0];

  const partial = STORE_MODULE_CATALOG.filter(
    (entry) =>
      normalize(entry.label).includes(needle) ||
      normalize(entry.key).includes(needle),
  );
  return partial.length === 1 ? partial[0] : null;
}
