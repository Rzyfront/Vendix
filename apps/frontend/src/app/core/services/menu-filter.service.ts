import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { SubscriptionAccessService } from './subscription-access.service';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';
import {
  INDUSTRY_METADATA,
  StoreIndustry,
  getModulesHiddenByIndustries,
} from '../../shared/constants/industry-modules.constant';
import {
  MODULE_INDUSTRIES,
  type ModuleIndustry,
  industryAllowsKey,
  isIndustryAlwaysEnforced,
} from '../../shared/constants/module-industries';
import {
  MODULE_GATE_ROUTES,
  MODULE_ROUTES,
  MODULE_ROUTE_ALIASES,
  ORG_MODULE_ROUTES,
  STORE_MODULE_BY_KEY,
  STORE_MODULE_CATALOG,
} from '../../shared/constants/store-module-catalog.constant';
import {
  AccessDecision,
  AccessGateApp,
  AccessGateService,
  AccessLayer,
  AccessSurface,
  CurrentPlan,
  PlanOffer,
} from './access-gate.service';
import {
  PLAN_MODULE_FAMILIES,
  type PlanModuleFamily,
  planModuleFamily,
} from '../../shared/constants/plan-modules';
import { canUserAccessDashboard } from '../utils/dashboard-access.util';
import type {
  OrganizationOperatingScope,
  OrganizationFiscalScope,
} from '../models/organization.model';
import {
  FISCAL_STEP_LABELS,
  fiscalStageGateForRoute,
  fiscalStageGateForUrl,
  isFiscalStageReadFallbackUrl,
  isFiscalStageReady,
  isFiscalStageSetupUrl,
  type FiscalArea,
  type FiscalStageRouteGate,
} from '../models/fiscal-status.model';

/**
 * Terminal garantizado de la cadena de fallback "primer módulo activo".
 * Ruta a la que se rebota cuando ningún módulo del panel está habilitado, de
 * forma que el navegador nunca quede en bucle infinito ni en pantalla en
 * blanco. El guardla trata como compuerta de escape (la permite siempre);
 * el layout muestra una pantalla de "sin módulos" cuando el sidebar queda
 * vacío. Es el terminal de A.4 / B.1 / `storeDashboardGuard`.
 */
export const PANEL_UI_TERMINAL_ROUTE = '/admin/settings/general';

/**
 * Pantalla a la que se envía a un usuario SIN módulos activos. Se diferencia
 * del terminal (`PANEL_UI_TERMINAL_ROUTE`) porque el dueño siempre cae al
 * terminal y un usuario sin permisos aterriza aquí con un CTA de "Cerrar
 * sesión". El `panelUiGuard` lo trata como compuerta de escape (la permite
 * siempre, igual que el terminal) para que `firstActiveModuleRoute`/`storeDashboardGuard`
 * puedan redirigirlo sin bucle.
 */
export const PANEL_UI_NO_ACCESS_ROUTE = '/admin/no-access';

/**
 * `panel_ui` keys that are visible unless a map says `false` explicitly
 * (opt-out), instead of the usual "visible only when `true`".
 *
 * Bandeja, Pipeline, Tareas and Segmentos (apps-module T0) used to be
 * `alwaysVisible` with no key at all: every user with the permission saw them,
 * whatever their stored `panel_ui`. Giving them a key with the usual opt-in
 * rule would hide them from every user whose stored map predates the key —
 * the backend fills defaults only for privileged roles. Opt-out keeps exactly
 * today's audience and still lets a store or a user switch them off.
 *
 * `apps` follows the same rule: the real gate of the Apps catalog is the
 * store switch `store_settings.apps.enabled`; the key only lets a user hide it.
 */
export const DEFAULT_ON_PANEL_KEYS: readonly string[] = [
  'customers_inbox',
  'customers_pipeline',
  'customers_tasks',
  'customers_segments',
  'apps',
  // P5.7: the sidebar children of Flujos and Documentos. Opt-out so every
  // user who saw the single entry before keeps seeing the screens; the
  // parent key (`flows`/`documents`) and the permission prefilter
  // (`ADMINISTRATION_PERMISSION_ROUTES`) still decide.
  'flows_list',
  'flows_inbox',
  'flows_board',
  'flows_insights',
  'flows_templates',
  'flows_records',
  'flows_connectors',
  'flows_integrations',
  'flows_usage',
  'flows_audit',
  'flows_exports',
  'flows_help',
  'documents_dossiers',
  'documents_search',
  'documents_folders',
  'documents_expiring',
  'documents_retention',
  'documents_templates',
];

/**
 * P5.7: permission each sidebar child of Flujos and Documentos needs, any of
 * the list, matching the API that loads the screen. Exact routes only: the
 * detail pages under them (an instance opened from "Mis tareas", a record, a
 * retention run) keep their own API check, so a task-only user still opens
 * the instance of a task. The owner always passes.
 */
export const ADMINISTRATION_PERMISSION_ROUTES: Readonly<Record<string, readonly string[]>> = {
  '/admin/workflows': ['store:workflows:read', 'store:workflows:start'],
  '/admin/workflows/inbox': ['store:workflows:task'],
  '/admin/workflows/board': ['store:workflows:read'],
  '/admin/workflows/insights': ['store:workflows:read'],
  '/admin/workflows/templates': ['store:workflows:read'],
  '/admin/workflows/records': ['store:workflows:read'],
  '/admin/workflows/connectors': ['store:workflows:design'],
  '/admin/workflows/integrations': ['store:integrations:api_keys', 'store:workflows:manage'],
  '/admin/workflows/usage': ['store:workflows:read'],
  '/admin/workflows/audit': ['store:workflows:manage'],
  '/admin/workflows/exports': ['store:workflows:manage'],
  '/admin/workflows/help': ['store:workflows:read', 'store:workflows:start', 'store:workflows:task'],
  '/admin/documents': ['store:documents:read'],
  '/admin/documents/search': ['store:documents:read'],
  '/admin/documents/folders': ['store:documents:read'],
  '/admin/documents/expiring': ['store:documents:read'],
  '/admin/documents/retention': ['store:workflows:design'],
  '/admin/documents/templates': ['store:documents:read'],
};

/** Route of the Apps catalog page (apps-module T6). */
/** CRM entries whose permission prefilter diagnose reports (apps-module T0). */
const CRM_PERMISSION_ROUTES = new Set([
  '/admin/customers/inbox',
  '/admin/customers/pipeline',
  '/admin/customers/tasks',
  '/admin/customers/segments',
]);

export const APPS_CATALOG_ROUTE = '/admin/apps';

/**
 * Why a module is not on screen. Ordered from structural (the store simply
 * does not do this) to fixable (a toggle is off).
 */
export type ModuleBlockReason =
  | 'fiscal_scope'
  | 'fiscal_area'
  | 'operating_scope'
  | 'industry'
  | 'store_panel_ui'
  | 'store_type'
  | 'user_panel_ui'
  | 'subscription'
  | 'permission'
  | 'empty';

/**
 * Visibility verdict for one module, with a user-facing explanation.
 *
 * Vexi reads `detail` almost verbatim, so it is written in Spanish, in second
 * person, and never names an internal field: "el módulo está desactivado para
 * toda la tienda", not "store_settings.panel_ui.STORE_ADMIN.inventory=false".
 */
export interface ModuleVisibilityDiagnosis {
  visible: boolean;
  /** `null` when visible. */
  blockedBy: ModuleBlockReason | null;
  detail: string;
  /** Route where the current user can lift the block, or `null` if they cannot. */
  fixPath: string | null;
}

/**
 * Verdict of the access gate for one `panel_ui` key (apps-f4 S4):
 * `canSeeKey(key) = user(key) ∧ store(key) ∧ industryAllows(key)`.
 */
export interface AccessVerdict {
  allowed: boolean;
  /** First layer that denies, `null` when allowed. */
  layer: AccessLayer | null;
  /** Industries the industry layer evaluated (store, or org union). */
  industries: string[];
}

/**
 * Why the plan in force does not open a module, and where to buy it. Built
 * from the gate state the backend sends (`plan.blocked`, `plan.required_plans`)
 * — the same source as the API 403 — so the panel never keeps its own list.
 */
export interface PlanLock {
  /** Key the lock is reported for (first denied key). */
  key: string;
  family: PlanModuleFamily | null;
  currentPlan: CurrentPlan | null;
  /** Sellable plans that include the module, cheapest first. */
  offers: PlanOffer[];
  /** The plan to preselect: same cycle as the current plan, else cheapest. */
  recommended: PlanOffer | null;
  /** `/admin/subscription/plans?plan=&cycle=&from=`. */
  upgradeUrl: string;
}

export const PLAN_CATALOG_ROUTE = '/admin/subscription/plans';

/**
 * Service for filtering menu items based on panel_ui configuration.
 * Provides both observable and synchronous filtering methods.
 */
@Injectable({
  providedIn: 'root',
})
export class MenuFilterService {
  private authFacade = inject(AuthFacade);
  private subscriptionAccess = inject(SubscriptionAccessService);
  private accessGate = inject(AccessGateService);

  /**
   * True when the current store has at least one PQR. The store-admin layout
   * hydrates this from the PQR stats endpoint; the service cannot fetch it
   * itself, so it stays `null` (= unknown) until told. `diagnose()` refuses to
   * blame this layer while unknown rather than assert a reason it cannot back.
   */
  readonly storeHasPqrs = signal<boolean | null>(null);

  /** Ajuste `scheduled_orders.enabled` de la tienda; oculta la entrada si no es `true`. */
  readonly scheduledOrdersEnabled = signal<boolean>(false);

  /**
   * Árbol de menú del store-admin. Por defecto se reconstruye del catálogo
   * (`STORE_MODULE_CATALOG`) para que el guard y el redirect de B.1 funcionen
   * ANTES de que el layout se monte (los guards corren antes de la creación de
   * componentes). El layout lo sobreescribe con su árbol real (con
   * ítems audit-only, badges, etc.) al montarse vía `registerMenuTree`.
   */
  private menuTree: MenuItem[] | null = null;

  /** Caché del árbol reconstruido del catálogo. */
  private catalogTreeCache: MenuItem[] | null = null;

  /** Caché del índice ruta → keys panel_ui. */
  private routeKeysIndexCache: Record<string, string[]> | null = null;
  private gateRouteIndexCache: Record<string, string[]> | null = null;
  private orgRouteIndexCache: Record<string, string[]> | null = null;

  /**
   * Emits whenever an authorization prefilter flips, so `filterMenuItems`
   * re-runs. Its value is unused — the gates are read from the signals inside
   * the filter; this exists purely to make the observable pass reactive to
   * them, which is the bug the layout was working around with its own
   * `combineLatest`.
   */
  private readonly authorizationGates$ = toObservable(
    computed(
      () =>
        `${this.canManageUsers()}|${this.storeHasPqrs()}|${this.scheduledOrdersEnabled()}|${this.canConfigureAiAgents()}|${this.canAccessDashboard()}|${this.canOpenAppsCatalog()}`,
    ),
  );

  /**
   * Modules hidden per store type.
   * - physical/popup/kiosko: hide ecommerce (no online store)
   * - online: hide POS and cash registers (no physical presence)
   * - hybrid: show everything
   */
  private storeTypeHiddenModules: Record<string, string[]> = {
    physical: ['ecommerce'],
    popup: ['ecommerce'],
    kiosko: ['ecommerce'],
    online: ['pos', 'settings_cash_registers'],
  };

  /**
   * Mapping between menu item labels and panel_ui module keys.
   * This maps the Spanish menu labels to the English module keys stored in panel_ui.
   * Includes both parent modules and individual sub-modules.
   *
   * Note: "Configuración" maps to "settings" and is shared by both ORG_ADMIN and STORE_ADMIN.
   *
   * When a label maps to multiple keys (array), the item is visible if ANY key is enabled.
   * This allows the same label to work in different app contexts (e.g., "Dominios" in
   * ORG_ADMIN uses 'domains' key, while in STORE_ADMIN it uses 'settings_domains').
   */
  private moduleKeyMap: Record<string, string | string[]> = {
    // ORG_ADMIN mappings (módulos principales)
    'Panel Principal': 'dashboard',
    Tiendas: 'stores',
    Usuarios: ['users', 'settings_users'],
    Roles: 'settings_roles',
    'Auditoría y Cumplimiento': 'audit',

    // STORE_ADMIN - Módulos principales (sin hijos)
    'Punto de Venta': 'pos',
    Productos: 'products',
    Lista: 'products_list',
    Categorías: 'products_categories',
    Marcas: 'products_brands',
    Adiciones: 'products_option_groups',
    'Tienda en línea': 'ecommerce',

    // STORE_ADMIN - Órdenes (padre + submódulos)
    Órdenes: 'orders',
    'Ordenes de Venta': 'orders_sales',
    'Ordenes de Compra': 'orders_purchase_orders',
    Cotizaciones: 'orders_quotations',
    // Contratos de obra (A.2, ADR-02, FB-02). La pagina y la entrada del
    // sidebar llegan con C.2; el mapeo existe desde ahora para que el filtro
    // y `diagnose()` apliquen el gating por industria a la key.
    Contratos: 'orders_contracts',
    'Plan Separe': 'orders_layaway',
    Reservas: 'orders_reservations',
    'Pedidos programados': 'orders_scheduled',
    'Estaciones de Servicio': 'orders_service_stations',

    // STORE_ADMIN - Despacho (padre + submódulos)
    Despacho: 'dispatch',
    Remisiones: 'orders_dispatch_notes',
    'Planillas de Ruta': 'orders_dispatch_routes', // legacy label
    Rutas: 'orders_dispatch_routes',
    Flota: 'dispatch_fleet',

    // ORG_ADMIN - Compras (consolidado) + analytics_purchases (Analiticas > Compras)
    Compras: ['analytics_purchases', 'purchase_orders', 'orders_purchase_orders', 'orders'],

    // STORE_ADMIN - Inventario (padre + submódulos)
    Inventario: 'inventory',
    'Punto de Compra': 'inventory_pop',
    'Ajustes de Stock': 'inventory_adjustments',
    Ubicaciones: 'inventory_locations',
    Proveedores: 'inventory_suppliers',
    Movimientos: 'inventory_movements',
    Transferencias: 'inventory_transfers',
    'Números de Serie': 'inventory_serials',

    // STORE_ADMIN - Clientes (padre + submódulos)
    Clientes: 'customers',
    'Todos los Clientes': 'customers_all',
    Reseñas: ['analytics_reviews', 'customers_reviews'],
    'Recolección de Datos': 'customers_data_collection',
    CRM: 'customers_crm',
    'Landing de captación': 'customers_crm',

    // STORE_ADMIN - Marketing (padre + submódulos)
    Marketing: 'marketing',
    Promociones: 'marketing_promotions',
    Cupones: 'marketing_coupons',
    Anuncios: 'marketing_anuncios',

    // STORE_ADMIN - Analíticas (padre + submódulos)
    // Solo mapear los que NO conflictuan con otros módulos
    Analíticas: 'analytics',
    Resumen: 'analytics_overview',
    Ventas: 'analytics_sales',

    // STORE_ADMIN - Reportes
    Reportes: 'reports',

    // Caja Registradora (submodule of Configuración)
    'Caja Registradora': 'settings_cash_registers',

    // Gastos
    Gastos: 'expenses',

    // Restaurant Operations (Fase I) — padre + 5 submódulos.
    // Los subitems se mapean con su propia key para que el toggle
    // "Módulos del Panel" pueda prender/apagar cada submódulo de forma
    // granular. El padre "Operaciones de Restaurante" mapea al key padre
    // para que el sidebar renderice el grupo cuando la industria lo permita.
    'Operaciones de Restaurante': 'restaurant_ops',
    Recetas: 'restaurant_ops_recipes',
    Producción: 'restaurant_ops_production',
    Comandas: 'restaurant_ops_kds',
    Mesas: 'restaurant_ops_tables',
    Cartas: 'restaurant_ops_menus',

    // Manufactura (MVP) — padre + 3 submódulos. Visible solo cuando la
    // industria incluye `manufacturing` (INDUSTRY_HIDDEN_MODULES).
    Manufactura: 'manufacturing',
    Fórmulas: 'manufacturing_formulas',
    'Órdenes de producción': 'manufacturing_orders',
    Planta: 'manufacturing_settings',

    // Memberships (Membership Suite) — padre + 3 submódulos. El padre
    // "Zona Fit" mapea al key padre para que el sidebar renderice el grupo
    // cuando la industria (gym o service) lo permita; cada submódulo se mapea a
    // su propia key para que "Módulos del Panel" pueda prender/apagar
    // granularmente.
    'Zona Fit': 'memberships',
    Planes: 'memberships_plans',
    Miembros: 'memberships_members',
    Accesos: 'memberships_access',

    // Hotelería (Hospitality Suite, H0.1) — padre + submódulos. El padre
    // mapea al key padre para que el sidebar renderice el grupo cuando la
    // industria `hospitality` lo permita.
    Hotelería: 'hospitality',
    Habitaciones: 'hospitality_rooms',

    // Administración (flujos-documental S6). Industria `administration`,
    // siempre aplicada (ENFORCED_INDUSTRY_KEYS): el sidebar las deja visibles
    // con candado cuando la tienda no tiene la industria.
    Flujos: 'flows',
    Documentos: 'documents',

    // ERP Modules
    Facturación: 'invoicing',
    Facturas: 'invoicing_invoices',
    Resoluciones: 'invoicing_resolutions',
    'Configuración DIAN': 'invoicing_dian_config',
    Contabilidad: 'accounting',
    'Plan de Cuentas': 'accounting_chart_of_accounts',
    'Asientos Contables': 'accounting_journal_entries',
    'Periodos Fiscales': 'accounting_fiscal_periods',
    'Mapeo de Cuentas': 'accounting_account_mappings',
    'Flujos Contables': 'accounting_flows_dashboard',
    Cartera: 'cartera_dashboard',
    'Cuentas por Cobrar': 'cartera_receivables',
    'Cuentas por Pagar': 'cartera_payables',
    'Cartera por Vencimiento': 'cartera_aging',
    Nómina: 'payroll',
    Empleados: 'payroll_employees',
    'Períodos de Nómina': 'payroll_runs',
    'Configuración Nómina': 'payroll_settings',
    Liquidaciones: 'payroll_settlements',
    Novedades: 'payroll_novelties',
    Adelantos: 'payroll_advances',
    PILA: 'payroll_pila',

    // Legal / Tax modules
    Retenciones: 'accounting_withholding_tax',
    'Info Exógena': 'accounting_exogenous',
    'ICA Municipal': 'taxes_ica',
    Impuestos: 'taxes',
    'Operación fiscal': 'fiscal_operations',
    'Dashboard fiscal': 'fiscal_dashboard',
    'Obligaciones fiscales': 'fiscal_obligations',
    'Declaraciones fiscales': 'fiscal_declarations',
    'Cierre fiscal': 'fiscal_close',
    'Auditoría fiscal': 'fiscal_audit',
    'Reglas fiscales': 'fiscal_rules',

    // Configuración (compartido por ORG_ADMIN y STORE_ADMIN)
    // El padre "Configuración" y sus sub-items:
    Configuración: 'settings',
    Operación: ['settings_operations', 'settings'],
    'Modo operativo': ['settings_operating_scope', 'settings'],
    'Modo fiscal': ['settings_fiscal_scope', 'settings'],
    'Manejo fiscal': ['settings_fiscal_management', 'settings'],
    'Configuración de Aplicación': ['settings_application', 'settings'],
    General: ['settings_general', 'settings_application'],
    'Métodos de Pago': [
      'settings_payment_methods',
      'settings_payments',
      'settings',
    ],
    'Precios y Tarifas': 'settings_price_tiers',
    'Formatos de Impresión': [
      'settings_print_formats',
      'settings_general',
      'settings',
    ],
    Apariencia: 'settings_appearance',
    Seguridad: 'settings_security',
    // 'Dominios' supports both ORG_ADMIN (domains) and STORE_ADMIN (settings_domains)
    Dominios: ['domains', 'settings_domains'],
    'Métodos de Envío': 'settings_shipping',
    'Documentos Legales': 'settings_legal_documents',

    // Ayuda (padre + submódulos)
    Ayuda: 'help',
    Soporte: ['help_support', 'settings_support', 'help_pqrs'],
    'Centro de Ayuda': 'help_center',
    // "PQRS" (Peticiones, Quejas y Reclamos) — child of `help` in the
    // store-admin sidebar. The underlying `help_pqrs` key is kept for
    // the panel_ui contract and the existing merged config of users
    // (no migration needed for users who already enabled the toggle).
    PQRS: 'help_pqrs',
    // Legacy label kept so anyone still on the old Spanish name
    // (and any future rebrand) keeps the same panel_ui key.
    'Mis Solicitudes': 'help_pqrs',
    // Same `help_pqrs` key for the PQR child as it appears in the
    // org-admin and super-admin sidebars. Without this entry, the
    // filter's Case 3 (no key) hides the entire parent group because
    // the child never gets included.
    PQRs: 'help_pqrs',
    'Videos de Capacitación': 'help_videos',
    Videos: 'help_videos',
  };

  /**
   * Module keys hidden by a store setting (not by panel_ui). Today only the
   * physical kitchen mode: comandas are printed, so the virtual KDS screen
   * ("Comandas") makes no sense. Absent / null / 'virtual' hides nothing.
   * KDS station configuration is a different entry and stays visible.
   */
  private hiddenBySettings(
    settings: { restaurant?: { kitchen_mode?: string | null } } | null | undefined,
  ): string[] {
    return settings?.restaurant?.kitchen_mode === 'physical'
      ? ['restaurant_ops_kds']
      : [];
  }

  /**
   * Filter menu items based on panel_ui configuration.
   * Returns an Observable that emits filtered menu items.
   *
   * @param menuItems - All available menu items
   * @returns Observable of filtered menu items
   */
  filterMenuItems(menuItems: MenuItem[]): Observable<MenuItem[]> {
    // Register the tree so `currentMenuTree()`/`firstActiveModuleRoute()`
    // reflect the real sidebar (with audit-only items/badges) once mounted.
    this.menuTree = menuItems;
    return combineLatest([
      this.authFacade.getVisibleModules$(),
      this.authFacade.userStoreType$,
      this.authFacade.userIndustries$,
      this.authFacade.storeSettings$,
      this.authFacade.userOrganization$,
      this.authFacade.activeFiscalAreas$,
      this.authFacade.currentAppPanelUi$,
      this.authFacade.userPermissions$,
      // Layers 7 and 8 (authorization prefilters) used to live in the
      // store-admin layout, which spliced two entries out of the tree before
      // calling this method. They are inputs to the filter, so they belong
      // here — and they have to be part of the combineLatest, not read
      // imperatively inside `map`, or the menu would not re-emit when the PQR
      // count flips from zero.
      this.authorizationGates$,
    ]).pipe(
      map(
        ([
          visibleModules,
          loginStoreType,
          loginIndustries,
          storeSettings,
          organization,
          activeFiscalAreas,
          currentAppPanelUi,
          userPermissions,
        ]) => {
          // ─── Crossing order: industry ∩ store_panel ∩ user_panel ∩ store_type ∩ scope ∩ subscription ───
          // Each layer is an AND. A module is visible only if it passes every layer.
          // The `effectiveModules` chain below must read top-to-bottom in the same order
          // so the next dev can follow the flow without surprises.

          // Layer 1: industry availability.
          // Prefer store_settings.general.industries (updated on save) over user.store.industries
          // (login snapshot — may not include the field yet). Fallback to ['retail'] is the
          // canonical default from the DB column default + settings default.
          const industries: string[] =
            storeSettings?.general?.industries ||
            (Array.isArray(loginIndustries) ? loginIndustries : null) ||
            ['retail'];
          // OR semantics: a module is hidden only if hidden for EVERY industry of the store.
          const hiddenByIndustries = getModulesHiddenByIndustries(industries);

          // Layer 2: store panel UI (store-wide ceiling, editable by owner).
          // A key set to `false` in `store_settings.panel_ui.STORE_ADMIN` hides the module
          // for the whole store. Absent key or `true` = allowed.
          // Only the STORE_ADMIN app_type map applies (industries are store-scoped;
          // ORG_ADMIN is untouched). `panel_ui` itself is optional.
          const storePanelMap: Record<string, boolean> | undefined =
            storeSettings?.panel_ui?.STORE_ADMIN;
          // Build the list of module keys explicitly hidden store-wide.
          const hiddenByStorePanel = storePanelMap
            ? Object.entries(storePanelMap)
                .filter(([, allowed]) => allowed === false)
                .map(([key]) => key)
            : [];
          // Store settings that hide modules outside panel_ui (kitchen_mode).
          hiddenByStorePanel.push(...this.hiddenBySettings(storeSettings));

          // Layer 3: user panel UI (the existing per-user `panel_ui` map — comes in
          // as `visibleModules` from `getVisibleModules$()` — already merged with
          // defaults and the active app_type). Opt-out keys
          // (`DEFAULT_ON_PANEL_KEYS`) count as on unless the map says `false`.
          const userModules = this.withDefaultOnKeys(
            visibleModules,
            currentAppPanelUi,
          );

          // Layer 4: store_type (modality) — physical/popup/kiosko hide ecommerce,
          // online hides POS / cash registers, hybrid shows everything.
          // Prefer store_settings.general.store_type (updated on save) over user.store.store_type
          // (login snapshot).
          const storeType = storeSettings?.general?.store_type || loginStoreType;
          const hiddenByStoreType =
            this.storeTypeHiddenModules[storeType || ''] || [];

          // The normal visible-modules selector intentionally removes fiscal
          // module keys while an area is inactive. Reader-only fallback items
          // use the raw per-app map, but retain the same industry, store-wide
          // ceiling, and store-type filters before they can be rendered.
          const fallbackModuleKeys = this.fallbackPanelKeys(
            currentAppPanelUi,
            hiddenByIndustries,
            hiddenByStorePanel,
            hiddenByStoreType,
          );

          // Layers 5+6 (operating scope / fiscal scope / fiscal area / subscription)
          // run inside filterItemsRecursive below.
          const effectiveModules = userModules.filter(
            (m) =>
              !hiddenByIndustries.includes(m) &&
              !hiddenByStorePanel.includes(m) &&
              !hiddenByStoreType.includes(m),
          );

          const operatingScope: OrganizationOperatingScope =
            (organization?.operating_scope as
              | OrganizationOperatingScope
              | undefined) ?? 'STORE';
          // fiscal_scope defaults to operating_scope when not set (mirrors AuthFacade.fiscalScope).
          const fiscalScope: OrganizationFiscalScope =
            (organization?.fiscal_scope as
              | OrganizationFiscalScope
              | undefined) ?? operatingScope;
          return this.filterItemsRecursive(
            menuItems,
            effectiveModules,
            operatingScope,
            fiscalScope,
            activeFiscalAreas ?? [],
            fallbackModuleKeys,
            userPermissions ?? [],
          );
        },
      ),
    );
  }

  /**
   * Adds the opt-out keys (`DEFAULT_ON_PANEL_KEYS`) that the per-user map does
   * not switch off explicitly. Store-wide, industry and store-type layers still
   * run afterwards, so a store-wide `false` keeps hiding them.
   */
  private withDefaultOnKeys(
    visibleModules: string[],
    userPanelUi: Record<string, boolean> | null | undefined,
  ): string[] {
    const extra = DEFAULT_ON_PANEL_KEYS.filter(
      (key) => !visibleModules.includes(key) && userPanelUi?.[key] !== false,
    );
    return extra.length ? [...visibleModules, ...extra] : visibleModules;
  }

  /** Per-user verdict for one key, honoring the opt-out keys. */
  private isUserModuleVisible(key: string): boolean {
    if (this.authFacade.isModuleVisible(key)) return true;
    if (!DEFAULT_ON_PANEL_KEYS.includes(key)) return false;
    const panelUi = this.authFacade.currentAppPanelUi() as
      | Record<string, boolean>
      | null
      | undefined;
    return panelUi?.[key] !== false;
  }

  /**
   * Predicate: true when an item is allowed under the given operating scope.
   * Items without `requiredOperatingScope` are always allowed.
   */
  private matchesOperatingScope(
    item: MenuItem,
    scope: OrganizationOperatingScope,
  ): boolean {
    if (!item.requiredOperatingScope) return true;
    return item.requiredOperatingScope === scope;
  }

  /**
   * Resolves how an item should be treated when its `requiredOperatingScope`
   * does not match the active scope:
   *  - 'allow'  : item allowed (scope matches or no scope requirement).
   *  - 'lock'   : keep item visible but mark as `_locked` (showLocked === true).
   *  - 'hide'   : drop item entirely (default legacy behavior).
   */
  private resolveScopeOutcome(
    item: MenuItem,
    scope: OrganizationOperatingScope,
  ): 'allow' | 'lock' | 'hide' {
    if (this.matchesOperatingScope(item, scope)) {
      return 'allow';
    }
    return item.showLocked ? 'lock' : 'hide';
  }

  /**
   * Predicate: true when the item's `requiredFiscalScope` matches the active
   * fiscal_scope. Fiscal ownership is binary — the app that does NOT own the
   * fiscal_scope hides fiscal items outright (no locked state), so the user
   * sees nothing fiscal in the wrong scope.
   */
  private matchesFiscalScope(
    item: MenuItem,
    fiscalScope: OrganizationFiscalScope,
  ): boolean {
    if (!item.requiredFiscalScope) return true;
    return item.requiredFiscalScope === fiscalScope;
  }

  /**
   * Predicate: true when the item's required fiscal area is activated.
   * Operational fiscal modules stay hidden until their area reaches
   * ACTIVE/LOCKED (present in `activeFiscalAreas`). 'any' means at least one
   * area is active. Items without `requiresFiscalArea` (e.g. the activation
   * entry) are always allowed so the owner can activate fiscal management.
   */
  private matchesFiscalArea(
    item: MenuItem,
    activeFiscalAreas: FiscalArea[],
  ): boolean {
    if (
      item.hiddenWhenFiscalAreaActive &&
      activeFiscalAreas.includes(item.hiddenWhenFiscalAreaActive)
    ) {
      return false;
    }
    if (!this.matchesFiscalStage(item, activeFiscalAreas)) return false;
    if (!item.requiresFiscalArea) return true;
    if (item.requiresFiscalArea === 'any') return activeFiscalAreas.length > 0;
    return activeFiscalAreas.includes(item.requiresFiscalArea);
  }

  /**
   * Store-panel Finanzas entries appear only once their stage of the fiscal
   * wizard is complete (`FISCAL_STAGE_ROUTE_GATES`, shared with
   * `panelUiGuard`). ORG_ADMIN items (`requiredFiscalScope: 'ORGANIZATION'`)
   * keep their own rules.
   */
  private storeFiscalStageGate(item: MenuItem): FiscalStageRouteGate | null {
    if (item.requiredFiscalScope === 'ORGANIZATION') return null;
    return fiscalStageGateForRoute(item.route);
  }

  private matchesFiscalStage(
    item: MenuItem,
    activeFiscalAreas: FiscalArea[],
  ): boolean {
    const gate = this.storeFiscalStageGate(item);
    if (!gate) return true;
    // The wizard status is read only for stage gates, so filters and mocks
    // that never touch one do not depend on it.
    const status = 'step' in gate.requires ? this.authFacade.fiscalStatus() : null;
    return isFiscalStageReady(gate.requires, activeFiscalAreas, status);
  }

  /**
   * URL verdict of the fiscal stage gate for `panelUiGuard`. Returns the reason
   * when the URL belongs to a Finanzas entry whose wizard stage is missing, or
   * null when it may open (no gate, stage ready, setup screen of that stage, or
   * the read-only fallback for a reader holding its permission). Applies to the
   * owner too: an unconfigured stage has no operable screen for anyone.
   */
  fiscalStageBlockForUrl(url: string): ModuleVisibilityDiagnosis | null {
    const gate = fiscalStageGateForUrl(url);
    if (!gate || isFiscalStageSetupUrl(gate, url)) return null;
    const activeAreas = this.authFacade.activeFiscalAreas() ?? [];
    const status = 'step' in gate.requires ? this.authFacade.fiscalStatus() : null;
    if (isFiscalStageReady(gate.requires, activeAreas, status)) return null;
    if (
      gate.readFallback &&
      isFiscalStageReadFallbackUrl(gate, url) &&
      this.authFacade.hasPermission(gate.readFallback.permission)
    ) {
      return null;
    }
    return { visible: false, blockedBy: 'fiscal_area', ...this.fiscalStageMessage(gate) };
  }

  private fiscalStageMessage(
    gate: FiscalStageRouteGate,
  ): Pick<ModuleVisibilityDiagnosis, 'detail' | 'fixPath'> {
    if ('step' in gate.requires) {
      return {
        detail: `Esta sección aparece cuando completes la etapa «${FISCAL_STEP_LABELS[gate.requires.step]}» de la configuración fiscal.`,
        fixPath: '/admin/fiscal/wizard',
      };
    }
    return {
      detail:
        'Esta sección aparece cuando termines de activar su área en la configuración fiscal.',
      fixPath: '/admin/fiscal/wizard',
    };
  }

  private fallbackPanelKeys(
    currentAppPanelUi: unknown,
    hiddenByIndustries: string[],
    hiddenByStorePanel: string[],
    hiddenByStoreType: string[],
  ): ReadonlySet<string> {
    if (!currentAppPanelUi || typeof currentAppPanelUi !== 'object' || Array.isArray(currentAppPanelUi)) return new Set();
    return new Set(Object.entries(currentAppPanelUi as Record<string, unknown>)
      .filter(([key, visible]) => visible === true &&
        !hiddenByIndustries.includes(key) &&
        !hiddenByStorePanel.includes(key) &&
        !hiddenByStoreType.includes(key))
      .map(([key]) => key));
  }

  private createFiscalReadFallback(
    item: MenuItem,
    fiscalScope: OrganizationFiscalScope,
    activeFiscalAreas: FiscalArea[],
    fallbackModuleKeys: ReadonlySet<string>,
    userPermissions: string[],
  ): MenuItem | null {
    const fallback = item.fiscalReadFallback;
    if (!fallback || !userPermissions.includes(fallback.permission)) return null;
    const keys = this.moduleKeysFor(item);
    if (!keys.length || !keys.some((key) => fallbackModuleKeys.has(key))) return null;
    // Only replace the item when the full module is blocked. The normal route
    // and all its emission tabs remain untouched whenever both fiscal gates pass.
    if (this.matchesFiscalScope(item, fiscalScope) && this.matchesFiscalArea(item, activeFiscalAreas)) return item;
    return {
      ...item,
      route: fallback.route,
      requiredFiscalScope: undefined,
      requiresFiscalArea: undefined,
      action: undefined,
      children: undefined,
      accessAuditOnly: false,
      fiscalReadFallback: undefined,
      _fiscalReadFallbackActive: true,
    };
  }

  private fiscalFallbackPanelBlock(item: MenuItem): ModuleBlockReason | null {
    const keys = this.moduleKeysFor(item);
    if (!keys.length) return 'user_panel_ui';
    const settings = this.authFacade.storeSettings();
    const industries: string[] = settings?.general?.industries?.length
      ? settings.general.industries
      : this.authFacade.userIndustries()?.length
        ? this.authFacade.userIndustries()
        : ['retail'];
    const hiddenByIndustries = getModulesHiddenByIndustries(industries);
    if (keys.every((key) => hiddenByIndustries.includes(key))) return 'industry';
    const storePanel = settings?.panel_ui?.STORE_ADMIN as Record<string, boolean> | undefined;
    if (storePanel && keys.every((key) => storePanel[key] === false)) return 'store_panel_ui';
    const hiddenBySettings = this.hiddenBySettings(settings);
    if (keys.every((key) => hiddenBySettings.includes(key))) return 'store_panel_ui';
    const storeType = settings?.general?.store_type || this.authFacade.userStoreType();
    const hiddenByStoreType = this.storeTypeHiddenModules[storeType || ''] || [];
    if (keys.every((key) => hiddenByStoreType.includes(key))) return 'store_type';
    const rawPanel = this.authFacade.currentAppPanelUi();
    if (!rawPanel || typeof rawPanel !== 'object' || !keys.some((key) => (rawPanel as Record<string, unknown>)[key] === true)) return 'user_panel_ui';
    return null;
  }

  /**
   * Check if a module key (or any key in an array) is visible.
   *
   * @param moduleKey - Single key or array of keys to check
   * @param visibleModules - Array of visible module keys
   * @returns true if at least one key is in visibleModules
   */
  private isModuleKeyVisible(
    moduleKey: string | string[],
    visibleModules: string[],
  ): boolean {
    if (Array.isArray(moduleKey)) {
      // If array, check if ANY key matches (OR logic)
      return moduleKey.some((key) => visibleModules.includes(key));
    }
    return visibleModules.includes(moduleKey);
  }

  /**
   * Recursively filter menu items based on visible modules.
   * Handles nested children (submenus) and preserves structure.
   * Audit-only items (`accessAuditOnly`, formerly `alwaysVisible`) stay shown in audit mode if their parent is visible.
   *
   * @param items - Menu items to filter
   * @param visibleModules - Array of visible module keys
   * @param operatingScope - Current organization operating scope
   * @returns Filtered menu items
   */
  private filterItemsRecursive(
    items: MenuItem[],
    visibleModules: string[],
    operatingScope: OrganizationOperatingScope,
    fiscalScope: OrganizationFiscalScope,
    activeFiscalAreas: FiscalArea[],
    fallbackModuleKeys: ReadonlySet<string> = new Set<string>(),
    userPermissions: string[] = [],
  ): MenuItem[] {
    return items.reduce((filtered: MenuItem[], item) => {
      // Authorization prefilters, absorbed from the store-admin layout: two
      // entries that carry no panel_ui key and were previously removed from
      // the tree by the caller.
      if (!this.passesAuthorizationGates(item)) {
        return filtered;
      }
      const fiscalBlocked = !this.matchesFiscalScope(item, fiscalScope) || !this.matchesFiscalArea(item, activeFiscalAreas);
      const menuItem = fiscalBlocked
        ? this.createFiscalReadFallback(item, fiscalScope, activeFiscalAreas, fallbackModuleKeys, userPermissions)
        : item;
      if (!menuItem) return filtered;
      item = menuItem;

      // Operating scope guard:
      //   - 'hide' → drop item (legacy behavior)
      //   - 'lock' → keep item but mark `_locked` so the sidebar can render
      //              it disabled and redirect clicks to the operating-scope page
      //   - 'allow' → continue with normal filtering
      const scopeOutcome = this.resolveScopeOutcome(item, operatingScope);
      if (scopeOutcome === 'hide') {
        return filtered;
      }
      const locked = scopeOutcome === 'lock';

      // Case 1: item that skipped every panel_ui layer before apps-f4 (it was
      // `alwaysVisible`). It now carries its real key and goes through the
      // access gate, but in audit mode it stays visible: the gate verdict is
      // only recorded (S2). The enforce flag can only hide it by industry.
      if (item.accessAuditOnly) {
        if (!this.applyAccessGate(this.gateKeysFor(item), true, 'sidebar', item.route)) {
          return filtered;
        }
        if (
          item.requiresFeature &&
          !this.subscriptionAccess.canUseAI(item.requiresFeature)()
        ) {
          return filtered;
        }
        const auditOnlyItem: MenuItem = {
          ...item,
          _locked: locked,
          _planLocked: this.isLockedForSidebar(this.gateKeysFor(item)),
        };

        // If it has children, recursively filter them (children can also be audit-only)
        if (item.children && item.children.length > 0) {
          auditOnlyItem.children = this.filterItemsRecursive(
            item.children,
            visibleModules,
            operatingScope,
            fiscalScope,
            activeFiscalAreas,
            fallbackModuleKeys,
            userPermissions,
          );
          // A group with every child hidden is an empty header (e.g.
          // "Configuración" for a receptionist, H0.5): drop it.
          if (auditOnlyItem.children.length === 0) {
            return filtered;
          }
        }

        filtered.push(auditOnlyItem);
        return filtered;
      }

      // Case 2: Item has a module key mapping (filter by panel_ui)
      // `panelUiKey` (explicit, per-item) wins over the label-based
      // `moduleKeyMap` lookup — same precedence as `moduleKeysFor()` below,
      // used by `diagnose()`. Needed when two sibling items share a label
      // (e.g. two "Despachos" entries, one under Analíticas and one under
      // Reportes) so a flat label→key map cannot tell them apart. Existing
      // items never set `panelUiKey`, so this is a no-op for the rest of
      // the sidebar.
      const moduleKey = item.panelUiKey || this.moduleKeyMap[item.label];
      if (moduleKey) {
        // Only include if this specific module (or any key in array) is visible
        const itemKeys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
        const legacyVisible = item._fiscalReadFallbackActive
          ? itemKeys.some((key) => fallbackModuleKeys.has(key))
          : this.isModuleKeyVisible(moduleKey, visibleModules);
        // apps-f4 S4: same gate as the URL guard, the Apps card and Vexi.
        // Audit mode never hides beyond `legacyVisible`; it only records.
        const isVisible = this.applyAccessGate(
          itemKeys,
          legacyVisible,
          'sidebar',
          item.route,
        );
        if (isVisible) {
          if (
            item.requiresFeature &&
            !this.subscriptionAccess.canUseAI(item.requiresFeature)()
          ) {
            return filtered;
          }
          const filteredItem: MenuItem = {
            ...item,
            _locked: locked,
            _planLocked: this.isLockedForSidebar(itemKeys),
          };

          // Recursively filter children if present
          if (item.children && item.children.length > 0) {
            filteredItem.children = this.filterItemsRecursive(
              item.children,
              visibleModules,
              operatingScope,
              fiscalScope,
              activeFiscalAreas,
              fallbackModuleKeys,
              userPermissions,
            );
          }

          filtered.push(filteredItem);
        }
        // If moduleKey exists but is NOT in visibleModules, the item is hidden
      }
      // Case 3: Item without mapping and not audit-only (defensive fallback)
      // Only include if it has visible children
      else if (item.children && item.children.length > 0) {
        const filteredChildren = this.filterItemsRecursive(
          item.children,
          visibleModules,
          operatingScope,
          fiscalScope,
          activeFiscalAreas,
          fallbackModuleKeys,
          userPermissions,
        );

        if (filteredChildren.length > 0) {
          const filteredItem: MenuItem = {
            ...item,
            children: filteredChildren,
            _locked: locked,
          };
          if (
            item.requiresFeature &&
            !this.subscriptionAccess.canUseAI(item.requiresFeature)()
          ) {
            return filtered;
          }
          filtered.push(filteredItem);
        }
      }

      return filtered;
    }, []);
  }

  /**
   * Resuelve la(s) key(s) panel_ui asociadas a un label del menú.
   * Útil para correlacionar items renderizados con `new_keys` del backend.
   */
  getModuleKey(label: string): string | string[] | undefined {
    return this.moduleKeyMap[label];
  }

  /**
   * Determina si un item del menú es "nuevo" para el usuario actual.
   * Consume `newModuleKeys` del AuthFacade (calculado por el backend).
   *
   * Retorna `true` si alguna de las keys mapeadas para `label` está dentro
   * de la lista `new_keys` del app_type activo. Una vez que el usuario
   * marca la key como vista, el backend la remueve y este método retorna `false`.
   */
  isNewModule(label: string): boolean {
    const moduleKey = this.moduleKeyMap[label];
    if (!moduleKey) return false;
    const newKeys = this.authFacade.newModuleKeys() || [];
    if (!newKeys.length) return false;
    if (Array.isArray(moduleKey)) {
      return moduleKey.some((k) => newKeys.includes(k));
    }
    return newKeys.includes(moduleKey);
  }

  /**
   * Devuelve la primera key "nueva" mapeada al label dado. Útil para
   * pasar la key correcta a `markPanelUiSeen` al hacer click en el item.
   */
  getNewKeyForLabel(label: string): string | null {
    const moduleKey = this.moduleKeyMap[label];
    if (!moduleKey) return null;
    const newKeys = this.authFacade.newModuleKeys() || [];
    if (!newKeys.length) return null;
    if (Array.isArray(moduleKey)) {
      return moduleKey.find((k) => newKeys.includes(k)) ?? null;
    }
    return newKeys.includes(moduleKey) ? moduleKey : null;
  }

  /**
   * Check if a specific menu item should be visible.
   * Synchronous version for immediate checks.
   *
   * Kept as the boolean projection of `diagnose()` so there is exactly one
   * implementation of the visibility rules. It used to be an independent
   * re-statement that had drifted: it checked fiscal scope, fiscal area,
   * operating scope, user panel_ui and subscription, but silently omitted
   * industry, store-wide panel_ui and store_type — three layers the real
   * `filterMenuItems` pass does apply. An item hidden by any of those
   * reported `true` here.
   *
   * @param menuItem - Menu item to check
   * @returns true if visible, false otherwise
   */
  isMenuItemVisible(menuItem: MenuItem): boolean {
    return this.diagnose(menuItem).visible;
  }

  /**
   * Full visibility verdict for a menu item, with the reason when hidden.
   *
   * The layers are evaluated in the same order the sidebar applies them, and
   * the **first** blocker wins. Order matters for the answer quality, not just
   * for correctness: telling an owner "tu plan no incluye este módulo" when the
   * real cause is that the module is off for the whole store sends them to the
   * wrong screen. Cheapest-to-fix layers are therefore reported last.
   *
   * `fixPath` is where the *current user* can act. It is `null` when the block
   * is structural (industry, store type) or above their pay grade — Vexi then
   * says who to ask instead of routing them to a page they cannot use.
   */
  diagnose(menuItem: MenuItem): ModuleVisibilityDiagnosis {
    const settings = this.authFacade.storeSettings();
    const moduleKeys = this.moduleKeysFor(menuItem);
    const fiscalScope = this.authFacade.fiscalScope();
    const activeFiscalAreas = this.authFacade.activeFiscalAreas();

    if ((!this.matchesFiscalScope(menuItem, fiscalScope) || !this.matchesFiscalArea(menuItem, activeFiscalAreas)) && menuItem.fiscalReadFallback) {
      if (!this.authFacade.hasPermission(menuItem.fiscalReadFallback.permission)) {
        return {
          visible: false,
          blockedBy: 'permission',
          detail: 'Necesitas permiso de lectura de documentos recibidos para consultar esta bandeja.',
          fixPath: null,
        };
      }
      const panelBlock = this.fiscalFallbackPanelBlock(menuItem);
      if (panelBlock) {
        const detail: Record<ModuleBlockReason, string> = {
          fiscal_scope: '', fiscal_area: '', operating_scope: '',
          industry: 'Este módulo no aplica al giro de la tienda.',
          store_panel_ui: 'El módulo está desactivado para toda la tienda en la configuración de módulos del panel.',
          store_type: 'En esta modalidad de tienda el módulo no está disponible.',
          user_panel_ui: 'Activa Facturación en la configuración personal del panel para ver la bandeja.',
          subscription: '', permission: '', empty: '',
        };
        return { visible: false, blockedBy: panelBlock, detail: detail[panelBlock], fixPath: panelBlock === 'store_panel_ui' || panelBlock === 'user_panel_ui' ? '/admin/settings/general' : null };
      }
      if (this.resolveScopeOutcome(menuItem, this.authFacade.operatingScope()) === 'hide') {
        return { visible: false, blockedBy: 'operating_scope', detail: 'Este módulo no corresponde al modo de operación de la organización.', fixPath: '/admin/settings/general' };
      }
      if (menuItem.requiresFeature && !this.subscriptionAccess.canUseAI(menuItem.requiresFeature)()) {
        return { visible: false, blockedBy: 'subscription', detail: 'El plan actual no incluye esta función.', fixPath: '/admin/subscription' };
      }
      return {
        visible: true,
        blockedBy: null,
        detail: 'Solo se habilita la bandeja de documentos recibidos; la emisión de facturas sigue sujeta a la activación fiscal.',
        fixPath: null,
      };
    }

    // ─── 1. Fiscal scope ─────────────────────────────────────────────
    // Binary ownership: the app that does not own the fiscal_scope hides
    // fiscal items outright, with no locked state.
    if (!this.matchesFiscalScope(menuItem, this.authFacade.fiscalScope())) {
      return {
        visible: false,
        blockedBy: 'fiscal_scope',
        detail:
          menuItem.requiredFiscalScope === 'ORGANIZATION'
            ? 'La facturación y contabilidad de esta organización se llevan a nivel de organización, así que este módulo se administra desde el panel de la organización y no desde la tienda.'
            : 'La facturación y contabilidad se llevan por tienda, así que este módulo vive en el panel de cada tienda y no aquí.',
        fixPath: null,
      };
    }

    // ─── 2. Fiscal area activation ───────────────────────────────────
    if (!this.matchesFiscalArea(menuItem, this.authFacade.activeFiscalAreas())) {
      if (menuItem.hiddenWhenFiscalAreaActive) {
        return {
          visible: false,
          blockedBy: 'fiscal_area',
          detail:
            'La facturación electrónica ya está activa, así que este asistente de activación ya no se ofrece. Usa el módulo Facturación.',
          fixPath: '/admin/invoicing',
        };
      }
      const stageGate = this.storeFiscalStageGate(menuItem);
      if (stageGate && !this.matchesFiscalStage(menuItem, this.authFacade.activeFiscalAreas())) {
        return { visible: false, blockedBy: 'fiscal_area', ...this.fiscalStageMessage(stageGate) };
      }
      return {
        visible: false,
        blockedBy: 'fiscal_area',
        detail:
          'El manejo fiscal todavía no está activado para esta tienda. Al activarlo aparecerá este módulo.',
        fixPath: '/admin/fiscal/activation',
      };
    }

    // ─── 3. Operating scope ──────────────────────────────────────────
    // 'lock' still renders the item (disabled), so it counts as visible.
    const scopeOutcome = this.resolveScopeOutcome(
      menuItem,
      this.authFacade.operatingScope(),
    );
    if (scopeOutcome === 'hide') {
      return {
        visible: false,
        blockedBy: 'operating_scope',
        detail:
          menuItem.requiredOperatingScope === 'ORGANIZATION'
            ? 'Este módulo solo aplica cuando el inventario y las compras se manejan de forma centralizada por la organización. Hoy esta organización opera por tienda.'
            : 'Este módulo solo aplica cuando cada tienda opera de forma independiente. Hoy esta organización opera de forma centralizada.',
        fixPath: '/admin/settings/general',
      };
    }

    // Items with no panel_ui key (dynamic entries, group headers) skip every
    // key-driven layer — there is nothing to look up.
    if (moduleKeys.length) {
      // ─── 4. Industry ───────────────────────────────────────────────
      const industries: string[] = settings?.general?.industries?.length
        ? settings.general.industries
        : this.authFacade.userIndustries()?.length
          ? this.authFacade.userIndustries()
          : ['retail'];
      const hiddenByIndustries = getModulesHiddenByIndustries(industries);
      if (moduleKeys.every((key) => hiddenByIndustries.includes(key))) {
        return {
          visible: false,
          blockedBy: 'industry',
          detail: `Este módulo no aplica al giro de la tienda (${industries.join(', ')}). Se muestra solo en las industrias donde tiene sentido.`,
          fixPath: '/admin/settings/general',
        };
      }

      // ─── 5. Store-wide panel_ui ────────────────────────────────────
      // A key explicitly `false` in store_settings.panel_ui.STORE_ADMIN is off
      // for everyone in the store, regardless of the per-user map.
      const storePanelMap: Record<string, boolean> | undefined =
        settings?.panel_ui?.STORE_ADMIN;
      if (
        storePanelMap &&
        moduleKeys.every((key) => storePanelMap[key] === false)
      ) {
        return {
          visible: false,
          blockedBy: 'store_panel_ui',
          detail:
            'El módulo está desactivado para toda la tienda en la configuración de módulos del panel. El propietario o un administrador puede volver a activarlo.',
          fixPath: '/admin/settings/general',
        };
      }

      const hiddenBySettings = this.hiddenBySettings(settings);
      if (moduleKeys.every((key) => hiddenBySettings.includes(key))) {
        return {
          visible: false,
          blockedBy: 'store_panel_ui',
          detail:
            'La tienda usa KDS físico (comandas impresas), por eso la pantalla de Comandas está oculta. Se puede volver al KDS virtual en Configuración > Mesas.',
          fixPath: '/admin/settings/general/mesas',
        };
      }

      // ─── 6. Store type (modalidad) ─────────────────────────────────
      const storeType =
        settings?.general?.store_type || this.authFacade.userStoreType();
      const hiddenByStoreType =
        this.storeTypeHiddenModules[storeType || ''] || [];
      if (moduleKeys.every((key) => hiddenByStoreType.includes(key))) {
        return {
          visible: false,
          blockedBy: 'store_type',
          detail: `La tienda está configurada como "${storeType}", y en esa modalidad este módulo no se usa.`,
          fixPath: '/admin/settings/general',
        };
      }

      // ─── 7. Per-user panel_ui ──────────────────────────────────────
      // El owner ve TODO el panel sin importar `user_settings.config.panel_ui`.
      // El gate real sigue siendo backend (`@Permissions`); aquí solo quitamos
      // la restricción UX para que el owner nunca aterrice en "sin módulos"
      // ni tenga que mantener su propio `panel_ui`. Coherente con
      // `mergePanelUiSoft` que ya rellena defaults para roles privilegiados.
      if (!this.authFacade.isOwner() && !moduleKeys.some((key) => this.isUserModuleVisible(key))) {
        return {
          visible: false,
          blockedBy: 'user_panel_ui',
          detail:
            'Tu usuario tiene este módulo oculto en su configuración de panel. Puedes activarlo tú mismo, o pedirle a un administrador que lo haga.',
          fixPath: '/admin/settings/general',
        };
      }
    }

    // ─── 8. Subscription ─────────────────────────────────────────────
    if (
      menuItem.requiresFeature &&
      !this.subscriptionAccess.canUseAI(menuItem.requiresFeature)()
    ) {
      return {
        visible: false,
        blockedBy: 'subscription',
        detail:
          'El plan actual de la tienda no incluye esta función. Se habilita al cambiar de plan.',
        fixPath: '/admin/subscription',
      };
    }

    // ─── 9. Authorization prefilters ─────────────────────────────────
    // These entries carry authorization gates beyond basic panel_ui settings.
    // Folding them in here keeps the reason available instead of vanishing.
    if (menuItem.route === '/admin/dashboard' && !this.canAccessDashboard()) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail: 'No tienes permisos para acceder al Panel Principal.',
        fixPath: null,
      };
    }
    if (menuItem.route === '/admin/settings/users' && !this.canManageUsers()) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail:
          'Necesitas el permiso de gestión de usuarios (o ser propietario o administrador) para entrar aquí.',
        fixPath: null,
      };
    }
    if (menuItem.route === '/admin/pqrs' && this.storeHasPqrs() === false) {
      return {
        visible: false,
        blockedBy: 'empty',
        detail:
          'La tienda todavía no tiene ninguna PQR, así que la sección permanece oculta. Aparecerá sola en cuanto llegue la primera.',
        fixPath: null,
      };
    }
    if (menuItem.route === '/admin/settings/ai-agents' && !this.canConfigureAiAgents()) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail:
          'Solo el propietario o un administrador puede configurar los agentes de IA.',
        fixPath: null,
      };
    }
    if (menuItem.route === APPS_CATALOG_ROUTE && !this.canOpenAppsCatalog()) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail: this.appsCatalogEnabled()
          ? 'Necesitas el permiso de lectura de Apps para ver el catálogo de aplicaciones.'
          : 'El módulo Apps está apagado en esta tienda. El propietario lo enciende en Configuración > General > Negocio.',
        fixPath: null,
      };
    }
    // The CRM entries left `alwaysVisible` (apps-module T0), so their
    // permission prefilter must also reach diagnose; otherwise the redirect
    // chain could land on an entry the sidebar does not show. Scoped to those
    // routes: other prefilters keep their pre-existing diagnose behavior.
    if (
      (CRM_PERMISSION_ROUTES.has(menuItem.route ?? '') ||
        ADMINISTRATION_PERMISSION_ROUTES[menuItem.route ?? ''] !== undefined) &&
      !this.passesAuthorizationGates(menuItem)
    ) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail: 'Tu usuario no tiene el permiso que este módulo requiere.',
        fixPath: null,
      };
    }

    return {
      visible: true,
      blockedBy: null,
      detail: 'El módulo está disponible.',
      fixPath: null,
    };
  }

  /**
   * Same verdict, addressed by `panel_ui` key instead of by menu item.
   *
   * When `menuItems` is supplied the real item is located in the tree so the
   * item-level layers (fiscal scope/area, operating scope, subscription) are
   * evaluated too. Without it only the key-driven layers run — enough for
   * "¿por qué no veo Inventario?", not enough for a fiscal module, so the
   * caller should pass the tree whenever it has one.
   */
  diagnoseModule(
    moduleKey: string,
    menuItems?: MenuItem[],
  ): ModuleVisibilityDiagnosis {
    const item = menuItems ? this.findItemByModuleKey(menuItems, moduleKey) : null;
    if (item) return this.diagnose(item);

    const catalogEntry = STORE_MODULE_BY_KEY[moduleKey];
    return this.diagnose({
      label: catalogEntry?.label ?? moduleKey,
      route: catalogEntry?.route,
      icon: '',
    } as MenuItem);
  }

  /**
   * The two authorization prefilters as a boolean pair. Shared by the
   * observable pass (`filterMenuItems`) and the synchronous one (`diagnose`).
   */
  private passesAuthorizationGates(item: MenuItem): boolean {
    if (item.route === '/admin/dashboard' && !this.canAccessDashboard()) {
      return false;
    }
    if (item.route === '/admin/settings/users' && !this.canManageUsers()) {
      return false;
    }
    // `null` means "not hydrated yet". Hiding on unknown is the pre-existing
    // behavior (the layout's signal defaulted to `false`) and is the right
    // default: better a late-appearing entry than an empty mailbox flashing at
    // a brand-new store.
    if (item.route === '/admin/pqrs' && this.storeHasPqrs() !== true) {
      return false;
    }
    if (item.route === '/admin/scheduled-orders' && !this.scheduledOrdersEnabled()) {
      return false;
    }
    if (item.route === '/admin/settings/ai-agents' && !this.canConfigureAiAgents()) {
      return false;
    }
    if (item.route === '/admin/customers/inbox' && !this.canReadCrmInbox()) {
      return false;
    }
    if (item.route === '/admin/customers/pipeline' && !this.canUseCrm('store:crm_pipeline:read')) {
      return false;
    }
    if (item.route === '/admin/customers/tasks' && !this.canUseCrm('store:crm_tasks:manage')) {
      return false;
    }
    if (item.route === '/admin/customers/segments' && !this.canUseCrm('store:customers:read')) {
      return false;
    }
    if (item.route === APPS_CATALOG_ROUTE && !this.canOpenAppsCatalog()) {
      return false;
    }
    if (item.route && !this.canOpenAdministrationRoute(item.route)) {
      return false;
    }
    return true;
  }

  /**
   * P5.7: `true` unless `route` is a Flujos/Documentos child whose permission
   * the user lacks (`ADMINISTRATION_PERMISSION_ROUTES`). The owner passes.
   */
  private canOpenAdministrationRoute(route: string): boolean {
    const permissions = ADMINISTRATION_PERMISSION_ROUTES[route];
    if (!permissions || this.authFacade.isOwner()) return true;
    return permissions.some((permission) => this.authFacade.hasPermission(permission));
  }

  /**
   * P5.7: why a Flujos/Documentos child URL is closed to the user by
   * permission, or `null` when it is not one of those routes or the user may
   * open it. The URL guard shows the reason and leaves the user on an active
   * module, the same treatment as a module switched off in panel_ui.
   */
  administrationPermissionBlockForUrl(url: string): ModuleVisibilityDiagnosis | null {
    const clean = (url.split('?')[0].split('#')[0] || '/').replace(/\/+$/, '') || '/';
    if (this.canOpenAdministrationRoute(clean)) return null;
    return {
      visible: false,
      blockedBy: 'permission',
      detail:
        'Tu usuario no tiene el permiso que esta sección requiere. Si crees que deberías tenerlo, pídele a tu administrador que lo active en tu rol.',
      fixPath: null,
    };
  }

  /** Depth-first lookup of the menu item whose label maps to `moduleKey`. */
  findItemByModuleKey(items: MenuItem[], moduleKey: string): MenuItem | null {
    for (const item of items) {
      if (this.moduleKeysFor(item).includes(moduleKey)) return item;
      if (item.children?.length) {
        const found = this.findItemByModuleKey(item.children, moduleKey);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Árbol de menú actual (layout real si ya se montó, o el reconstruido del
   * catálogo). Usado por `panelUiGuard`, `storeDashboardGuard` y el redirect
   * de B.1, que corren antes de que el layout se monte — por eso el default
   * es el catálogo y no un array vacío.
   */
  currentMenuTree(): MenuItem[] {
    return this.menuTree ?? this.catalogMenuTree();
  }

  /** El layout registra su árbol real (con ítems audit-only, badges, etc.). */
  registerMenuTree(items: MenuItem[]): void {
    this.menuTree = items;
  }

  /**
   * Reconstruye un árbol `MenuItem[]` desde `STORE_MODULE_CATALOG` (orden
   * top-down del catálogo), agrupando hijos por `parentKey`. Es el "orden del
   * módulo catalog" que B.1/QUI-740 pide explícitamente, y evita depender del
   * layout durante los guards.
   */
  private catalogMenuTree(): MenuItem[] {
    if (this.catalogTreeCache) return this.catalogTreeCache;
    const roots: MenuItem[] = [];
    const byKey = new Map<string, MenuItem>();

    for (const entry of STORE_MODULE_CATALOG) {
      // `panelUiKey` deja al filtro de panel_ui trabajar sobre este nodo
      // aunque venga del catálogo (cuyos labels no resuelven en
      // `moduleKeyMap`, el índice por label del sidebar). Sin esto, el
      // árbol crudo es infiltrable y un no-owner con cero módulos acaba en
      // la primera ruta del catálogo en vez del no-access (C1-b real).
      const node: MenuItem = {
        label: entry.label,
        icon: '',
        route: entry.route,
        panelUiKey: entry.key,
      };
      byKey.set(entry.key, node);
      if (entry.parentKey && byKey.has(entry.parentKey)) {
        const parent = byKey.get(entry.parentKey)!;
        (parent.children ??= []).push(node);
      } else {
        roots.push(node);
      }
    }

    this.catalogTreeCache = roots;
    return roots;
  }

  /**
   * Keys `panel_ui` que gobiernan una ruta. Índice inverso de `MODULE_ROUTES`
   * (ruta → keys); la ruta más específica (prefijo más largo) gana. Para
   * `/admin/orders/sales` devuelve `['orders', 'orders_sales']` (la específica
   * es la que decide el acceso, pero si el padre está oculto la hoja es
   * inalcanzable, así que ambas entran como gobernantes).
   */
  resolveKeysForRoute(path: string): string[] {
    const clean = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
    const index = (this.routeKeysIndexCache ??= this.buildRouteKeysIndex());

    let bestLength = -1;
    let bestKeys: string[] = [];
    for (const [route, keys] of Object.entries(index)) {
      const normalized = route.replace(/\/+$/, '');
      if (clean === normalized || clean.startsWith(`${normalized}/`)) {
        if (normalized.length > bestLength) {
          bestLength = normalized.length;
          bestKeys = keys;
        }
      }
    }
    return bestKeys;
  }

  /**
   * Keys that govern a route for the access gate (apps-f4 S3): the enforced
   * pre-F4 index plus `MODULE_GATE_ROUTES` for STORE_ADMIN, or
   * `ORG_MODULE_ROUTES` for ORG_ADMIN. Longest prefix wins, as in
   * `resolveKeysForRoute`, which keeps answering with the enforced index only.
   */
  resolveGateKeysForRoute(
    path: string,
    app: AccessGateApp = this.accessGate.currentApp(),
  ): string[] {
    const index =
      app === 'ORG_ADMIN'
        ? (this.orgRouteIndexCache ??= this.buildIndex(ORG_MODULE_ROUTES))
        : (this.gateRouteIndexCache ??= this.buildGateRouteIndex());
    return this.longestPrefixKeys(path, index);
  }

  private buildGateRouteIndex(): Record<string, string[]> {
    const index = this.buildIndex(MODULE_GATE_ROUTES);
    for (const [route, keys] of Object.entries(this.buildRouteKeysIndex())) {
      (index[route] ??= []).push(...keys.filter((key) => !index[route].includes(key)));
    }
    return index;
  }

  private buildIndex(routesByKey: Record<string, string[]>): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    for (const [key, routes] of Object.entries(routesByKey)) {
      for (const route of routes) (index[route] ??= []).push(key);
    }
    return index;
  }

  private longestPrefixKeys(
    path: string,
    index: Record<string, string[]>,
  ): string[] {
    const clean = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
    let bestLength = -1;
    let bestKeys: string[] = [];
    for (const [route, keys] of Object.entries(index)) {
      const normalized = route.replace(/\/+$/, '');
      if (clean === normalized || clean.startsWith(`${normalized}/`)) {
        if (normalized.length > bestLength) {
          bestLength = normalized.length;
          bestKeys = keys;
        }
      }
    }
    return bestKeys;
  }

  /**
   * The access gate, one key (apps-f4 S4):
   * `canSeeKey(key) = user(key) ∧ store(key) ∧ industryAllows(key)`.
   *
   * - user: the per-user `panel_ui` (opt-out keys honored). The owner passes,
   *   as today.
   * - store: STORE_ADMIN ceiling `store_settings.panel_ui.STORE_ADMIN` (plus the
   *   kitchen-mode setting); ORG_ADMIN ceiling
   *   `organization_settings.panel_ui.ORG_ADMIN` (S5). Only an explicit
   *   `false` denies until the F5 backfill. On a URL the owner passes it, as
   *   the pre-F4 guard did.
   * - industry: positive map `MODULE_INDUSTRIES` over the store industries, or
   *   the union of the organization stores in ORG_ADMIN (S6). The owner is NOT
   *   exempt from this layer.
   *
   * Pure verdict: it neither hides nor logs. `applyAccessGate` decides what a
   * surface does with it according to the mode.
   */
  canSeeKey(key: string, surface: AccessSurface = 'sidebar'): AccessVerdict {
    const app = this.accessGate.currentApp();
    const isOwner = this.authFacade.isOwner();
    const industries = this.gateIndustries(app);

    const user = isOwner || this.isUserModuleVisible(key);
    let store: boolean;
    if (app === 'ORG_ADMIN') {
      store = this.accessGate.orgPanelUi()?.[key] !== false;
    } else if (isOwner && surface === 'url') {
      store = true;
    } else {
      const settings = this.authFacade.storeSettings();
      const storePanel = settings?.panel_ui?.STORE_ADMIN as
        | Record<string, boolean>
        | undefined;
      store =
        storePanel?.[key] !== false &&
        !this.hiddenBySettings(settings).includes(key);
    }
    const industry = industryAllowsKey(key, industries);
    const plan = !this.planDeniesKey(key);

    const layer: AccessLayer | null = !user
      ? 'user'
      : !store
        ? app === 'ORG_ADMIN'
          ? 'org'
          : 'store'
        : !industry
          ? 'industry'
          : !plan
            ? 'plan'
            : null;
    return { allowed: layer === null, layer, industries };
  }

  /**
   * Applies the gate on one surface and returns whether it may show or open
   * the module. `legacyAllowed` is the pre-F4 verdict of that surface.
   *
   * - The gate never widens access: `legacyAllowed=false` stays `false`.
   * - Audit mode: returns `legacyAllowed` and records what the gate would hide
   *   or block (`would_hide` / `would_block`).
   * - Enforce mode (flag on for the store): additionally hides/blocks when the
   *   industry layer denies every key, owner included, and records `hidden` /
   *   `blocked`. User and store layers stay in audit until F5.
   */
  applyAccessGate(
    keys: string[],
    legacyAllowed: boolean,
    surface: AccessSurface,
    route?: string,
  ): boolean {
    if (!legacyAllowed || !keys.length) return legacyAllowed;
    const verdicts = keys.map((key) => ({ key, ...this.canSeeKey(key, surface) }));
    if (verdicts.some((verdict) => verdict.allowed)) return true;

    // Plan layer, own flag. It never hides: the sidebar and the Apps card keep
    // the module visible with a lock (`isPlanLocked`); a URL or a Vexi
    // navigation is refused only when the plan flag is on, and the caller
    // opens the module paywall (`planLockForKeys`).
    if (verdicts.every((verdict) => verdict.layer === 'plan')) {
      const enforcePlan = this.accessGate.planMode() === 'enforce';
      this.accessGate.report({
        key: verdicts[0].key,
        decision: enforcePlan ? 'blocked' : 'would_block',
        layer: 'plan',
        surface,
        ...(route ? { route } : {}),
      });
      const shows = surface === 'sidebar' || surface === 'apps_card';
      return shows || !enforcePlan;
    }

    const industryDenied = verdicts.every(
      (verdict) => !industryAllowsKey(verdict.key, verdict.industries),
    );
    // flujos-documental S1: modules born after the audit week (`flows`,
    // `documents`) enforce their industry rule whatever the gate mode. Like the
    // plan layer, the sidebar and the Apps card keep them visible with a lock
    // (`isIndustryLocked`); a URL or a Vexi navigation is blocked and the
    // caller opens the industry paywall. Every other key follows the mode.
    const alwaysEnforced =
      industryDenied &&
      verdicts.every((verdict) => isIndustryAlwaysEnforced(verdict.key));
    const block =
      industryDenied && (alwaysEnforced || this.accessGate.mode() === 'enforce');
    const reported = industryDenied
      ? verdicts[0]
      : (verdicts.find((verdict) => verdict.layer !== 'industry') ?? verdicts[0]);
    const hides = surface === 'sidebar' || surface === 'apps_card';
    // An always-enforced key stays visible with a lock on the sidebar and the
    // Apps card, so it is logged as `would_hide`, never as `hidden`.
    const decision: AccessDecision = block
      ? hides
        ? alwaysEnforced
          ? 'would_hide'
          : 'hidden'
        : 'blocked'
      : hides
        ? 'would_hide'
        : 'would_block';
    this.accessGate.report({
      key: reported.key,
      decision,
      layer: industryDenied ? 'industry' : (reported.layer ?? 'user'),
      surface,
      ...(route ? { route } : {}),
    });
    return !block || (alwaysEnforced && hides);
  }

  /**
   * True when an always-enforced module (`flows`, `documents`) is closed by the
   * store industries. The sidebar paints it with the same lock as a plan lock
   * (`_planLocked`) and the route gate opens the industry paywall.
   */
  isIndustryLocked(keys: string[]): boolean {
    if (!keys.length) return false;
    const industries = this.gateIndustries(this.accessGate.currentApp());
    return keys.every(
      (key) => isIndustryAlwaysEnforced(key) && !industryAllowsKey(key, industries),
    );
  }

  /** Lock painted on a sidebar item: plan lock or industry lock. */
  private isLockedForSidebar(keys: string[]): boolean {
    return this.isPlanLocked(keys) || this.isIndustryLocked(keys);
  }

  /** True when the plan in force does not include `key` (exempt keys never). */
  planDeniesKey(key: string): boolean {
    return this.accessGate.planBlocked().includes(key);
  }

  /**
   * Plan lock for a set of keys (an item, a route): only when the plan denies
   * EVERY key, as the other layers do. Independent of the mode: callers decide
   * with `isPlanLocked` / `accessGate.planMode()`.
   */
  planLockForKeys(keys: string[]): PlanLock | null {
    if (!keys.length || !keys.every((key) => this.planDeniesKey(key))) {
      return null;
    }
    const key = keys.find((k) => planModuleFamily(k)) ?? keys[0];
    const offers = [...(this.accessGate.planOffers()[key] ?? [])];
    const currentPlan = this.accessGate.currentPlan();
    const recommended =
      offers.find((offer) => offer.cycle === currentPlan?.cycle) ??
      offers[0] ??
      null;
    const params = new URLSearchParams();
    if (recommended) {
      params.set('plan', recommended.code);
      params.set('cycle', recommended.cycle);
    }
    params.set('from', key);
    return {
      key,
      family: planModuleFamily(key),
      currentPlan,
      offers,
      recommended,
      upgradeUrl: `${PLAN_CATALOG_ROUTE}?${params.toString()}`,
    };
  }

  planLockForRoute(route: string, app: AccessGateApp = this.accessGate.currentApp()): PlanLock | null {
    return this.planLockForKeys(this.resolveGateKeysForRoute(route, app));
  }

  /** Lock to paint on a menu item / card: plan denies all keys AND the flag is on. */
  isPlanLocked(keys: string[]): boolean {
    return (
      this.accessGate.planMode() === 'enforce' && this.planLockForKeys(keys) !== null
    );
  }

  /** Paywall family of a key, for copy outside the gate (e.g. plan catalog). */
  planFamilyName(key: string | null | undefined): string | null {
    if (!key) return null;
    return (
      PLAN_MODULE_FAMILIES.find((family) => family.keys.includes(key))?.name ?? null
    );
  }

  /** Gate on a route: resolves its keys and applies `applyAccessGate`. */
  applyRouteGate(
    route: string,
    legacyAllowed: boolean,
    surface: AccessSurface,
  ): boolean {
    return this.applyAccessGate(
      this.resolveGateKeysForRoute(route),
      legacyAllowed,
      surface,
      route,
    );
  }

  /**
   * «No disponible en tu industria» notice naming the real industries of the
   * module (the pre-F4 toast always said "construcción").
   */
  industryBlockMessage(keys: string[]): string {
    const rule = keys
      .map((key) => MODULE_INDUSTRIES[key])
      .find(
        (value): value is readonly ModuleIndustry[] =>
          value !== undefined && value !== 'all',
      );
    if (!rule) {
      return 'No disponible en tu industria.';
    }
    const labels = rule.map((industry) =>
      (INDUSTRY_METADATA[industry as StoreIndustry]?.label ?? industry).toLowerCase(),
    );
    const list =
      labels.length > 1
        ? `${labels.slice(0, -1).join(', ')} ${/^h?o/i.test(labels[labels.length - 1]) ? 'u' : 'o'} ${labels[labels.length - 1]}`
        : labels[0];
    return `No disponible en tu industria. Este módulo aplica solo a tiendas de ${list}.`;
  }

  /** Industries the gate evaluates: backend state first, then the session. */
  private gateIndustries(app: AccessGateApp): string[] {
    const loaded = this.accessGate.industries();
    if (loaded) return loaded;
    if (app === 'ORG_ADMIN') return [];
    const settings = this.authFacade.storeSettings();
    const fromSettings = settings?.general?.industries as string[] | undefined;
    if (fromSettings?.length) return fromSettings;
    const fromLogin = this.authFacade.userIndustries();
    return Array.isArray(fromLogin) ? fromLogin : [];
  }

  private buildRouteKeysIndex(): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    for (const [key, route] of Object.entries(MODULE_ROUTES)) {
      (index[route] ??= []).push(key);
    }
    for (const [key, routes] of Object.entries(MODULE_ROUTE_ALIASES)) {
      for (const route of routes) (index[route] ??= []).push(key);
    }
    return index;
  }

  /**
   * Primera ruta navegable de un módulo activo, en el orden del árbol/catálogo
   * recibido. Es el terminal de la cadena de fallback: nunca devuelve `null`.
   *
   * - Si hay un módulo activo → su primera ruta.
   * - Si NO hay módulos activos:
   *     - **owner** → `PANEL_UI_TERMINAL_ROUTE` (settings/general). El owner
   *       ve todo por bypass de `user_panel_ui`, así que este caso solo se da
   *       cuando ni siquiera la config global de panel del catálogo tiene
   *       rutas — rarísimo; igual se le da el terminal para no quedar en
   *       blanco.
   *     - **no-owner con cero módulos** → `PANEL_UI_NO_ACCESS_ROUTE`. Es el
   *       caso del bug C1(2): usuario que termina en `/admin/settings/general`
   *       sin tener nada activo, debiera ver "sin acceso" + cerrar sesión.
   *
   * A.4 la crea (ownership ADR-4); B.1 la consume en el `redirectTo` de
   * `store_admin.routes.ts`; `storeDashboardGuard` la usa para migrar su
   * `/admin/pos` hardcodeado.
   */
  firstActiveModuleRoute(modules: MenuItem[]): string {
    // QUI-XXX (c1-b): el árbol del catálogo ahora es filtrable (cada nodo
    // lleva `panelUiKey`), por lo que `[]` y `undefined` siguen el flujo
    // original de esta función: o el caller pasa el árbol y el filtro lo
    // despuja a cero, o el caller no pasa nada y caemos al catálogo —
    // que ahora pasa por el mismo filtro. El terminal correcto (NO_ACCESS
    // para no-owner, TERMINAL para owner) sale sin condicional nuevo.
    const tree = modules?.length ? modules : this.catalogMenuTree();
    const route = this.firstVisibleRoute(tree);
    if (route) return route;
    if (this.authFacade.isOwner()) return PANEL_UI_TERMINAL_ROUTE;
    return PANEL_UI_NO_ACCESS_ROUTE;
  }

  private firstVisibleRoute(items: MenuItem[]): string | null {
    for (const item of items) {
      if (
        item.fiscalReadFallback &&
        (!this.matchesFiscalScope(item, this.authFacade.fiscalScope()) ||
          !this.matchesFiscalArea(item, this.authFacade.activeFiscalAreas()))
      ) {
        // Never let an audit-only ORG invoicing item become the default
        // redirect to emission while its only eligible surface is reception.
        if (this.diagnose(item).visible) return item.fiscalReadFallback.route;
        continue;
      }
      if (item.accessAuditOnly) {
        // Ítem audit-only (antes `alwaysVisible`): se renderiza sin importar
        // panel_ui en modo auditoría (filter Case 1);
        // solo lo detienen los prefiltros de autorización y la suscripción.
        if (
          this.passesAuthorizationGates(item) &&
          (!item.requiresFeature ||
            this.subscriptionAccess.canUseAI(item.requiresFeature)())
        ) {
          if (item.route) return item.route;
          if (item.children?.length) {
            const child = this.firstVisibleRoute(item.children);
            if (child) return child;
          }
        }
      } else if (this.diagnose(item).visible) {
        // Un grupo sin ruta propia (header de grupo) cae a su primer hijo visible.
        if (item.route) return item.route;
        if (item.children?.length) {
          const child = this.firstVisibleRoute(item.children);
          if (child) return child;
        }
      }
    }
    return null;
  }

  /** Normalizes `moduleKeyMap`'s `string | string[] | undefined` to an array. */
  private moduleKeysFor(item: MenuItem): string[] {
    // apps-f4: `accessAuditOnly` items (the pre-F4 `alwaysVisible` ones) got
    // their real `panelUiKey` only for the audit gate. Every pre-F4 path
    // (item lookup by key, diagnose, fiscal fallback) keeps resolving them by
    // label, as before; otherwise `findItemByModuleKey('accounting')` would
    // land on a different item and change the URL guard verdict.
    if (item.accessAuditOnly) return this.labelKeysFor(item);
    // QUI-XXX (c1-b): los nodos del catálogo llevan `panelUiKey` y el
    // `moduleKeyMap` está indexado por label del sidebar. Si una clave
    // viene del catálogo, no del sidebar, usar el label devuelve `[]` y el
    // árbol se vuelve infiltrable. La clave explícita gana siempre.
    if (item.panelUiKey) return [item.panelUiKey];
    return this.labelKeysFor(item);
  }

  /** Keys the apps-f4 access gate evaluates: the explicit key wins. */
  private gateKeysFor(item: MenuItem): string[] {
    return item.panelUiKey ? [item.panelUiKey] : this.labelKeysFor(item);
  }

  private labelKeysFor(item: MenuItem): string[] {
    const mapped = this.moduleKeyMap[item.label];
    if (!mapped) return [];
    return Array.isArray(mapped) ? mapped : [mapped];
  }

  /** `store_settings.apps.enabled === true`; absent or anything else is off. */
  appsCatalogEnabled(): boolean {
    return (
      (this.authFacade.storeSettings() as { apps?: { enabled?: boolean } } | null)
        ?.apps?.enabled === true
    );
  }

  /**
   * Apps catalog: store switch on AND the API permission (`store:apps:read`,
   * owner always). With the switch off the entry never exists, not even as a
   * redirect target of `firstActiveModuleRoute`.
   */
  private canOpenAppsCatalog(): boolean {
    return (
      this.appsCatalogEnabled() &&
      (this.authFacade.hasPermission('store:apps:read') ||
        this.authFacade.isOwner())
    );
  }

  /** CRM pipeline / tasks: same permission as their API. */
  private canUseCrm(permission: string): boolean {
    return this.authFacade.hasPermission(permission) || this.authFacade.isOwner();
  }

  /** CRM inbox: same permission as its API (`store:crm_inbox:read`). */
  private canReadCrmInbox(): boolean {
    return (
      this.authFacade.hasPermission('store:crm_inbox:read') ||
      this.authFacade.isOwner()
    );
  }

  /**
   * Authorization of the logged-in user over the users module. Mirrors
   * `manageUsersGuard`; derived here from AuthFacade so `diagnose()` can
   * explain the "Usuarios" entry without the layout having to pass it in.
   */
  private canManageUsers(): boolean {
    return (
      this.authFacade.hasPermission('store:users:update') ||
      this.authFacade.isOwner() ||
      this.authFacade.isAdmin()
    );
  }

  /**
   * Authorization over the "Agentes IA" page. Mirrors `aiAgentsSettingsGuard`:
   * role-only and deliberately narrower than `canManageUsers`, because the
   * switches hand agents that write to the store's data to every user of the
   * store, not just to the person flipping them. No permission fallback on
   * purpose.
   */
  private canConfigureAiAgents(): boolean {
    return this.authFacade.isOwner() || this.authFacade.isAdmin();
  }

  /**
   * Authorization over the store dashboard. Mirrors `storeDashboardGuard`:
   * requires trusted roles (owner/admin/super_admin/STORE_OWNER/ORG_OWNER/manager)
   * or explicit permissions ('store:dashboard:view', 'store:analytics:read').
   */
  private canAccessDashboard(): boolean {
    return canUserAccessDashboard(this.authFacade);
  }
}
