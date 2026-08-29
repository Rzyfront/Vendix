import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { SubscriptionAccessService } from './subscription-access.service';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';
import { getModulesHiddenByIndustries } from '../../shared/constants/industry-modules.constant';
import {
  MODULE_ROUTES,
  STORE_MODULE_BY_KEY,
  STORE_MODULE_CATALOG,
} from '../../shared/constants/store-module-catalog.constant';
import type {
  OrganizationOperatingScope,
  OrganizationFiscalScope,
} from '../models/organization.model';
import type { FiscalArea } from '../models/fiscal-status.model';

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
 * Service for filtering menu items based on panel_ui configuration.
 * Provides both observable and synchronous filtering methods.
 */
@Injectable({
  providedIn: 'root',
})
export class MenuFilterService {
  private authFacade = inject(AuthFacade);
  private subscriptionAccess = inject(SubscriptionAccessService);

  /**
   * True when the current store has at least one PQR. The store-admin layout
   * hydrates this from the PQR stats endpoint; the service cannot fetch it
   * itself, so it stays `null` (= unknown) until told. `diagnose()` refuses to
   * blame this layer while unknown rather than assert a reason it cannot back.
   */
  readonly storeHasPqrs = signal<boolean | null>(null);

  /**
   * Árbol de menú del store-admin. Por defecto se reconstruye del catálogo
   * (`STORE_MODULE_CATALOG`) para que el guard y el redirect de B.1 funcionen
   * ANTES de que el layout se monte (los guards corren antes de la creación de
   * componentes). El layout lo sobreescribe con su árbol real (con
   * `alwaysVisible`, badges, etc.) al montarse vía `registerMenuTree`.
   */
  private menuTree: MenuItem[] | null = null;

  /** Caché del árbol reconstruido del catálogo. */
  private catalogTreeCache: MenuItem[] | null = null;

  /** Caché del índice ruta → keys panel_ui. */
  private routeKeysIndexCache: Record<string, string[]> | null = null;

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
        `${this.canManageUsers()}|${this.storeHasPqrs()}|${this.canConfigureVexi()}`,
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
    'Tienda en línea': 'ecommerce',

    // STORE_ADMIN - Órdenes (padre + submódulos)
    Órdenes: 'orders',
    'Ordenes de Venta': 'orders_sales',
    'Ordenes de Compra': 'orders_purchase_orders',
    Cotizaciones: 'orders_quotations',
    'Plan Separe': 'orders_layaway',
    Reservas: 'orders_reservations',

    // STORE_ADMIN - Despacho (padre + submódulos)
    Despacho: 'dispatch',
    Remisiones: 'orders_dispatch_notes',
    'Planillas de Ruta': 'orders_dispatch_routes',
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

    // STORE_ADMIN - Marketing (padre + submódulos)
    Marketing: 'marketing',
    Promociones: 'marketing_promotions',
    Cupones: 'marketing_coupons',
    Anuncios: 'marketing_anuncios',
    'Social Sales': 'marketing_social_sales',

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

    // Memberships (Membership Suite) — padre + 3 submódulos. El padre
    // "Zona Fit" mapea al key padre para que el sidebar renderice el grupo
    // cuando la industria (gym o service) lo permita; cada submódulo se mapea a
    // su propia key para que "Módulos del Panel" pueda prender/apagar
    // granularmente.
    'Zona Fit': 'memberships',
    Planes: 'memberships_plans',
    Miembros: 'memberships_members',
    Accesos: 'memberships_access',

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
  };

  /**
   * Filter menu items based on panel_ui configuration.
   * Returns an Observable that emits filtered menu items.
   *
   * @param menuItems - All available menu items
   * @returns Observable of filtered menu items
   */
  filterMenuItems(menuItems: MenuItem[]): Observable<MenuItem[]> {
    // Register the tree so `currentMenuTree()`/`firstActiveModuleRoute()`
    // reflect the real sidebar (with alwaysVisible/badges) once mounted.
    this.menuTree = menuItems;
    return combineLatest([
      this.authFacade.getVisibleModules$(),
      this.authFacade.userStoreType$,
      this.authFacade.userIndustries$,
      this.authFacade.storeSettings$,
      this.authFacade.userOrganization$,
      this.authFacade.activeFiscalAreas$,
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

          // Layer 3: user panel UI (the existing per-user `panel_ui` map — comes in
          // as `visibleModules` from `getVisibleModules$()` — already merged with
          // defaults and the active app_type).

          // Layer 4: store_type (modality) — physical/popup/kiosko hide ecommerce,
          // online hides POS / cash registers, hybrid shows everything.
          // Prefer store_settings.general.store_type (updated on save) over user.store.store_type
          // (login snapshot).
          const storeType = storeSettings?.general?.store_type || loginStoreType;
          const hiddenByStoreType =
            this.storeTypeHiddenModules[storeType || ''] || [];

          // Layers 5+6 (operating scope / fiscal scope / fiscal area / subscription)
          // run inside filterItemsRecursive below.
          const effectiveModules = visibleModules.filter(
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
          );
        },
      ),
    );
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
    if (!item.requiresFiscalArea) return true;
    if (item.requiresFiscalArea === 'any') return activeFiscalAreas.length > 0;
    return activeFiscalAreas.includes(item.requiresFiscalArea);
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
   * Items marked with alwaysVisible are always shown if their parent is visible.
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
  ): MenuItem[] {
    return items.reduce((filtered: MenuItem[], item) => {
      // Authorization prefilters, absorbed from the store-admin layout: two
      // entries that carry no panel_ui key and were previously removed from
      // the tree by the caller.
      if (!this.passesAuthorizationGates(item)) {
        return filtered;
      }
      // Fiscal scope guard: the app that does not own the fiscal_scope must not
      // render fiscal items at all (hide outright, no locked state).
      if (!this.matchesFiscalScope(item, fiscalScope)) {
        return filtered;
      }
      // Fiscal activation guard: operational fiscal modules stay hidden until
      // their area is ACTIVE/LOCKED. The activation entry (no requiresFiscalArea)
      // is always allowed so the owner can activate.
      if (!this.matchesFiscalArea(item, activeFiscalAreas)) {
        return filtered;
      }

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

      // Case 1: Item marked as alwaysVisible (skip panel_ui filtering)
      // Used for dynamic data like stores that should always show if parent is visible
      if (item.alwaysVisible) {
        if (
          item.requiresFeature &&
          !this.subscriptionAccess.canUseAI(item.requiresFeature)()
        ) {
          return filtered;
        }
        const alwaysVisibleItem: MenuItem = { ...item, _locked: locked };

        // If it has children, recursively filter them (children can also be alwaysVisible)
        if (item.children && item.children.length > 0) {
          alwaysVisibleItem.children = this.filterItemsRecursive(
            item.children,
            visibleModules,
            operatingScope,
            fiscalScope,
            activeFiscalAreas,
          );
        }

        filtered.push(alwaysVisibleItem);
        return filtered;
      }

      // Case 2: Item has a module key mapping (filter by panel_ui)
      const moduleKey = this.moduleKeyMap[item.label];
      if (moduleKey) {
        // Only include if this specific module (or any key in array) is visible
        if (this.isModuleKeyVisible(moduleKey, visibleModules)) {
          if (
            item.requiresFeature &&
            !this.subscriptionAccess.canUseAI(item.requiresFeature)()
          ) {
            return filtered;
          }
          const filteredItem: MenuItem = { ...item, _locked: locked };

          // Recursively filter children if present
          if (item.children && item.children.length > 0) {
            filteredItem.children = this.filterItemsRecursive(
              item.children,
              visibleModules,
              operatingScope,
              fiscalScope,
              activeFiscalAreas,
            );
          }

          filtered.push(filteredItem);
        }
        // If moduleKey exists but is NOT in visibleModules, the item is hidden
      }
      // Case 3: Item without mapping and without alwaysVisible (defensive fallback)
      // Only include if it has visible children
      else if (item.children && item.children.length > 0) {
        const filteredChildren = this.filterItemsRecursive(
          item.children,
          visibleModules,
          operatingScope,
          fiscalScope,
          activeFiscalAreas,
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
      if (!moduleKeys.some((key) => this.authFacade.isModuleVisible(key))) {
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
    // These two entries carry no panel_ui key of their own, so the layout used
    // to strip them from the tree before filtering. Folding them in here keeps
    // the reason available instead of the item just vanishing.
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
    if (menuItem.route === '/admin/settings/vexi' && !this.canConfigureVexi()) {
      return {
        visible: false,
        blockedBy: 'permission',
        detail:
          'Solo el propietario o un administrador puede activar o desactivar a Vexi.',
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
    if (item.route === '/admin/settings/vexi' && !this.canConfigureVexi()) {
      return false;
    }
    return true;
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

  /** El layout registra su árbol real (con `alwaysVisible`, badges, etc.). */
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
      const node: MenuItem = { label: entry.label, icon: '', route: entry.route };
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

  private buildRouteKeysIndex(): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    for (const [key, route] of Object.entries(MODULE_ROUTES)) {
      (index[route] ??= []).push(key);
    }
    return index;
  }

  /**
   * Primera ruta navegable de un módulo activo, en el orden del árbol/catálogo
   * recibido. Es el terminal de la cadena de fallback: nunca devuelve `null`,
   * siempre aterriza en `PANEL_UI_TERMINAL_ROUTE` si nada está activo.
   *
   * A.4 la crea (ownership ADR-4); B.1 la consume en el `redirectTo` de
   * `store_admin.routes.ts`; `storeDashboardGuard` la usa para migrar su
   * `/admin/pos` hardcodeado.
   */
  firstActiveModuleRoute(modules: MenuItem[]): string {
    const tree = modules?.length ? modules : this.catalogMenuTree();
    const route = this.firstVisibleRoute(tree);
    return route ?? PANEL_UI_TERMINAL_ROUTE;
  }

  private firstVisibleRoute(items: MenuItem[]): string | null {
    for (const item of items) {
      if (item.alwaysVisible) {
        // alwaysVisible se renderiza sin importar panel_ui (filter Case 1);
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
    const mapped = this.moduleKeyMap[item.label];
    if (!mapped) return [];
    return Array.isArray(mapped) ? mapped : [mapped];
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
   * Authorization over the Vexi master switch. Mirrors `vexiSettingsGuard`:
   * role-only and deliberately narrower than `canManageUsers`, because the
   * switch withdraws the assistant from every user of the store, not just
   * from the person flipping it. No permission fallback on purpose.
   */
  private canConfigureVexi(): boolean {
    return this.authFacade.isOwner() || this.authFacade.isAdmin();
  }
}
