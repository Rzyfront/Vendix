import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthFacade } from '../store/auth/auth.facade';
import { MenuItem } from '../../shared/components/sidebar/sidebar.component';

/**
 * Service for filtering menu items based on panel_ui configuration.
 * Provides both observable and synchronous filtering methods.
 */
@Injectable({
  providedIn: 'root',
})
export class MenuFilterService {
  private authFacade = inject(AuthFacade);

  /**
   * Mapping between menu item labels and panel_ui module keys.
   * This maps the Spanish menu labels to the English module keys stored in panel_ui.
   * Includes both parent modules and individual sub-modules.
   *
   * Note: "Configuración" maps to "settings" and is shared by both ORG_ADMIN and STORE_ADMIN.
   */
  private moduleKeyMap: Record<string, string> = {
    // ORG_ADMIN mappings (módulos principales)
    'Panel Principal': 'dashboard',
    Tiendas: 'stores',
    Usuarios: 'users',
    'Auditoría y Cumplimiento': 'audit',

    // STORE_ADMIN - Módulos principales (sin hijos)
    'Punto de Venta': 'pos',
    Productos: 'products',
    'E-commerce': 'ecommerce',

    // STORE_ADMIN - Órdenes (padre + submódulos)
    Órdenes: 'orders',
    'Ordenes de Venta': 'orders_sales',
    'Ordenes de Compra': 'orders_purchase_orders',

    // STORE_ADMIN - Inventario (padre + submódulos)
    Inventario: 'inventory',
    'Punto de Compra': 'inventory_pop',
    'Ajustes de Stock': 'inventory_adjustments',
    Ubicaciones: 'inventory_locations',
    Proveedores: 'inventory_suppliers',

    // STORE_ADMIN - Clientes (padre + submódulos)
    Clientes: 'customers',
    'Todos los Clientes': 'customers_all',
    Reseñas: 'customers_reviews',

    // STORE_ADMIN - Marketing (padre + submódulos)
    Marketing: 'marketing',
    Promociones: 'marketing_promotions',
    Cupones: 'marketing_coupons',

    // STORE_ADMIN - Analíticas (padre + submódulos)
    Analíticas: 'analytics',
    Ventas: 'analytics_sales',
    Tráfico: 'analytics_traffic',
    Rendimiento: 'analytics_performance',

    // Configuración (compartido por ORG_ADMIN y STORE_ADMIN)
    // El padre "Configuración" y sus sub-items:
    Configuración: 'settings',
    General: 'settings_general',
    'Métodos de Pago': 'settings_payments',
    Apariencia: 'settings_appearance',
    Seguridad: 'settings_security',
    Dominios: 'settings_domains',
    Envíos: 'settings_shipping',
  };

  /**
   * Filter menu items based on panel_ui configuration.
   * Returns an Observable that emits filtered menu items.
   *
   * @param menuItems - All available menu items
   * @returns Observable of filtered menu items
   */
  filterMenuItems(menuItems: MenuItem[]): Observable<MenuItem[]> {
    return this.authFacade.getVisibleModules$().pipe(
      map((visibleModules) =>
        this.filterItemsRecursive(menuItems, visibleModules),
      ),
    );
  }

  /**
   * Recursively filter menu items based on visible modules.
   * Handles nested children (submenus) and preserves structure.
   * Items marked with alwaysVisible are always shown if their parent is visible.
   *
   * @param items - Menu items to filter
   * @param visibleModules - Array of visible module keys
   * @returns Filtered menu items
   */
  private filterItemsRecursive(
    items: MenuItem[],
    visibleModules: string[],
  ): MenuItem[] {
    return items.reduce((filtered: MenuItem[], item) => {
      // Case 1: Item marked as alwaysVisible (skip panel_ui filtering)
      // Used for dynamic data like stores that should always show if parent is visible
      if (item.alwaysVisible) {
        const alwaysVisibleItem = { ...item };

        // If it has children, recursively filter them (children can also be alwaysVisible)
        if (item.children && item.children.length > 0) {
          alwaysVisibleItem.children = this.filterItemsRecursive(
            item.children,
            visibleModules,
          );
        }

        filtered.push(alwaysVisibleItem);
        return filtered;
      }

      // Case 2: Item has a module key mapping (filter by panel_ui)
      const moduleKey = this.moduleKeyMap[item.label];
      if (moduleKey) {
        // Only include if this specific module is visible
        if (visibleModules.includes(moduleKey)) {
          const filteredItem = { ...item };

          // Recursively filter children if present
          if (item.children && item.children.length > 0) {
            filteredItem.children = this.filterItemsRecursive(
              item.children,
              visibleModules,
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
        );

        if (filteredChildren.length > 0) {
          const filteredItem = { ...item, children: filteredChildren };
          filtered.push(filteredItem);
        }
      }

      return filtered;
    }, []);
  }

  /**
   * Check if a specific menu item should be visible.
   * Synchronous version for immediate checks.
   *
   * @param menuItem - Menu item to check
   * @returns true if visible, false otherwise
   */
  isMenuItemVisible(menuItem: MenuItem): boolean {
    const moduleKey = this.moduleKeyMap[menuItem.label];
    if (!moduleKey) return true; // Default to visible if no mapping
    return this.authFacade.isModuleVisible(moduleKey);
  }
}
