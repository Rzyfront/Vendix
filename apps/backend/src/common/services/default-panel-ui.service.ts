import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

/**
 * DefaultPanelUIService
 *
 * Servicio centralizado que proporciona configuraciones por defecto
 * para el panel UI de usuarios según su tipo de aplicación.
 *
 * @remarks
 * Este servicio lee configuraciones desde la tabla default_templates en la base de datos,
 * permitiendo editar las configuraciones desde el SuperAdmin sin necesidad de redeploy.
 * Si la base de datos falla o no encuentra el template, usa configuraciones hardcoded como fallback.
 *
 * - Database-first: Lee de default_templates table
 * - Cache: 5 minutos TTL para mejorar rendimiento
 * - Fallback: Configuraciones hardcoded si DB falla
 * - Single Source of Truth: Templates en DB, código solo como fallback
 */
@Injectable()
export class DefaultPanelUIService {
  /**
   * Cache para almacenar configuraciones y reducir consultas a BD
   */
  private cache: Record<string, any> = {};
  private cacheExpiry: Record<string, number> = {};
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Configuraciones de panel UI por tipo de aplicación (FALLBACK)
   * Estas configuraciones se usan solo si la base de datos falla.
   *
   * Todas las variables usan snake_case según las convenciones del proyecto.
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
      expenses: true,
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

      // Gastos
      expenses: true,
      expenses_overview: true,
      expenses_all: true,
      expenses_create: true,
      expenses_categories: true,
      expenses_reports: true,

      // Configuración
      settings: true,
      settings_general: true,
      settings_payments: true,
      settings_appearance: true,
      settings_security: true,
      settings_domains: true,
      settings_shipping: true,
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
   * Mapeo de app_type a template_name en la base de datos
   */
  private readonly TEMPLATE_NAME_MAP: Record<string, string> = {
    ORG_ADMIN: 'user_settings_org_admin',
    STORE_ADMIN: 'user_settings_store_admin',
    STORE_ECOMMERCE: 'user_settings_ecommerce_customer',
    VENDIX_LANDING: 'user_settings_landing',
  };

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Obtiene la configuración de panel UI para un tipo de aplicación
   *
   * Strategy:
   * 1. Try cache first
   * 2. Try database (default_templates table)
   * 3. Fallback to hardcoded configs
   *
   * @param app_type - Tipo de aplicación (ORG_ADMIN, STORE_ADMIN, etc.)
   * @returns Objeto con la configuración de módulos del panel UI
   */
  private async getDefaultPanelUI(
    app_type: string,
  ): Promise<Record<string, boolean>> {
    // Try cache first
    const cacheKey = `user_settings_${app_type}`;
    if (this.cache[cacheKey] && Date.now() < this.cacheExpiry[cacheKey]) {
      return this.cache[cacheKey];
    }

    try {
      // Try database
      const templateName = this.TEMPLATE_NAME_MAP[app_type];

      if (!templateName) {
        throw new Error(`No template mapping found for app_type: ${app_type}`);
      }

      const template = await this.prisma.default_templates.findFirst({
        where: {
          template_name: templateName,
          configuration_type: 'user_settings',
          is_active: true,
        },
      });

      // Cast template_data to access nested properties safely
      const templateData = template?.template_data as any;
      if (templateData?.panel_ui?.[app_type]) {
        // Cache the result
        this.cache[cacheKey] = templateData.panel_ui[app_type];
        this.cacheExpiry[cacheKey] = Date.now() + this.CACHE_TTL;
        return templateData.panel_ui[app_type];
      }
    } catch (error: any) {
      console.warn(
        `Failed to load template for ${app_type} from DB:`,
        error.message,
      );
    }

    // Fallback to hardcoded configs
    return (
      this.PANEL_UI_CONFIGS[app_type as keyof typeof this.PANEL_UI_CONFIGS] ||
      {}
    );
  }

  /**
   * Genera la configuración completa de usuario para un tipo de aplicación
   *
   * @param app_type - Tipo de aplicación
   * @returns Objeto con app, panel_ui anidado por app type y preferencias listas para guardar en user_settings
   *
   * @remarks
   * Formato correcto:
   * {
   *   app: "ORG_ADMIN",                    // Entorno activo del usuario
   *   panel_ui: {                           // Configs de todos los entornos
   *     ORG_ADMIN: { dashboard: true, ... },
   *     STORE_ADMIN: { ... }                // Opcional: multi-app users
   *   },
   *   preferences: {                        // Opcional: preferencias del usuario
   *     language: 'es',
   *     theme: 'default'
   *   }
   * }
   *
   * La clave 'app' indica el entorno activo actual del usuario.
   * El objeto 'panel_ui' anidado permite soportar múltiples entornos por usuario.
   */
  async generatePanelUI(app_type: string): Promise<{
    app: string;
    panel_ui: Record<string, Record<string, boolean>>;
    preferences?: Record<string, any>;
  }> {
    const panelUI = await this.getDefaultPanelUI(app_type);

    const panel_ui_result: Record<string, Record<string, boolean>> = {
      [app_type]: panelUI,
    };

    // Special handling: ORG_ADMIN should also have STORE_ADMIN config by default
    if (app_type === 'ORG_ADMIN') {
      // Fetch STORE_ADMIN defaults (either from its own template or fallback)
      panel_ui_result['STORE_ADMIN'] =
        await this.getDefaultPanelUI('STORE_ADMIN');
    }

    return {
      app: app_type,
      panel_ui: panel_ui_result,
      preferences: {
        language: 'es',
        theme: 'default',
      },
    };
  }

  /**
   * Genera la configuración de panel UI para múltiples tipos de aplicación
   *
   * @param app_types - Array de tipos de aplicación (ej: ['ORG_ADMIN', 'STORE_ADMIN'])
   * @param primary_app - App type principal (default: first in array)
   * @returns Objeto con app, panel_ui anidado por app type y preferencias listo para guardar en user_settings
   *
   * @remarks
   * Use este método para usuarios que necesitan acceso a múltiples entornos
   * como owners o administradores que trabajan tanto a nivel de organización
   * como de tienda.
   *
   * El primary_app será el entorno activo inicial del usuario (clave 'app').
   */
  async generatePanelUIMulti(
    app_types: string[],
    primary_app?: string,
  ): Promise<{
    app: string;
    panel_ui: Record<string, Record<string, boolean>>;
    preferences?: Record<string, any>;
  }> {
    const panel_ui: Record<string, Record<string, boolean>> = {};

    for (const app_type of app_types) {
      panel_ui[app_type] = await this.getDefaultPanelUI(app_type);
    }

    return {
      app: primary_app || app_types[0],
      panel_ui,
      preferences: {
        language: 'es',
        theme: 'default',
      },
    };
  }

  /**
   * Invalida el cache de configuraciones
   *
   * @param app_type - Tipo de aplicación específico para invalidar, o undefined para invalidar todo
   *
   * @remarks
   * Este método debe llamarse cuando se actualiza un template en la base de datos
   * para asegurar que la próxima lectura obtenga la configuración actualizada.
   */
  invalidateCache(app_type?: string): void {
    if (app_type) {
      delete this.cache[`user_settings_${app_type}`];
      delete this.cacheExpiry[`user_settings_${app_type}`];
    } else {
      this.cache = {};
      this.cacheExpiry = {};
    }
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
