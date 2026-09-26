type RoleLike =
  | string
  | { name?: string | null }
  | null
  | undefined;

/**
 * Matriz canónica de módulos por defecto según rol operativo para STORE_ADMIN y ORG_ADMIN.
 *
 * QUI-860: Garantiza que usuarios operativos (cajeros, meseros, encargados de almacén, etc.)
 * reciban automáticamente acceso a los módulos que corresponden a sus responsabilidades
 * operativas sin requerir que el administrador configure manualmente su panel_ui.
 *
 * Módulos alineados con PANEL_UI_FALLBACK (apps/backend/src/common/services/default-panel-ui.service.ts)
 * y APP_MODULES (apps/frontend/src/app/shared/constants/app-modules.constant.ts).
 */
export const ROLE_DEFAULT_PANEL_UI_KEYS: Record<
  string,
  Record<string, readonly string[]>
> = {
  STORE_ADMIN: {
    manager: [
      'dashboard',
      'pos',
      'products',
      'products_list',
      'products_categories',
      'products_brands',
      'settings_price_tiers',
      'ecommerce',
      'orders',
      'orders_sales',
      'orders_purchase_orders',
      'orders_quotations',
      'orders_contracts',
      'orders_layaway',
      'orders_reservations',
      'dispatch',
      'orders_dispatch_notes',
      'orders_dispatch_routes',
      'settings_shipping',
      'dispatch_fleet',
      'inventory',
      'inventory_pop',
      'inventory_adjustments',
      'inventory_locations',
      'inventory_suppliers',
      'inventory_movements',
      'inventory_transfers',
      'inventory_serials',
      'customers',
      'customers_all',
      'customers_reviews',
      'customers_data_collection',
      'customers_crm',
      'marketing',
      'marketing_promotions',
      'marketing_coupons',
      'marketing_anuncios',
      'marketing_social_sales',
      'analytics',
      'analytics_sales',
      'analytics_purchases',
      'analytics_reviews',
      'analytics_overview',
      'analytics_inventory',
      'analytics_products',
      'analytics_customers',
      'analytics_financial',
      'analytics_dispatch',
      'expenses',
      'restaurant_ops',
      'restaurant_ops_recipes',
      'restaurant_ops_production',
      'restaurant_ops_kds',
      'restaurant_ops_tables',
      'restaurant_ops_menus',
      'memberships',
      'memberships_plans',
      'memberships_members',
      'memberships_access',
      'reports',
      'reports_dispatch',
      'cartera_dashboard',
      'cartera_receivables',
      'cartera_payables',
      'cartera_aging',
      'settings',
      'settings_general',
      'settings_payments',
      'settings_appearance',
      'settings_security',
      'settings_domains',
      'settings_support',
      'settings_cash_registers',
      'settings_print_formats',
      'help',
      'help_support',
      'help_center',
      'help_videos',
      'help_pqrs',
    ],

    supervisor: [
      'pos',
      'products',
      'products_list',
      'products_categories',
      'products_brands',
      'settings_price_tiers',
      'orders',
      'orders_sales',
      'orders_purchase_orders',
      'orders_quotations',
      'orders_layaway',
      'orders_reservations',
      'dispatch',
      'orders_dispatch_notes',
      'orders_dispatch_routes',
      'inventory',
      'inventory_pop',
      'inventory_adjustments',
      'inventory_locations',
      'inventory_movements',
      'customers',
      'customers_all',
      'customers_reviews',
      'customers_data_collection',
      'marketing',
      'marketing_coupons',
      'analytics',
      'analytics_sales',
      'analytics_overview',
      'reports',
      'reports_dispatch',
      'restaurant_ops',
      'restaurant_ops_tables',
      'restaurant_ops_kds',
      'restaurant_ops_menus',
      'help',
      'help_support',
      'help_center',
      'help_videos',
      'help_pqrs',
    ],

    cashier: [
      'pos',
      'orders',
      'orders_sales',
      'orders_quotations',
      'orders_layaway',
      'orders_reservations',
      'dispatch',
      'orders_dispatch_notes',
      'products',
      'products_list',
      'products_categories',
      'products_brands',
      'customers',
      'customers_all',
      'customers_reviews',
      'marketing',
      'marketing_coupons',
      'restaurant_ops',
      'restaurant_ops_tables',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],

    waiter: [
      'pos',
      'orders',
      'orders_sales',
      'orders_reservations',
      'restaurant_ops',
      'restaurant_ops_tables',
      'restaurant_ops_kds',
      'restaurant_ops_menus',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],

    kitchen: [
      'restaurant_ops',
      'restaurant_ops_kds',
      'restaurant_ops_production',
      'restaurant_ops_recipes',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],

    carrier: [
      'dispatch',
      'orders_dispatch_notes',
      'orders_dispatch_routes',
      'dispatch_fleet',
      'orders',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],

    employee: [
      'pos',
      'orders',
      'orders_sales',
      'orders_reservations',
      'dispatch',
      'orders_dispatch_notes',
      'products',
      'products_list',
      'products_categories',
      'products_brands',
      'customers',
      'customers_all',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],

    fiscal_supervisor: [
      'invoicing',
      'invoicing_invoices',
      'invoicing_resolutions',
      'invoicing_dian_config',
      'accounting',
      'accounting_journal_entries',
      'accounting_fiscal_periods',
      'accounting_chart_of_accounts',
      'accounting_account_mappings',
      'accounting_flows_dashboard',
      'accounting_withholding_tax',
      'accounting_exogenous',
      'cartera_dashboard',
      'cartera_receivables',
      'cartera_payables',
      'cartera_aging',
      'payroll',
      'payroll_employees',
      'payroll_runs',
      'payroll_settlements',
      'payroll_novelties',
      'payroll_pila',
      'payroll_advances',
      'payroll_settings',
      'taxes',
      'taxes_ica',
      'fiscal_operations',
      'fiscal_dashboard',
      'fiscal_obligations',
      'fiscal_declarations',
      'fiscal_close',
      'fiscal_audit',
      'fiscal_evidence',
      'fiscal_history',
      'fiscal_rules',
      'reports',
      'help',
      'help_support',
      'help_center',
      'help_videos',
    ],
  },

  ORG_ADMIN: {
    fiscal_supervisor: [
      'dashboard',
      'accounting',
      'payroll',
      'fiscal_operations',
      'fiscal_dashboard',
      'fiscal_obligations',
      'fiscal_declarations',
      'fiscal_close',
      'fiscal_audit',
      'fiscal_evidence',
      'fiscal_history',
      'fiscal_rules',
      'reports',
    ],
  },
};

/**
 * Normaliza nombres de roles extrayendo el slug en minúsculas.
 */
function extractRoleName(role: RoleLike): string | null {
  if (!role) return null;
  const raw = typeof role === 'string' ? role : role.name;
  if (!raw || typeof raw !== 'string') return null;
  return raw.toLowerCase().trim();
}

/**
 * Resuelve la unión de claves por defecto para una colección de roles y un app_type.
 * Si el usuario tiene múltiples roles (ej. cashier + waiter), combina los módulos de ambos.
 * Para roles no reconocidos pero con asignación operativa, asigna el fallback de employee.
 */
export function getDefaultKeysForRoles(
  appType: string,
  roles: ReadonlyArray<RoleLike> | null | undefined,
): Set<string> {
  const result = new Set<string>();
  if (!roles || roles.length === 0) return result;

  const appRoleMap = ROLE_DEFAULT_PANEL_UI_KEYS[appType];
  if (!appRoleMap) return result;

  let hasMatchedOperationalRole = false;

  for (const r of roles) {
    const roleName = extractRoleName(r);
    if (!roleName) continue;

    // Ignorar clientes y roles exclusivamente públicos
    if (roleName === 'customer' || roleName === 'viewer') continue;

    const matchedKeys = appRoleMap[roleName];
    if (matchedKeys && matchedKeys.length > 0) {
      hasMatchedOperationalRole = true;
      for (const k of matchedKeys) {
        result.add(k);
      }
    }
  }

  // Fallback defensivo para roles personalizados de tienda no canónicos (ej. "vendedor", "bodeguero"):
  // Si no coincidió con ningún rol canónico pero el usuario tiene roles de tienda válidos (no customer),
  // otorgar las claves operativas base de `employee` para evitar el bloqueo total en `/admin/no-access`.
  if (!hasMatchedOperationalRole && appType === 'STORE_ADMIN') {
    const hasAnyStoreStaffRole = roles.some((r) => {
      const name = extractRoleName(r);
      return name && name !== 'customer' && name !== 'viewer';
    });

    if (hasAnyStoreStaffRole && appRoleMap['employee']) {
      for (const k of appRoleMap['employee']) {
        result.add(k);
      }
    }
  }

  return result;
}
