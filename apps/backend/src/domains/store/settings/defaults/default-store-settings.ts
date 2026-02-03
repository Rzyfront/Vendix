import { StoreSettings } from '../interfaces/store-settings.interface';

export function getDefaultStoreSettings(): StoreSettings {
  return {
    // ============================================================================
    // NUEVAS SECCIONES - Única fuente de verdad
    // ============================================================================

    // Branding completo (reemplaza domain.config.branding)
    branding: {
      name: 'Vendix',
      primary_color: '#7ED7A5',
      secondary_color: '#2F6F4E',
      accent_color: '#FFFFFF',
      background_color: '#F4F4F4',
      surface_color: '#FFFFFF',
      text_color: '#222222',
      text_secondary_color: '#666666',
      text_muted_color: '#999999',
      logo_url: undefined,
      favicon_url: undefined,
      custom_css: undefined,
    },

    // Fonts
    fonts: {
      primary: 'Inter, sans-serif',
      secondary: 'Inter, sans-serif',
      headings: 'Inter, sans-serif',
    },

    // Publication settings
    publication: {
      store_published: false,
      ecommerce_enabled: false,
      landing_enabled: true,
      maintenance_mode: false,
      maintenance_message: undefined,
      allow_public_access: false,
    },

    // ============================================================================
    // SECCIONES EXISTENTES
    // ============================================================================

    general: {
      timezone: 'America/Bogota',
      currency: 'USD',
      language: 'es',
      tax_included: false,
    },
    inventory: {
      low_stock_threshold: 10,
      out_of_stock_action: 'hide',
      track_inventory: true,
      allow_negative_stock: false,
    },
    checkout: {
      require_customer_data: true,
      allow_guest_checkout: false,
      allow_partial_payments: false,
      require_payment_confirmation: true,
    },
    notifications: {
      email_enabled: true,
      sms_enabled: false,
      low_stock_alerts: true,
      new_order_alerts: true,
      low_stock_alerts_email: null,
      new_order_alerts_email: null,
      low_stock_alerts_phone: null,
      new_order_alerts_phone: null,
    },
    pos: {
      allow_anonymous_sales: false,
      anonymous_sales_as_default: false,
      business_hours: getDefaultBusinessHours(),
      offline_mode_enabled: false,
      require_cash_drawer_open: false,
      auto_print_receipt: true,
      allow_price_edit: true,
      allow_discount: true,
      max_discount_percentage: 15,
      allow_refund_without_approval: false,
    },
    receipts: {
      print_receipt: true,
      email_receipt: false,
      receipt_header: '',
      receipt_footer: '¡Gracias por su compra!',
    },

    // Panel UI - Control de módulos disponibles a nivel de tienda
    // Todos los módulos habilitados por defecto
    panel_ui: {
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
    },

    // Legacy: Mantener por compatibilidad (redundante con branding)
    app: {
      name: 'Vendix',
      primary_color: '#7ED7A5',
      secondary_color: '#2F6F4E',
      accent_color: '#FFFFFF',
      theme: 'default',
    },
  };
}





function getDefaultBusinessHours(): Record<
  string,
  { open: string; close: string }
> {
  return {
    monday: { open: '09:00', close: '19:00' },
    tuesday: { open: '09:00', close: '19:00' },
    wednesday: { open: '09:00', close: '19:00' },
    thursday: { open: '09:00', close: '19:00' },
    friday: { open: '09:00', close: '20:00' },
    saturday: { open: '10:00', close: '18:00' },
    sunday: { open: '11:00', close: '16:00' },
  };
}
