import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';

/**
 * DefaultPanelUIService
 *
 * Servicio centralizado que proporciona configuraciones por defecto
 * para el panel UI de usuarios.
 *
 * @remarks
 * Este servicio lee configuraciones desde un template UNIFICADO (user_settings_default)
 * en la tabla default_templates, permitiendo editar las configuraciones desde el SuperAdmin.
 *
 * Arquitectura:
 * - Template unificado: user_settings_default contiene panel_ui para TODOS los app_types
 * - Cache: 5 minutos TTL para mejorar rendimiento
 * - Fallback: Configuraciones hardcoded si DB falla
 *
 * Nota: El campo 'app' ya NO se incluye en el retorno porque ahora es un campo
 * directo en user_settings (app_type), no dentro de config.
 */
@Injectable()
export class DefaultPanelUIService {
  /**
   * Cache para almacenar la configuración completa del template unificado
   */
  private templateCache: {
    data: any;
    expiry: number;
  } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  /**
   * Nombre del template unificado en la base de datos
   */
  private readonly UNIFIED_TEMPLATE_NAME = 'user_settings_default';

  /**
   * Configuraciones de panel UI por tipo de aplicación (FALLBACK)
   * Estas configuraciones se usan solo si la base de datos falla.
   */
  private readonly PANEL_UI_FALLBACK: Record<string, Record<string, boolean>> =
    {
      ORG_ADMIN: {
        dashboard: true,
        stores: true,
        users: true,
        domains: true,
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
      STORE_ADMIN: {
        dashboard: true,
        pos: true,
        products: true,
        ecommerce: true,
        orders: true,
        orders_sales: true,
        orders_purchase_orders: true,
        inventory: true,
        inventory_pop: true,
        inventory_adjustments: true,
        inventory_locations: true,
        inventory_suppliers: true,
        customers: true,
        customers_all: true,
        customers_reviews: true,
        marketing: true,
        marketing_promotions: true,
        marketing_coupons: true,
        analytics: true,
        analytics_sales: true,
        analytics_traffic: true,
        analytics_performance: true,
        expenses: true,
        expenses_overview: true,
        expenses_all: true,
        expenses_create: true,
        expenses_categories: true,
        expenses_reports: true,
        settings: true,
        settings_general: true,
        settings_payments: true,
        settings_appearance: true,
        settings_security: true,
        settings_domains: true,
        settings_shipping: true,
        settings_legal_documents: true,
      },
      STORE_ECOMMERCE: {
        profile: true,
        history: true,
        dashboard: true,
        favorites: true,
        orders: true,
        settings: true,
      },
      VENDIX_LANDING: {},
    };

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Obtiene el template unificado desde la base de datos (con cache)
   */
  private async getUnifiedTemplate(): Promise<{
    panel_ui: Record<string, Record<string, boolean>>;
    preferences: Record<string, any>;
  }> {
    // Check cache
    if (this.templateCache && Date.now() < this.templateCache.expiry) {
      return this.templateCache.data;
    }

    try {
      const template = await this.prisma.default_templates.findFirst({
        where: {
          template_name: this.UNIFIED_TEMPLATE_NAME,
          configuration_type: 'user_settings',
          is_active: true,
          is_system: true,
        },
      });

      const templateData = template?.template_data as any;
      if (templateData?.panel_ui) {
        const result = {
          panel_ui: templateData.panel_ui,
          preferences: templateData.preferences || {
            language: 'es',
            theme: 'default',
          },
        };

        // Cache the result
        this.templateCache = {
          data: result,
          expiry: Date.now() + this.CACHE_TTL,
        };

        return result;
      }
    } catch (error: any) {
      console.warn(
        `Failed to load unified template from DB:`,
        error.message,
      );
    }

    // Fallback to hardcoded configs
    return {
      panel_ui: this.PANEL_UI_FALLBACK,
      preferences: {
        language: 'es',
        theme: 'default',
      },
    };
  }

  /**
   * Genera la configuración completa de usuario para un tipo de aplicación
   *
   * @param _app_type - Tipo de aplicación (ignorado, se retorna todo el panel_ui)
   * @returns Objeto con panel_ui completo para TODOS los app_types y preferencias
   *
   * @remarks
   * El parámetro app_type se mantiene por compatibilidad pero ya no se usa para filtrar.
   * Ahora siempre retornamos el panel_ui completo con todos los app_types.
   *
   * El campo 'app' ya NO se incluye porque ahora es un campo directo
   * en user_settings (app_type), no dentro de config.
   *
   * Formato de retorno:
   * {
   *   panel_ui: {
   *     ORG_ADMIN: { dashboard: true, ... },
   *     STORE_ADMIN: { ... },
   *     STORE_ECOMMERCE: { ... },
   *     VENDIX_LANDING: {}
   *   },
   *   preferences: {
   *     language: 'es',
   *     theme: 'default'
   *   }
   * }
   */
  async generatePanelUI(_app_type: string): Promise<{
    panel_ui: Record<string, Record<string, boolean>>;
    preferences?: Record<string, any>;
  }> {
    const template = await this.getUnifiedTemplate();

    return {
      panel_ui: template.panel_ui,
      preferences: template.preferences,
    };
  }

  /**
   * Genera la configuración de panel UI para múltiples tipos de aplicación
   *
   * @param _app_types - Array de tipos de aplicación (ignorado, se retorna todo)
   * @param _primary_app - App type principal (ignorado)
   * @returns Objeto con panel_ui completo y preferencias
   *
   * @remarks
   * Este método ahora es equivalente a generatePanelUI ya que siempre
   * retornamos el panel_ui completo con todos los app_types.
   */
  async generatePanelUIMulti(
    _app_types: string[],
    _primary_app?: string,
  ): Promise<{
    panel_ui: Record<string, Record<string, boolean>>;
    preferences?: Record<string, any>;
  }> {
    return this.generatePanelUI('');
  }

  /**
   * Invalida el cache de configuraciones
   *
   * @remarks
   * Este método debe llamarse cuando se actualiza el template en la base de datos
   * para asegurar que la próxima lectura obtenga la configuración actualizada.
   */
  invalidateCache(): void {
    this.templateCache = null;
  }

  /**
   * Verifica si un tipo de aplicación es válido
   *
   * @param app_type - Tipo de aplicación a verificar
   * @returns true si el tipo de aplicación existe en las configuraciones
   */
  isValidAppType(app_type: string): boolean {
    return app_type in this.PANEL_UI_FALLBACK;
  }

  /**
   * Obtiene todos los tipos de aplicación disponibles
   *
   * @returns Array con todos los tipos de aplicación soportados
   */
  getAvailableAppTypes(): string[] {
    return Object.keys(this.PANEL_UI_FALLBACK);
  }
}
