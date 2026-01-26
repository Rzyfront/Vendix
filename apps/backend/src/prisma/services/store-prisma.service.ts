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
      inventory_movements: { products: { store_id: context.store_id } },
      inventory_transactions: { products: { store_id: context.store_id } },
      shipping_rates: { shipping_zone: { store_id: context.store_id } },
      product_tax_assignments: { products: { store_id: context.store_id } },
    };

    const security_filter: Record<string, any> = {};

    // Models requiring Organization scope (no store_id, but owned by Org)
    const org_scoped_models = [
      'suppliers',
      'stock_transfers',
      'sales_orders',
      'return_orders',
      'expense_categories',
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

  // Global tables (no store scoping)
  get default_templates() {
    return this.baseClient.default_templates;
  }

  override $transaction(arg: any, options?: any) {
    return this.scoped_client.$transaction(arg, options);
  }
}
