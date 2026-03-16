import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

/**
 * Default Templates Seed
 * Crea plantillas de configuración por defecto para el sistema
 *
 * Solo incluye templates que realmente se usan en el código:
 * - store_default_settings: usado en settings.service.ts
 * - ecommerce_default_settings: usado en ecommerce.service.ts
 * - user_settings_default: usado en default-panel-ui.service.ts
 */
export async function seedDefaultTemplates(prisma?: PrismaClient) {
  const client = prisma || getPrismaClient();
  console.log('🌱 Seeding default templates...');

  const templates = [
    // ===== STORE SETTINGS TEMPLATE =====
    {
      template_name: 'store_default_settings',
      configuration_type: 'store_settings',
      template_data: {
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
        },
        checkout: {
          require_customer_data: true,
          allow_guest_checkout: false,
          allow_partial_payments: false,
          require_payment_confirmation: true,
        },
        notifications: {
          low_stock_alerts: true,
          out_of_stock_alerts: true,
          new_online_order: true,
          new_customers_orders_alerts_email: true,
        },
        pos: {
          allow_anonymous_sales: false,
          anonymous_sales_as_default: false,
          business_hours: {
            monday: { open: '07:00', close: '20:00' },
            tuesday: { open: '07:00', close: '20:00' },
            wednesday: { open: '07:00', close: '20:00' },
            thursday: { open: '07:00', close: '20:00' },
            friday: { open: '07:00', close: '20:00' },
            saturday: { open: '10:00', close: '20:00' },
            sunday: { open: '10:00', close: '20:00' },
          },
          offline_mode_enabled: false,
          require_cash_drawer_open: false,
          auto_print_receipt: true,
        },
        receipts: {
          print_receipt: true,
          email_receipt: true,
          receipt_header: '',
          receipt_footer: '¡Gracias por su compra!',
        },
      },
      description: 'Configuración por defecto para tiendas',
      is_system: true,
    },

    // ===== E-COMMERCE TEMPLATE =====
    {
      template_name: 'ecommerce_default_settings',
      configuration_type: 'ecommerce',
      template_data: {
        inicio: {
          titulo: '',
          parrafo: '',
          logo_url: null,
          colores: {
            primary_color: '#3B82F6',
            secondary_color: '#10B981',
            accent_color: '#F59E0B',
          },
        },
        general: {
          currency: 'COP',
          locale: 'es-CO',
          timezone: 'America/Bogota',
        },
        slider: {
          enable: false,
          photos: [
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
            { url: null, title: '', caption: '' },
          ],
        },
        catalog: {
          products_per_page: 16,
          show_out_of_stock: false,
          allow_reviews: true,
          show_variants: true,
          show_related_products: false,
          enable_filters: false,
        },
        cart: {
          allow_guest_checkout: true,
          cart_expiration_hours: 24,
          max_quantity_per_item: 10,
          save_for_later: false,
        },
        checkout: {
          require_registration: false,
          guest_email_required: true,
          create_account_after_order: true,
          terms_required: false,
          guest_newsletter_opt_in: false,
          whatsapp_checkout: false,
          whatsapp_number: '',
        },
        shipping: {
          free_shipping_threshold: null,
          calculate_tax_before_shipping: true,
          multiple_shipping_addresses: false,
        },
        footer: {
          store_info: {
            about_us: '',
            support_email: '',
            tagline: 'Tu tienda de confianza para productos de calidad',
          },
          links: [
            { label: 'Productos', url: '/products', is_external: false },
            { label: 'Novedades', url: '/new', is_external: false },
            { label: 'Ofertas', url: '/sale', is_external: false },
          ],
          help: {
            faq: [
              {
                question: '¿Cómo puedo realizar un pedido?',
                answer:
                  'Navega por nuestro catálogo, agrega los productos que desees al carrito y sigue el proceso de checkout. Puedes pagar con diferentes métodos de pago disponibles.',
              },
              {
                question: '¿Cuáles son los métodos de pago disponibles?',
                answer:
                  'Aceptamos tarjetas de crédito, débito, transferencias bancarias y pagos en efectivo contra entrega según tu ubicación.',
              },
              {
                question: '¿Cuánto tiempo tarda el envío?',
                answer:
                  'El tiempo de entrega varía según tu ubicación. Generalmente los pedidos se entregan entre 3 a 7 días hábiles.',
              },
            ],
            shipping_info:
              'Realizamos envíos a todo el país. El tiempo de entrega varía según tu ubicación, generalmente entre 3 a 7 días hábiles. Puedes verificar el estado de tu pedido en la sección "Mis Pedidos" de tu cuenta.',
            returns_info:
              'Si no estás satisfecho con tu compra, puedes solicitar una devolución dentro de los 30 días posteriores a la recepción. Ten en cuenta que si tu pedido ya está en camino, no es posible cancelarlo. Deberás esperar a recibirlo para luego procesar la devolución contactando a nuestro equipo de soporte.',
          },
          social: {
            facebook: { username: '', url: '' },
            instagram: { username: '', url: '' },
            tiktok: { username: '', url: '' },
          },
        },
      },
      description: 'Configuración por defecto de e-commerce',
      is_system: true,
    },

    // ===== USER SETTINGS TEMPLATE (UNIFICADO) =====
    {
      template_name: 'user_settings_default',
      configuration_type: 'user_settings',
      template_data: {
        panel_ui: {
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
            accounting: true,
            payroll: true,
          },
          STORE_ADMIN: {
            dashboard: true,
            pos: true,
            products: true,
            ecommerce: true,
            orders: true,
            orders_sales: true,
            orders_purchase_orders: true,
            orders_quotations: true,
            inventory: true,
            inventory_pop: true,
            inventory_adjustments: true,
            inventory_locations: true,
            inventory_suppliers: true,
            inventory_movements: true,
            inventory_transfers: true,
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
            analytics_overview: true,
            expenses: true,
            invoicing: true,
            accounting: true,
            accounting_journal_entries: false,
            accounting_fiscal_periods: false,
            accounting_chart_of_accounts: false,
            accounting_reports: false,
            payroll: true,
            payroll_employees: false,
            payroll_runs: false,
            payroll_settings: false,
            settings: true,
            settings_general: true,
            settings_payments: true,
            settings_appearance: true,
            settings_security: true,
            settings_domains: true,
            settings_shipping: true,
            settings_legal_documents: true,
            settings_support: true,
            settings_users: true,
            settings_roles: true,
            settings_cash_registers: false,
            help: false,
            help_support: false,
            help_center: false,
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
        },
        preferences: {
          language: 'es',
          theme: 'default',
        },
      },
      description:
        'Unified default panel UI configuration for all users - all app_types included',
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

  console.log(
    `✅ Default templates seeded: ${created} created, ${updated} updated`,
  );

  return { created, updated };
}
