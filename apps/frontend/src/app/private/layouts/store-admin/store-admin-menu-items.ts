import { MenuItem } from '../../../shared/components/sidebar/sidebar.component';

/**
 * Every possible entry of the STORE_ADMIN sidebar, in render order. A plain
 * literal (no component state), so the menu filter and its specs can run the
 * real tree without mounting the layout. Visibility is decided by
 * `MenuFilterService`; the Apps regrouping by `applyAppsMenu`.
 */
export const STORE_ADMIN_MENU_ITEMS: readonly MenuItem[] = [
  {
    label: 'Panel Principal',
    icon: 'home',
    route: '/admin/dashboard',
  },
  {
    label: 'Punto de Venta',
    icon: 'store',
    route: '/admin/pos',
  },
  {
    // Restaurant Operations (Restaurant Suite — Fase I). The whole group
    // is hidden by INDUSTRY_HIDDEN_MODULES for retail/manufacturing/service
    // stores; visible only when the store's industry includes `restaurant`.
    // Industry gating runs upstream in MenuFilterService.getModulesHiddenByIndustries.
    label: 'Operaciones de Restaurante',
    icon: 'utensils-crossed',
    children: [
      {
        label: 'Mesas',
        icon: 'square-stack',
        route: '/admin/restaurant-ops/tables',
      },
      {
        label: 'Comandas',
        icon: 'flame',
        route: '/admin/restaurant-ops/kds',
      },
      {
        label: 'Producción',
        icon: 'chef-hat',
        route: '/admin/restaurant-ops/production',
      },
      {
        label: 'Recetas',
        icon: 'book-open',
        route: '/admin/restaurant-ops/recipes',
      },
      {
        label: 'Cartas',
        icon: 'menu-square',
        route: '/admin/restaurant-ops/menus',
      },
    ],
  },
  {
    // Manufactura (MVP). Hidden by INDUSTRY_HIDDEN_MODULES for every
    // industry except `manufacturing`. Labels map to panel_ui keys via
    // MenuFilterService ('Manufactura' → manufacturing, 'Fórmulas' →
    // manufacturing_formulas, 'Órdenes de producción' → manufacturing_orders,
    // 'Planta' → manufacturing_settings).
    label: 'Manufactura',
    icon: 'factory',
    children: [
      {
        label: 'Fórmulas',
        icon: 'flask-conical',
        route: '/admin/manufacturing/formulas',
      },
      {
        label: 'Órdenes de producción',
        icon: 'clipboard-list',
        route: '/admin/manufacturing/orders',
      },
      {
        label: 'Planta',
        icon: 'settings',
        route: '/admin/manufacturing/settings',
      },
    ],
  },
  {
    // Memberships (Membership Suite). Hidden by INDUSTRY_HIDDEN_MODULES for
    // every industry except `gym` and `service`; visible only when the
    // store's industry includes `gym` or `service`. Labels map to panel_ui
    // keys via MenuFilterService ('Zona Fit' → memberships, Accesos →
    // memberships_access, Miembros → memberships_members, Planes →
    // memberships_plans).
    label: 'Zona Fit',
    icon: 'dumbbell',
    children: [
      {
        label: 'Accesos',
        icon: 'door-open',
        route: '/admin/memberships/access',
      },
      {
        label: 'Miembros',
        icon: 'users',
        route: '/admin/memberships/members',
      },
      {
        label: 'Planes',
        icon: 'tag',
        route: '/admin/memberships/plans',
      },
    ],
  },
  {
    // Hotelería (Hospitality Suite, H0.1). Hidden by INDUSTRY_HIDDEN_MODULES
    // for every industry except `hospitality`. Labels map to panel_ui keys
    // via MenuFilterService ('Hotelería' → hospitality, Habitaciones →
    // hospitality_rooms). R1: only daily operation, in front-desk order;
    // settings left the group: iCal → Configuración → General → Hotelería
    // (R2), VAT-exempt services → Configuración → General → Facturación (R3);
    // the loose reports stay reachable by URL until R4.
    label: 'Hotelería',
    icon: 'hotel',
    children: [
      {
        // H3.3 — front desk board of the day.
        label: 'Recepción',
        icon: 'concierge-bell',
        route: '/admin/hospitality/front-desk',
        panelUiKey: 'hospitality_reservations',
      },
      {
        // H1.3 — occupancy rack.
        label: 'Rack',
        icon: 'layout-grid',
        route: '/admin/hospitality/rack',
        panelUiKey: 'hospitality_reservations',
      },
      {
        // "Reservas" is the appointments module (`orders_reservations`);
        // the hotel entry carries its own name and key so both can coexist.
        label: 'Reservas de hotel',
        icon: 'calendar-check',
        route: '/admin/hospitality/reservations',
        panelUiKey: 'hospitality_reservations',
      },
      {
        label: 'Habitaciones',
        icon: 'bed-double',
        route: '/admin/hospitality/rooms',
      },
      {
        // H2.1 — rate plans and nightly prices.
        label: 'Tarifas',
        icon: 'tag',
        route: '/admin/hospitality/rates',
        panelUiKey: 'hospitality_rates',
      },
      {
        // H5.1 — room status board: same panel_ui key as Habitaciones, so
        // the Camarera preset (hospitality_rooms) already shows it.
        label: 'Limpieza',
        icon: 'sparkles',
        route: '/admin/hospitality/housekeeping',
        panelUiKey: 'hospitality_rooms',
      },
      {
        // R4 — one entry for the four hotel reports, shown as tabs.
        label: 'Reportes de hotel',
        icon: 'chart-line',
        route: '/admin/hospitality/reports',
        panelUiKey: 'hospitality_reservations',
      },
      {
        // H4.1 — TRA (MinCIT) guest reports.
        label: 'Cumplimiento',
        icon: 'shield-check',
        route: '/admin/hospitality/compliance',
        panelUiKey: 'hospitality_reservations',
      },
    ],
  },
  {
    label: 'Órdenes',
    icon: 'cart',
    children: [
      {
        label: 'Ordenes de Venta',
        icon: 'circle',
        route: '/admin/orders/sales',
      },
      {
        label: 'Ordenes de Compra',
        icon: 'circle',
        route: '/admin/orders/purchase-orders',
      },
      {
        label: 'Cotizaciones',
        icon: 'circle',
        route: '/admin/orders/quotations',
      },
      {
        label: 'Contratos',
        icon: 'circle',
        route: '/admin/orders/contracts',
      },
      {
        label: 'Plan Separe',
        icon: 'circle',
        route: '/admin/orders/layaway',
      },
      {
        label: 'Reservas',
        icon: 'calendar-clock',
        route: '/admin/reservations',
      },
      {
        label: 'Pedidos programados',
        icon: 'calendar-clock',
        route: '/admin/scheduled-orders',
      },
      {
        label: 'Estaciones de Servicio',
        icon: 'warehouse',
        route: '/admin/services/stations',
      },
    ],
  },
  {
    label: 'Despacho',
    icon: 'truck',
    children: [
      {
        label: 'Remisiones',
        icon: 'circle',
        route: '/admin/orders/dispatch-notes',
      },
      {
        label: 'Rutas',
        icon: 'truck',
        route: '/admin/orders/planillas',
      },
      {
        label: 'Métodos de Envío',
        icon: 'circle',
        route: '/admin/settings/shipping',
      },
      {
        label: 'Flota',
        icon: 'circle',
        route: '/admin/orders/fleet',
      },
    ],
  },
  {
    label: 'Productos',
    icon: 'package',
    children: [
      { label: 'Lista', icon: 'list', route: '/admin/products' },
      {
        label: 'Categorías',
        icon: 'layers',
        route: '/admin/products/categories',
      },
      { label: 'Marcas', icon: 'tag', route: '/admin/products/brands' },
      {
        label: 'Precios y Tarifas',
        icon: 'circle',
        route: '/admin/price-tiers',
      },
    ],
  },
  {
    label: 'Inventario',
    icon: 'warehouse',
    children: [
      {
        label: 'Punto de Compra',
        icon: 'circle',
        route: '/admin/inventory/pop',
      },
      {
        label: 'Ajustes de Stock',
        icon: 'circle',
        route: '/admin/inventory/adjustments',
      },
      {
        label: 'Transferencias',
        icon: 'circle',
        route: '/admin/inventory/transfers',
      },
      {
        label: 'Movimientos',
        icon: 'circle',
        route: '/admin/inventory/movements',
      },
      {
        label: 'Ubicaciones',
        icon: 'circle',
        route: '/admin/inventory/locations',
      },
      {
        label: 'Proveedores',
        icon: 'circle',
        route: '/admin/inventory/suppliers',
      },
      {
        label: 'Números de Serie',
        icon: 'fingerprint',
        route: '/admin/inventory/serials',
      },
    ],
  },
  {
    label: 'Clientes',
    icon: 'users',
    children: [
      {
        label: 'Todos los Clientes',
        icon: 'circle',
        route: '/admin/customers/all',
      },
      {
        // Opt-out panel_ui key (DEFAULT_ON_PANEL_KEYS, apps-module T0) on top
        // of the permission gate in MenuFilterService.
        label: 'Bandeja',
        icon: 'inbox',
        route: '/admin/customers/inbox',
        panelUiKey: 'customers_inbox',
      },
      {
        label: 'Pipeline',
        icon: 'trending-up',
        route: '/admin/customers/pipeline',
        panelUiKey: 'customers_pipeline',
      },
      {
        label: 'Tareas',
        icon: 'check-square',
        route: '/admin/customers/tasks',
        panelUiKey: 'customers_tasks',
      },
      {
        label: 'Segmentos',
        icon: 'users',
        route: '/admin/customers/segments',
        panelUiKey: 'customers_segments',
      },
      {
        label: 'Reseñas',
        icon: 'star',
        route: '/admin/customers/reviews',
      },
      {
        label: 'Recolección de Datos',
        icon: 'circle',
        route: '/admin/data-collection',
      },
      {
        // Internal module `crm` (QUI-719); visible name frees "CRM" for the
        // customer CRM. Same panel_ui key as before. Since apps-vistas-f1
        // (S4) its view lives in Apps; with Apps on, `applyAppsMenu` moves
        // this entry out of Clientes (with Apps off it stays here).
        label: 'Landing de captación',
        icon: 'sparkles',
        route: '/admin/apps/landing',
        panelUiKey: 'customers_crm',
      },
    ],
  },
  {
    label: 'Tienda en línea',
    icon: 'shopping-bag',
    route: '/admin/ecommerce',
  },
  {
    label: 'Marketing',
    icon: 'megaphone',
    children: [
      {
        label: 'Promociones',
        icon: 'circle',
        route: '/admin/marketing/promotions',
      },
      {
        label: 'Cupones',
        icon: 'circle',
        route: '/admin/marketing/coupons',
      },
      {
        label: 'Anuncios',
        icon: 'image',
        route: '/admin/marketing/anuncios',
      },
    ],
  },
  {
    label: 'Analíticas',
    icon: 'chart-line',
    children: [
      {
        label: 'Resumen',
        icon: 'circle',
        route: '/admin/analytics/overview',
        panelUiKey: 'analytics_overview',
        accessAuditOnly: true,
      },
      {
        label: 'Ventas',
        icon: 'circle',
        route: '/admin/analytics/sales',
        panelUiKey: 'analytics_sales',
        accessAuditOnly: true,
      },
      {
        label: 'Inventario',
        icon: 'circle',
        route: '/admin/analytics/inventory',
        panelUiKey: 'analytics_inventory',
        accessAuditOnly: true,
      },
      {
        label: 'Productos',
        icon: 'circle',
        route: '/admin/analytics/products',
        panelUiKey: 'analytics_products',
        accessAuditOnly: true,
      },
      {
        label: 'Compras',
        icon: 'shopping-cart',
        route: '/admin/analytics/purchases',
        panelUiKey: 'analytics_purchases',
        accessAuditOnly: true,
      },
      {
        label: 'Clientes',
        icon: 'circle',
        route: '/admin/analytics/customers',
        panelUiKey: 'analytics_customers',
        accessAuditOnly: true,
      },
      {
        label: 'Reseñas',
        icon: 'star',
        route: '/admin/analytics/reviews',
        panelUiKey: 'analytics_reviews',
        accessAuditOnly: true,
      },
      {
        label: 'Financiero',
        icon: 'circle',
        route: '/admin/analytics/financial',
        panelUiKey: 'analytics_financial',
        accessAuditOnly: true,
      },
      {
        label: 'Pagos',
        icon: 'circle',
        route: '/admin/analytics/payments',
        panelUiKey: 'analytics_payments',
        accessAuditOnly: true,
      },
      {
        label: 'Despachos',
        icon: 'circle',
        route: '/admin/analytics/dispatch',
        // Two sidebar children are labeled "Despachos" (this one and the
        // Reportes one below). `moduleKeyMap` in menu-filter.service.ts is
        // indexed by label, so a flat map cannot tell them apart. This
        // explicit `panelUiKey` (the same field catalog-derived nodes
        // already use — see MenuItem.panelUiKey) wins over the label
        // lookup in filterItemsRecursive's Case 2.
        panelUiKey: 'analytics_dispatch',
      },
    ],
  },
  {
    label: 'Reportes',
    icon: 'file-bar-chart',
    children: [
      {
        label: 'Resumen',
        icon: 'circle',
        route: '/admin/reports/overview',
        panelUiKey: 'reports_overview',
        accessAuditOnly: true,
      },
      {
        label: 'Ventas',
        icon: 'circle',
        route: '/admin/reports/sales',
        panelUiKey: 'reports_sales',
        accessAuditOnly: true,
      },
      {
        label: 'Inventario',
        icon: 'circle',
        route: '/admin/reports/inventory',
        panelUiKey: 'reports_inventory',
        accessAuditOnly: true,
      },
      {
        label: 'Productos',
        icon: 'circle',
        route: '/admin/reports/products',
        panelUiKey: 'reports_products',
        accessAuditOnly: true,
      },
      {
        label: 'Compras',
        icon: 'circle',
        route: '/admin/reports/purchases',
        panelUiKey: 'reports_purchases',
        accessAuditOnly: true,
      },
      {
        label: 'Clientes',
        icon: 'circle',
        route: '/admin/reports/customers',
        panelUiKey: 'reports_customers',
        accessAuditOnly: true,
      },
      {
        label: 'Reseñas',
        icon: 'circle',
        route: '/admin/reports/reviews',
        panelUiKey: 'reports_reviews',
        accessAuditOnly: true,
      },
      {
        label: 'Financiero',
        icon: 'circle',
        route: '/admin/reports/financial',
        panelUiKey: 'reports_financial',
        accessAuditOnly: true,
      },
      {
        label: 'Pagos',
        icon: 'circle',
        route: '/admin/reports/payments',
        panelUiKey: 'reports_payments',
        accessAuditOnly: true,
      },
      {
        label: 'Contabilidad',
        icon: 'circle',
        route: '/admin/reports/accounting',
        panelUiKey: 'reports_accounting',
        accessAuditOnly: true,
      },
      {
        label: 'Nómina',
        icon: 'circle',
        route: '/admin/reports/payroll',
        panelUiKey: 'reports_payroll',
        accessAuditOnly: true,
      },
      {
        label: 'Despachos',
        icon: 'circle',
        route: '/admin/reports/dispatch',
        // Same label collision as the Analíticas → Despachos entry above;
        // this explicit panelUiKey disambiguates it in
        // filterItemsRecursive's Case 2 (menu-filter.service.ts).
        panelUiKey: 'reports_dispatch',
      },
    ],
  },
  {
    // Finanzas (formerly "Fiscal"): money and fiscal obligations. No panel_ui
    // key, same as the old group: it shows when any child is visible.
    // Gastos is always available and goes first, so opening the group lands
    // on it. Every fiscal child below appears only once its stage of the
    // fiscal wizard is complete: `FISCAL_STAGE_ROUTE_GATES`
    // (fiscal-status.model.ts) maps each route to its stage, and both the
    // sidebar filter and `panelUiGuard` read it, so a hidden entry does not
    // open by URL either.
    //
    // Fiscal umbrella — one sidebar group consolidating every fiscal surface
    // for stores that OWN their fiscal scope. Each child is a leaf whose
    // module renders its own sub-sections as internal sticky-header tabs
    // (invoicing/accounting/payroll shells + the fiscal compliance hub).
    // The parent is scope-neutral so a permissioned reader can reach the
    // received-documents-only fallback when the organization owns fiscal.
    // The activation, accounting, payroll and full invoicing leaves remain
    // scoped/gated; emission still appears only after invoicing is active.
    label: 'Finanzas',
    icon: 'landmark',
    children: [
      {
        label: 'Gastos',
        icon: 'wallet',
        route: '/admin/expenses',
      },
      {
        // Tax categories. Stage: "Impuestos" (default_taxes) of the wizard.
        label: 'Impuestos',
        icon: 'receipt',
        route: '/admin/taxes',
      },
      {
        // Stage: any fiscal area finished (its hub only operates then; before
        // that it is the activation panel, still reachable at
        // /admin/fiscal/wizard and /admin/fiscal/activation).
        label: 'Operación fiscal',
        icon: 'clipboard-list',
        route: '/admin/fiscal',
        requiredFiscalScope: 'STORE',
      },
      {
        label: 'Activar facturación electrónica',
        icon: 'zap',
        route: '/admin/invoicing/activation',
        // Same panel_ui key as "Facturación" (explicit key, not label-joined).
        panelUiKey: 'invoicing',
        requiredFiscalScope: 'STORE',
        hiddenWhenFiscalAreaActive: 'invoicing',
      },
      {
        label: 'Facturación',
        icon: 'file-text',
        route: '/admin/invoicing',
        requiredFiscalScope: 'STORE',
        requiresFiscalArea: 'invoicing',
        fiscalReadFallback: {
          permission: 'invoicing:received:read',
          route: '/admin/invoicing/received-documents',
        },
      },
      {
        label: 'Contabilidad',
        icon: 'book-open',
        route: '/admin/accounting',
        requiredFiscalScope: 'STORE',
        requiresFiscalArea: 'accounting',
      },
      {
        label: 'Nómina',
        icon: 'banknote',
        route: '/admin/payroll',
        requiredFiscalScope: 'STORE',
        requiresFiscalArea: 'payroll',
      },
    ],
  },
  {
    label: 'Ayuda',
    icon: 'help-circle',
    children: [
      {
        label: 'Soporte',
        icon: 'circle',
        route: '/admin/help/support',
      },
      {
        label: 'PQRS',
        icon: 'message-square',
        route: '/admin/pqrs',
      },
      {
        label: 'Centro de Ayuda',
        icon: 'circle',
        route: '/admin/help/center',
      },
      {
        label: 'Videos de Capacitación',
        icon: 'video',
        route: '/admin/help/videos',
        accessAuditOnly: true,
        panelUiKey: 'help_videos',
      },
    ],
  },
  {
    label: 'Configuración',
    icon: 'settings',
    panelUiKey: 'settings',
    accessAuditOnly: true,
    children: [
      {
        label: 'General',
        icon: 'circle',
        route: '/admin/settings/general',
      },
      {
        label: 'Usuarios',
        icon: 'circle',
        route: '/admin/settings/users',
      },
      {
        label: 'Roles',
        icon: 'circle',
        route: '/admin/settings/roles',
      },
      {
        label: 'Caja Registradora',
        icon: 'circle',
        route: '/admin/cash-registers',
      },
      {
        label: 'Métodos de Pago',
        icon: 'circle',
        route: '/admin/settings/payments',
      },
      {
        label: 'Formatos de Impresión',
        icon: 'circle',
        route: '/admin/settings/print-formats',
      },
      {
        // Moved from the former "Integraciones" group (one child): configured
        // once. Reuses the persisted panel_ui key of the former "Social Sales"
        // entry so stores keep their visibility without a data migration.
        label: 'Canales',
        icon: 'message-circle',
        route: '/admin/integrations/channels',
        panelUiKey: 'marketing_social_sales',
      },
      {
        label: 'Apariencia',
        icon: 'circle',
        route: '/admin/settings/appearance',
      },
      {
        label: 'Seguridad',
        icon: 'circle',
        route: '/admin/settings/security',
      },
      {
        // apps-f4 S2: key `settings_ai_agents` (new, not offered in the
        // panel editor yet) and audit-only, so it stays visible as before.
        // Its real gate is still `passesAuthorizationGates` (owner/admin),
        // which runs before every case.
        label: 'Agentes IA',
        icon: 'bot',
        route: '/admin/settings/ai-agents',
        panelUiKey: 'settings_ai_agents',
        accessAuditOnly: true,
      },
      {
        label: 'Dominios',
        icon: 'circle',
        route: '/admin/settings/domains',
      },
      {
        label: 'Documentos Legales',
        icon: 'circle',
        route: '/admin/settings/legal-documents',
      },
    ],
  },
];
