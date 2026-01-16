import { Injectable } from '@nestjs/common';

/**
 * DefaultPanelUIService
 *
 * Servicio centralizado que proporciona configuraciones por defecto
 * para el panel UI de usuarios según su tipo de aplicación.
 *
 * @remarks
 * Este servidor es la única fuente de verdad (SSOT) para todas las
 * configuraciones de panel_ui en el sistema. Elimina la duplicación
 * de código y asegura consistencia entre frontend y backend.
 */
@Injectable()
export class DefaultPanelUIService {
  /**
   * Configuraciones de panel UI por tipo de aplicación
   * Todas las variables usan snake_case según las convenciones del proyecto
   */
  private readonly PANEL_UI_CONFIGS = {
    /**
     * ORG_ADMIN - Administración de Organización
     * 11 módulos principales todos habilitados por defecto
     */
    ORG_ADMIN: {
      dashboard: true,
      stores: true,
      users: true,
      audit: true,
      settings: true,
      analytics: true,
      reports: true,
      inventory: true,
      billing: true,
      ecommerce: true,
      orders: true,
    },

    /**
     * STORE_ADMIN - Administración de Tienda
     * 30+ módulos incluyendo submódulos, todos habilitados por defecto
     */
    STORE_ADMIN: {
      // Módulos principales
      dashboard: true,
      pos: true,
      products: true,
      ecommerce: true,

      // Órdenes
      orders: true,
      orders_sales: true,
      orders_purchase_orders: true,

      // Inventario
      inventory: true,
      inventory_pop: true,
      inventory_adjustments: true,
      inventory_locations: true,
      inventory_suppliers: true,

      // Clientes
      customers: true,
      customers_all: true,
      customers_reviews: true,

      // Marketing
      marketing: true,
      marketing_promotions: true,
      marketing_coupons: true,

      // Analíticas
      analytics: true,
      analytics_sales: true,
      analytics_traffic: true,
      analytics_performance: true,

      // Configuración
      settings: true,
      settings_general: true,
      settings_payments: true,
      settings_appearance: true,
      settings_security: true,
      settings_domains: true,
    },

    /**
     * STORE_ECOMMERCE - Cliente de E-commerce
     * Módulos para clientes de tienda online
     */
    STORE_ECOMMERCE: {
      profile: true,
      history: true,
      dashboard: true,
      favorites: true,
      orders: true,
      settings: true,
    },

    /**
     * VENDIX_LANDING - Landing Page
     * Sin configuración de panel UI (clientes de landing no necesitan panel)
     */
    VENDIX_LANDING: {} as Record<string, boolean>,
  };

  /**
   * Obtiene la configuración de panel UI para un tipo de aplicación
   *
   * @param app_type - Tipo de aplicación (ORG_ADMIN, STORE_ADMIN, etc.)
   * @returns Objeto con la configuración de módulos del panel UI
   */
  getDefaultPanelUI(app_type: string): Record<string, boolean> {
    return this.PANEL_UI_CONFIGS[app_type as keyof typeof this.PANEL_UI_CONFIGS] || {};
  }

  /**
   * Genera la configuración completa de usuario para un tipo de aplicación
   *
   * @param app_type - Tipo de aplicación
   * @returns Objeto con app y panel_ui listo para guardar en user_settings
   */
  generatePanelUI(app_type: string): { app: string; panel_ui: Record<string, boolean> } {
    return {
      app: app_type,
      panel_ui: this.getDefaultPanelUI(app_type),
    };
  }

  /**
   * Verifica si un tipo de aplicación es válido
   *
   * @param app_type - Tipo de aplicación a verificar
   * @returns true si el tipo de aplicación existe en las configuraciones
   */
  isValidAppType(app_type: string): boolean {
    return app_type in this.PANEL_UI_CONFIGS;
  }

  /**
   * Obtiene todos los tipos de aplicación disponibles
   *
   * @returns Array con todos los tipos de aplicación soportados
   */
  getAvailableAppTypes(): string[] {
    return Object.keys(this.PANEL_UI_CONFIGS);
  }
}
