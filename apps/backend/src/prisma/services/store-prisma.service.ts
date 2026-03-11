import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { BasePrismaService } from '../base/base-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class StorePrismaService extends BasePrismaService {
  private readonly store_scoped_models = [
    'store_users',
    'store_settings',
    'inventory_locations',
    'categories',
    'tax_categories',
    'products',
    'tax_rates',
    'orders',
    'store_payment_methods',
    'addresses',
    'domain_settings',
    'shipping_zones',
    'shipping_methods',
    'expenses',
    'notifications',
    'notification_subscriptions',
    'push_subscriptions',
    'invoices',
    'invoice_resolutions',
    'dian_configurations',
  ];

  constructor() {
    super();
    this.setupStoreScoping();
  }

  get organizationWhere() {
    const context = RequestContextService.getContext();
    return {
      organization_id: context?.organization_id,
    };
  }

  get storeWhere() {
    const context = RequestContextService.getContext();
    return {
      organization_id: context?.organization_id,
      store_id: context?.store_id,
    };
  }

  private setupStoreScoping() {
    const extensions = this.createStoreQueryExtensions();
    this.scoped_client = this.baseClient.$extends({ query: extensions });
  }

  private createStoreQueryExtensions() {
    const extensions: any = {};
    const operations = [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'create',
      'createMany',
    ];

    const all_scoped_models = [
      ...this.store_scoped_models,
      'stock_levels', // Relational
      'inventory_batches', // Relational
      'inventory_serial_numbers', // Relational
      'order_items', // Relational
      'product_variants', // Relational
      'suppliers', // Org scoped
      'payments', // Relational
      'product_images', // Relational
      'stock_transfers', // Org scoped
      'sales_orders', // Org scoped
      'return_orders', // Org scoped
      'sales_order_items', // Relational
      'refunds', // Relational
      'inventory_adjustments', // Relational
      'inventory_movements', // Relational
      'stock_reservations', // Relational
      'inventory_transactions', // Relational
      'purchase_orders', // Relational
      'shipping_rates', // Relational
      'expense_categories', // Org scoped
      'product_tax_assignments', // Relational
      'invoice_items', // Relational
      'invoice_taxes', // Relational
      'dian_audit_logs', // Relational
      'accounting_entry_lines', // Relational
      'payroll_items', // Relational
      'chart_of_accounts', // Org scoped
      'fiscal_periods', // Org scoped
      'accounting_entries', // Org scoped
      'employees', // Org scoped
      'payroll_runs', // Org scoped
    ];

    for (const model of all_scoped_models) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applyStoreScoping(model, operation, args, query);
        };
      }
    }

    return extensions;
  }

  private applyStoreScoping(
    model: string,
    operation: string,
    args: any,
    query: any,
  ) {
    const context = RequestContextService.getContext();

    if (!context) {
      throw new UnauthorizedException(
        'Unauthorized access - no request context',
      );
    }

    const scoped_args = { ...args };

    // Handle Create Operations
    if (operation === 'create' || operation === 'createMany') {
      if (this.store_scoped_models.includes(model)) {
        if (!context.store_id) {
          throw new ForbiddenException(
            'Access denied - store context required for creation',
          );
        }

        if (operation === 'create') {
          scoped_args.data = {
            ...scoped_args.data,
            store_id: context.store_id,
          };
        } else if (operation === 'createMany') {
          if (Array.isArray(scoped_args.data)) {
            scoped_args.data = scoped_args.data.map((item: any) => ({
              ...item,
              store_id: context.store_id,
            }));
          } else {
            scoped_args.data = {
              ...scoped_args.data,
              store_id: context.store_id,
            };
          }
        }
      }
      return query(scoped_args);
    }

    // Handle Read/Update/Delete Operations (Where clause)
    const relational_scopes: Record<string, any> = {
      stock_levels: { inventory_locations: { store_id: context.store_id } },
      inventory_batches: {
        inventory_locations: { store_id: context.store_id },
      },
      inventory_serial_numbers: {
        inventory_locations: { store_id: context.store_id },
      },
      order_items: { orders: { store_id: context.store_id } },
      product_variants: { products: { store_id: context.store_id } },
      payments: { orders: { store_id: context.store_id } },
      product_images: { products: { store_id: context.store_id } },
      sales_order_items: {
        sales_orders: { organization_id: context.organization_id },
      }, // Changed to Org Scope
      refunds: { orders: { store_id: context.store_id } },
      inventory_adjustments: {
        inventory_locations: { store_id: context.store_id },
      },
      stock_reservations: {
        inventory_locations: { store_id: context.store_id },
      },
      purchase_orders: { location: { store_id: context.store_id } },
      inventory_movements: {
        OR: [
          { products: { store_id: context.store_id } },
          { from_location: { store_id: context.store_id } },
          { to_location: { store_id: context.store_id } },
        ],
      },
      inventory_transactions: { products: { store_id: context.store_id } },
      shipping_rates: { shipping_zone: { store_id: context.store_id } },
      product_tax_assignments: { products: { store_id: context.store_id } },
      invoice_items: { invoice: { store_id: context.store_id } },
      invoice_taxes: { invoice: { store_id: context.store_id } },
      dian_audit_logs: { dian_configuration: { store_id: context.store_id } },
      accounting_entry_lines: {
        entry: { organization_id: context.organization_id },
      },
      payroll_items: {
        payroll_run: { organization_id: context.organization_id },
      },
    };

    const security_filter: Record<string, any> = {};

    // Models requiring Organization scope (no store_id, but owned by Org)
    const org_scoped_models = [
      'suppliers',
      'stock_transfers',
      'sales_orders',
      'return_orders',
      'expense_categories',
      'chart_of_accounts',
      'fiscal_periods',
      'accounting_entries',
      'employees',
      'payroll_runs',
    ];

    if (this.store_scoped_models.includes(model)) {
      if (!context.store_id) {
        throw new ForbiddenException('Access denied - store context required');
      }
      security_filter.store_id = context.store_id;
    } else if (relational_scopes[model]) {
      if (!context.store_id && !relational_scopes[model].sales_orders) {
        // Logic for relational scopes
      }
      Object.assign(security_filter, relational_scopes[model]);
    } else if (org_scoped_models.includes(model)) {
      if (!context.organization_id) {
        throw new ForbiddenException(
          'Access denied - organization context required',
        );
      }
      security_filter.organization_id = context.organization_id;
    }

    if (Object.keys(security_filter).length > 0) {
      scoped_args.where = {
        ...scoped_args.where,
        ...security_filter,
      };
    }

    return query(scoped_args);
  }

  private scoped_client: any;

  // Store-scoped models with automatic filtering
  get store_users() {
    return this.scoped_client.store_users;
  }

  get store_settings() {
    return this.scoped_client.store_settings;
  }

  get inventory_locations() {
    return this.scoped_client.inventory_locations;
  }

  get categories() {
    return this.scoped_client.categories;
  }

  get tax_categories() {
    return this.scoped_client.tax_categories;
  }

  get products() {
    return this.scoped_client.products;
  }

  get tax_rates() {
    return this.scoped_client.tax_rates;
  }

  get orders() {
    return this.scoped_client.orders;
  }

  get store_payment_methods() {
    return this.scoped_client.store_payment_methods;
  }

  get order_items() {
    return this.scoped_client.order_items;
  }

  get product_variants() {
    return this.scoped_client.product_variants;
  }

  get stock_levels() {
    return this.scoped_client.stock_levels;
  }

  get inventory_batches() {
    return this.scoped_client.inventory_batches;
  }

  get inventory_serial_numbers() {
    return this.scoped_client.inventory_serial_numbers;
  }

  get payments() {
    return this.scoped_client.payments;
  }

  get product_images() {
    return this.scoped_client.product_images;
  }

  get sales_order_items() {
    return this.scoped_client.sales_order_items;
  }

  get refunds() {
    return this.scoped_client.refunds;
  }

  get stock_transfers() {
    return this.scoped_client.stock_transfers;
  }

  get sales_orders() {
    return this.scoped_client.sales_orders;
  }

  get return_orders() {
    return this.scoped_client.return_orders;
  }

  get product_tax_assignments() {
    return this.scoped_client.product_tax_assignments;
  }

  get inventory_adjustments() {
    return this.scoped_client.inventory_adjustments;
  }

  get inventory_movements() {
    return this.scoped_client.inventory_movements;
  }

  get stock_reservations() {
    return this.scoped_client.stock_reservations;
  }

  get inventory_transactions() {
    return this.scoped_client.inventory_transactions;
  }

  get purchase_orders() {
    return this.scoped_client.purchase_orders;
  }

  // Global models (no scoping applied)
  get organizations() {
    return this.baseClient.organizations;
  }

  get brands() {
    return this.baseClient.brands;
  }

  get product_categories() {
    return this.baseClient.product_categories;
  }

  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  }

  get organization_payment_policies() {
    return this.baseClient.organization_payment_policies;
  }

  // Organization-scoped models (accessible but not scoped in store service)
  get users() {
    return this.baseClient.users;
  }

  get stores() {
    return this.baseClient.stores;
  }

  get suppliers() {
    return this.scoped_client.suppliers;
  }

  get supplier_products() {
    return this.scoped_client.supplier_products;
  }

  // Addresses is now scoped
  get addresses() {
    return this.scoped_client.addresses;
  }

  get audit_logs() {
    return this.baseClient.audit_logs;
  }

  // Auth and permission models
  get roles() {
    return this.scoped_client.roles;
  }

  get permissions() {
    return this.scoped_client.permissions;
  }

  get user_roles() {
    return this.scoped_client.user_roles;
  }

  get role_permissions() {
    return this.scoped_client.role_permissions;
  }

  get user_settings() {
    return this.scoped_client.user_settings;
  }

  get refresh_tokens() {
    return this.scoped_client.refresh_tokens;
  }

  get password_reset_tokens() {
    return this.scoped_client.password_reset_tokens;
  }

  get email_verification_tokens() {
    return this.scoped_client.email_verification_tokens;
  }

  get user_sessions() {
    return this.scoped_client.user_sessions;
  }

  get login_attempts() {
    return this.scoped_client.login_attempts;
  }

  get organization_settings() {
    return this.scoped_client.organization_settings;
  }

  get expense_categories() {
    return this.scoped_client.expense_categories;
  }

  get domain_settings() {
    return this.scoped_client.domain_settings;
  }

  get shipping_zones() {
    return this.scoped_client.shipping_zones;
  }

  get shipping_methods() {
    return this.scoped_client.shipping_methods;
  }

  get shipping_rates() {
    return this.scoped_client.shipping_rates;
  }

  get expenses() {
    return this.scoped_client.expenses;
  }

  get notifications() {
    return this.scoped_client.notifications;
  }

  get notification_subscriptions() {
    return this.scoped_client.notification_subscriptions;
  }

  get push_subscriptions() {
    return this.scoped_client.push_subscriptions;
  }

  // Invoicing models
  get invoices() {
    return this.scoped_client.invoices;
  }

  get invoice_items() {
    return this.scoped_client.invoice_items;
  }

  get invoice_taxes() {
    return this.scoped_client.invoice_taxes;
  }

  get invoice_resolutions() {
    return this.scoped_client.invoice_resolutions;
  }

  get dian_configurations() {
    return this.scoped_client.dian_configurations;
  }

  get dian_audit_logs() {
    return this.scoped_client.dian_audit_logs;
  }

  // Accounting models
  get chart_of_accounts() {
    return this.scoped_client.chart_of_accounts;
  }

  get fiscal_periods() {
    return this.scoped_client.fiscal_periods;
  }

  get accounting_entries() {
    return this.scoped_client.accounting_entries;
  }

  get accounting_entry_lines() {
    return this.scoped_client.accounting_entry_lines;
  }

  // Payroll models
  get employees() {
    return this.scoped_client.employees;
  }

  get payroll_runs() {
    return this.scoped_client.payroll_runs;
  }

  get payroll_items() {
    return this.scoped_client.payroll_items;
  }

  // Global tables (no store scoping)
  get default_templates() {
    return this.baseClient.default_templates;
  }

  override $transaction(arg: any, options?: any) {
    return this.scoped_client.$transaction(arg, options);
  }
}
