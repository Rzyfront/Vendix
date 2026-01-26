import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Default Templates Seed
 * Crea plantillas de configuración por defecto para el sistema
 */
export async function seedDefaultTemplates(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding default templates...');

  const templates = [
    // ===== DOMAIN TEMPLATES =====
    {
      template_name: 'domain_default_organization',
      configuration_type: 'domain',
      template_data: {
        branding: {
          name: 'Mi Organización',
          primary_color: '#7ED7A5',
          secondary_color: '#2F6F4E',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'ORG_ADMIN',
        features: {
          multi_store: true,
          advanced_analytics: true,
          custom_domains: true,
        },
      },
      description: 'Configuración por defecto para dominios de organización',
      is_system: true,
    },
    {
      template_name: 'domain_default_store',
      configuration_type: 'domain',
      template_data: {
        branding: {
          name: 'Mi Tienda',
          primary_color: '#4A90E2',
          secondary_color: '#2C5F8D',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'STORE_ADMIN',
        features: {
          inventory_management: true,
          pos_enabled: true,
          ecommerce_enabled: false,
        },
      },
      description: 'Configuración por defecto para dominios de tienda administrativa',
      is_system: true,
    },
    {
      template_name: 'domain_default_ecommerce',
      configuration_type: 'domain',
      template_data: {
        branding: {
          name: 'Tienda Online',
          primary_color: '#E53E3E',
          secondary_color: '#9B2C2C',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'STORE_ECOMMERCE',
        features: {
          shopping_cart: true,
          wishlist: true,
          guest_checkout: true,
          user_accounts: true,
        },
      },
      description: 'Configuración por defecto para dominios de e-commerce',
      is_system: true,
    },
    {
      template_name: 'domain_default_landing',
      configuration_type: 'domain',
      template_data: {
        branding: {
          name: 'Landing Page',
          primary_color: '#805AD5',
          secondary_color: '#553C9A',
          background_color: '#F4F4F4',
          accent_color: '#FFFFFF',
          border_color: '#B0B0B0',
          text_color: '#222222',
          theme: 'light',
          logo_url: null,
          favicon_url: null,
        },
        security: {
          session_timeout: 3600000,
          max_login_attempts: 5,
        },
        app: 'ORG_LANDING',
        features: {
          contact_form: true,
          newsletter: true,
          social_links: true,
        },
      },
      description: 'Configuración por defecto para landing pages de organización',
      is_system: true,
    },

    // ===== STORE SETTINGS TEMPLATES =====
    {
      template_name: 'store_settings_retail',
      configuration_type: 'store_settings',
      template_data: {
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
        },
        checkout: {
          require_customer: true,
          allow_partial_payments: false,
          payment_terms_days: 0,
        },
        receipts: {
          print_receipt: true,
          email_receipt: true,
          receipt_header: '',
          receipt_footer: '¡Gracias por su compra!',
        },
      },
      description: 'Configuración por defecto para tiendas minoristas',
      is_system: true,
    },
    {
      template_name: 'store_settings_restaurant',
      configuration_type: 'store_settings',
      template_data: {
        general: {
          timezone: 'America/Bogota',
          currency: 'USD',
          language: 'es',
          tax_included: false,
        },
        inventory: {
          low_stock_threshold: 20,
          out_of_stock_action: 'show',
          track_inventory: true,
        },
        checkout: {
          require_customer: false,
          allow_partial_payments: true,
          payment_terms_days: 0,
          table_service: true,
        },
        receipts: {
          print_receipt: true,
          email_receipt: false,
          receipt_header: 'Restaurante',
          receipt_footer: '¡Buen provecho!',
        },
      },
      description: 'Configuración por defecto para restaurantes',
      is_system: true,
    },

    // ===== E-COMMERCE TEMPLATES =====
    {
      template_name: 'ecommerce_basic',
      configuration_type: 'ecommerce',
      template_data: {
        app: 'STORE_ECOMMERCE',
        general: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        slider: {
          photos: [
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
          ],
        },
        catalog: {
          products_per_page: 12,
          show_out_of_stock: false,
          allow_reviews: true,
          show_variants: true,
        },
        cart: {
          allow_guest_checkout: true,
          cart_expiration_hours: 24,
          max_quantity_per_item: 10,
        },
        checkout: {
          require_registration: false,
          guest_email_required: true,
          create_account_after_order: true,
          terms_required: false,
        },
        shipping: {
          free_shipping_threshold: null,
          calculate_tax_before_shipping: true,
        },
      },
      description: 'Configuración básica de e-commerce',
      is_system: true,
    },
    {
      template_name: 'ecommerce_advanced',
      configuration_type: 'ecommerce',
      template_data: {
        app: 'STORE_ECOMMERCE',
        general: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        slider: {
          photos: [
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
          ],
        },
        catalog: {
          products_per_page: 24,
          show_out_of_stock: true,
          allow_reviews: true,
          show_variants: true,
          show_related_products: true,
          enable_filters: true,
        },
        cart: {
          allow_guest_checkout: true,
          cart_expiration_hours: 48,
          max_quantity_per_item: 99,
          save_for_later: true,
        },
        checkout: {
          require_registration: false,
          guest_email_required: true,
          create_account_after_order: true,
          terms_required: true,
          guest_newsletter_opt_in: true,
        },
        shipping: {
          free_shipping_threshold: 100,
          calculate_tax_before_shipping: true,
          multiple_shipping_addresses: false,
        },
        wishlist: {
          enabled: true,
          public_wishlist: false,
          share_wishlist: true,
        },
      },
      description: 'Configuración avanzada de e-commerce',
      is_system: true,
    },

    // ===== PAYMENT METHODS TEMPLATES =====
    {
      template_name: 'payment_methods_cash_only',
      configuration_type: 'payment_methods',
      template_data: {
        enabled_methods: ['cash'],
        cash: {
          enabled: true,
          display_name: 'Efectivo',
          allow_change: true,
        },
      },
      description: 'Métodos de pago solo efectivo',
      is_system: true,
    },
    {
      template_name: 'payment_methods_standard',
      configuration_type: 'payment_methods',
      template_data: {
        enabled_methods: ['cash', 'card', 'bank_transfer'],
        cash: {
          enabled: true,
          display_name: 'Efectivo',
          allow_change: true,
        },
        card: {
          enabled: true,
          display_name: 'Tarjeta',
          providers: ['stripe'],
        },
        bank_transfer: {
          enabled: true,
          display_name: 'Transferencia Bancaria',
          require_verification: true,
        },
      },
      description: 'Métodos de pago estándar',
      is_system: true,
    },
    {
      template_name: 'payment_methods_full',
      configuration_type: 'payment_methods',
      template_data: {
        enabled_methods: ['cash', 'card', 'paypal', 'bank_transfer'],
        cash: {
          enabled: true,
          display_name: 'Efectivo',
          allow_change: true,
        },
        card: {
          enabled: true,
          display_name: 'Tarjeta',
          providers: ['stripe', 'mercadopago'],
        },
        paypal: {
          enabled: true,
          display_name: 'PayPal',
        },
        bank_transfer: {
          enabled: true,
          display_name: 'Transferencia Bancaria',
          require_verification: true,
        },
      },
      description: 'Todos los métodos de pago disponibles',
      is_system: true,
    },

    // ===== SHIPPING TEMPLATES =====
    {
      template_name: 'shipping_flat_rate',
      configuration_type: 'shipping',
      template_data: {
        type: 'flat_rate',
        zones: [
          {
            name: 'Nacional',
            countries: ['CO', 'US', 'CA'],
            rate: 10.00,
            free_threshold: 100,
          },
        ],
      },
      description: 'Envío con tarifa plana por zona',
      is_system: true,
    },
    {
      template_name: 'shipping_weight_based',
      configuration_type: 'shipping',
      template_data: {
        type: 'weight_based',
        zones: [
          {
            name: 'Nacional',
            countries: ['CO'],
            tiers: [
              { min_weight: 0, max_weight: 1, rate: 5.00 },
              { min_weight: 1, max_weight: 5, rate: 10.00 },
              { min_weight: 5, max_weight: 10, rate: 15.00 },
              { min_weight: 10, max_weight: null, rate: 25.00 },
            ],
          },
        ],
      },
      description: 'Envío basado en peso',
      is_system: true,
    },
    {
      template_name: 'shipping_free_only',
      configuration_type: 'shipping',
      template_data: {
        type: 'free',
        free_threshold: 0,
      },
      description: 'Envío gratis en todos los pedidos',
      is_system: true,
    },

    // ===== TAX TEMPLATES =====
    {
      template_name: 'tax_colombia_standard',
      configuration_type: 'tax',
      template_data: {
        country: 'CO',
        tax_included: false,
        default_rate: 0.19,
        categories: [
          {
            name: 'IVA General',
            rate: 0.19,
            is_default: true,
          },
          {
            name: 'IVA Exento',
            rate: 0.00,
          },
        ],
      },
      description: 'Configuración de impuestos estándar para Colombia',
      is_system: true,
    },
    {
      template_name: 'tax_usa_standard',
      configuration_type: 'tax',
      template_data: {
        country: 'US',
        tax_included: false,
        default_rate: null,
        categories: [
          {
            name: 'Sales Tax',
            rate: null,
            is_default: true,
          },
        ],
      },
      description: 'Configuración de impuestos para Estados Unidos',
      is_system: true,
    },

    // ===== EMAIL TEMPLATES =====
    {
      template_name: 'email_basic',
      configuration_type: 'email',
      template_data: {
        provider: 'smtp',
        from: {
          name: '{{branding.name}}',
          email: 'noreply@{{domain}}',
        },
        templates: {
          order_confirmation: {
            enabled: true,
            subject: 'Confirmación de pedido #{{order_number}}',
          },
          shipping_notification: {
            enabled: true,
            subject: 'Tu pedido ha sido enviado',
          },
          password_reset: {
            enabled: true,
            subject: 'Restablecer contraseña',
          },
          welcome_email: {
            enabled: true,
            subject: 'Bienvenido a {{branding.name}}',
          },
        },
      },
      description: 'Configuración básica de email',
      is_system: true,
    },

    // ===== USER SETTINGS TEMPLATES =====
    {
      template_name: 'user_settings_org_admin',
      configuration_type: 'user_settings',
      template_data: {
        app: 'ORG_ADMIN',
        panel_ui: {
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
            settings: true,
            settings_general: true,
            settings_payments: true,
            settings_appearance: true,
            settings_security: true,
            settings_domains: true,
          }
        },
        preferences: {
          language: 'es',
          theme: 'default',
        },
      },
      description: 'Default user settings for organization administrators - all 11 modules enabled',
      is_system: true,
    },
    {
      template_name: 'user_settings_store_admin',
      configuration_type: 'user_settings',
      template_data: {
        app: 'STORE_ADMIN',
        panel_ui: {
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
            settings: true,
            settings_general: true,
            settings_payments: true,
            settings_appearance: true,
            settings_security: true,
            settings_domains: true,
          },
        },
        preferences: {
          language: 'es',
          theme: 'default',
        },
      },
      description: 'Default user settings for store administrators - all 30+ modules including submodules enabled',
      is_system: true,
    },
    {
      template_name: 'user_settings_ecommerce_customer',
      configuration_type: 'user_settings',
      template_data: {
        app: 'STORE_ECOMMERCE',
        panel_ui: {
          STORE_ECOMMERCE: {
            profile: true,
            history: true,
            dashboard: true,
            favorites: true,
            orders: true,
            settings: true,
          },
        },
        preferences: {
          language: 'es',
          theme: 'default',
        },
      },
      description: 'Default user settings for e-commerce customers',
      is_system: true,
    },
    {
      template_name: 'user_settings_landing',
      configuration_type: 'user_settings',
      template_data: {
        app: 'VENDIX_LANDING',
        panel_ui: {
          VENDIX_LANDING: {},
        },
        preferences: {
          language: 'es',
          theme: 'default',
        },
      },
      description: 'Default user settings for landing page customers - no panel UI needed',
      is_system: true,
    },

    // ===== NOTIFICATIONS TEMPLATES =====
    {
      template_name: 'notifications_customer',
      configuration_type: 'notifications',
      template_data: {
        email: {
          order_created: true,
          order_confirmed: true,
          order_shipped: true,
          order_delivered: true,
          password_reset: true,
          newsletter: false,
        },
        sms: {
          order_created: false,
          order_confirmed: false,
          order_shipped: true,
          order_delivered: true,
        },
      },
      description: 'Notificaciones para clientes',
      is_system: true,
    },
    {
      template_name: 'notifications_admin',
      configuration_type: 'notifications',
      template_data: {
        email: {
          new_order: true,
          low_stock: true,
          out_of_stock: true,
          daily_summary: false,
        },
        in_app: {
          new_order: true,
          low_stock: true,
          out_of_stock: true,
        },
      },
      description: 'Notificaciones para administradores',
      is_system: true,
    },
  ];

  // Crear o actualizar templates
  let created = 0;
  let updated = 0;

  for (const template of templates) {
    const result = await client.default_templates.upsert({
      where: { template_name: template.template_name },
      update: {
        configuration_type: template.configuration_type as any,
        template_data: template.template_data as any,
        description: template.description,
        is_active: true,
        is_system: template.is_system,
        updated_at: new Date(),
      },
      create: {
        template_name: template.template_name,
        configuration_type: template.configuration_type as any,
        template_data: template.template_data as any,
        description: template.description,
        is_active: true,
        is_system: template.is_system,
      },
    });

    if (result.created_at === result.updated_at) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`✅ Default templates seeded: ${created} created, ${updated} updated`);

  return { created, updated };
}
