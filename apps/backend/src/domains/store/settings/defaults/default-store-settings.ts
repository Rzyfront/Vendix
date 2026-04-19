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
      currency: 'COP',
      language: 'es',
      tax_included: false,
    },
    inventory: {
      low_stock_threshold: 10,
      out_of_stock_action: 'hide',
      track_inventory: true,
      allow_negative_stock: false,
      costing_method: 'cpp',
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
      enable_schedule_validation: false,
      offline_mode_enabled: false,
      require_cash_drawer_open: false,
      auto_print_receipt: true,
      allow_price_edit: true,
      allow_discount: true,
      max_discount_percentage: 15,
      allow_refund_without_approval: false,
      scale: {
        enabled: false,
        allow_manual_weight_entry: true,
        default_weight_unit: 'kg',
        device: {
          baud_rate: 9600,
          data_bits: 8,
          stop_bits: 1,
          parity: 'none',
          protocol: 'generic',
        },
      },
      cash_register: {
        enabled: false,
        require_session_for_sales: false,
        allow_multiple_sessions_per_user: false,
        auto_create_default_register: true,
        require_closing_count: true,
        track_non_cash_payments: true,
      },
      customer_queue: {
        enabled: false,
        queue_expiry_hours: 12,
        max_queue_size: 0,
        require_email: false,
      },
      default_payment_form: 'contado',
      show_onscreen_keypad: true,
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
        orders_quotations: true,
        orders_layaway: true,
        orders_reservations: true,
        orders_dispatch_notes: true,

        // Inventario
        inventory: true,
        inventory_pop: true,
        inventory_adjustments: true,
        inventory_locations: true,
        inventory_suppliers: true,
        inventory_movements: true,

        // Clientes
        customers: true,
        customers_all: true,
        customers_reviews: true,
        customers_data_collection: true,

        // Marketing
        marketing: true,
        marketing_promotions: true,
        marketing_coupons: true,

        // Analíticas
        analytics: true,
        analytics_sales: true,
        analytics_traffic: true,
        analytics_performance: true,
        analytics_overview: true,
        analytics_inventory: true,
        analytics_products: true,
        analytics_customers: true,
        analytics_financial: true,

        // Reportes
        reports: true,

        // Gastos
        expenses: true,

        // Facturación
        invoicing: true,

        // Contabilidad
        accounting: true,
        accounting_journal_entries: true,
        accounting_fiscal_periods: true,
        accounting_chart_of_accounts: true,
        accounting_reports: true,
        accounting_account_mappings: true,
        accounting_flows_dashboard: true,
        cartera_dashboard: true,
        cartera_receivables: true,
        cartera_payables: true,
        cartera_aging: true,
        accounting_withholding_tax: true,
        accounting_exogenous: true,
        taxes_ica: true,

        // Nómina
        payroll: true,
        payroll_employees: true,
        payroll_runs: true,
        payroll_settlements: true,
        payroll_advances: true,
        payroll_settings: true,

        // Configuración
        settings: true,
        settings_general: true,
        settings_payments: true,
        settings_appearance: true,
        settings_security: true,
        settings_domains: true,
        settings_shipping: true,
        settings_legal_documents: true,
        settings_users: true,
        settings_roles: true,
        settings_cash_registers: true,

        // Ayuda
        help: true,
        help_support: true,
        help_center: true,
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

    // Accounting flows — controls which flows generate auto-entries
    accounting_flows: {
      invoicing: true,
      payments: true,
      expenses: true,
      payroll: true,
      credit_sales: true,
      inventory: true,
      returns: true,
      purchases: true,
      layaway: true,
      fixed_assets: true,
      withholding: true,
      settlements: true,
      wallet: true,
      cash_register: true,
      stock_transfers: true,
      commissions: true,
      ar_ap: true,
      installments: true,
    },

    // Module flows — master toggles for entire modules (disabled by default for new stores)
    module_flows: {
      accounting: {
        enabled: false,
        invoicing: true,
        payments: true,
        expenses: true,
        payroll: true,
        credit_sales: true,
        inventory: true,
        returns: true,
        purchases: true,
        layaway: true,
        fixed_assets: true,
        withholding: true,
        settlements: true,
        wallet: true,
        cash_register: true,
        stock_transfers: true,
        commissions: true,
        ar_ap: true,
        installments: true,
      },
      payroll: {
        enabled: false,
      },
      invoicing: {
        enabled: false,
      },
    },

    // Reservations - Booking reminders, confirmation, and check-in
    reservations: {
      reminders: [
        { time_before: '24h', channels: ['email', 'push'], enabled: true },
        { time_before: '1h', channels: ['push'], enabled: true },
      ],
      confirmation: {
        enabled: false,
        send_at: '48h',
        channels: ['email', 'push'],
        auto_cancel_if_unconfirmed: false,
        cancel_after: '12h',
      },
      check_in: {
        enabled: false,
        allow_customer_check_in: true,
        allow_staff_check_in: true,
        notify_provider_on_check_in: true,
      },
    },

    // Operations - Preparation and delivery defaults
    operations: {
      default_preparation_time_minutes: 15,
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
