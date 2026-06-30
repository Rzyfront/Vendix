import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { SubscriptionAccessService } from './subscription-access.service';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';
import { getModulesHiddenByIndustries } from '../../shared/constants/industry-modules.constant';
import type {
  OrganizationOperatingScope,
  OrganizationFiscalScope,
} from '../models/organization.model';
import type { FiscalArea } from '../models/fiscal-status.model';

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
    Adelantos: 'payroll_advances',

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
    return combineLatest([
      this.authFacade.getVisibleModules$(),
      this.authFacade.userStoreType$,
      this.authFacade.userIndustries$,
      this.authFacade.storeSettings$,
      this.authFacade.userOrganization$,
      this.authFacade.activeFiscalAreas$,
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
   * @param menuItem - Menu item to check
   * @returns true if visible, false otherwise
   */
  isMenuItemVisible(menuItem: MenuItem): boolean {
    // Fiscal guards short-circuit visibility (hide outright when the app does
    // not own the fiscal_scope, or when the required fiscal area is not active).
    if (!this.matchesFiscalScope(menuItem, this.authFacade.fiscalScope())) {
      return false;
    }
    if (
      !this.matchesFiscalArea(menuItem, this.authFacade.activeFiscalAreas())
    ) {
      return false;
    }

    // Operating scope guard short-circuits visibility:
    //   - if scope mismatches and showLocked is true, the item still renders
    //     (in locked state) so this method must report it as visible.
    //   - if scope mismatches and showLocked is falsy, the item is hidden.
    const scopeOutcome = this.resolveScopeOutcome(
      menuItem,
      this.authFacade.operatingScope(),
    );
    if (scopeOutcome === 'hide') {
      return false;
    }

    const moduleKey = this.moduleKeyMap[menuItem.label];
    let isVisible = true;
    if (!moduleKey) {
      isVisible = true;
    } else if (Array.isArray(moduleKey)) {
      isVisible = moduleKey.some((key) => this.authFacade.isModuleVisible(key));
    } else {
      isVisible = this.authFacade.isModuleVisible(moduleKey);
    }

    if (isVisible && menuItem.requiresFeature) {
      isVisible = this.subscriptionAccess.canUseAI(menuItem.requiresFeature)();
    }

    return isVisible;
  }
}
