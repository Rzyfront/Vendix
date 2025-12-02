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
    'inventory_batches',
    'inventory_serial_numbers',
    'stock_reservations',
    'purchase_orders',
    'purchase_order_items',
    'sales_orders',
    'sales_order_items',
    'stock_transfers',
    'stock_transfer_items',
    'return_orders',
    'return_order_items',
    'categories',
    'tax_categories',
    'products',
    'tax_rates',
    'orders',
    'payments',
    'store_payment_methods',
    'product_categories',
    'product_images',
    'product_tax_assignments',
    'product_variants',
    'refund_items',
    'refunds',
    'reviews',
    'stock_levels',
    'inventory_adjustments',
    'inventory_transactions',
    'order_items',
    'inventory_movements',
  ];

  constructor() {
    super();
    this.setupStoreScoping();
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
    ];

    for (const model of this.store_scoped_models) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applyStoreScoping(model, args, query);
        };
      }
    }

    return extensions;
  }

  private applyStoreScoping(model: string, args: any, query: any) {
    const context = RequestContextService.getContext();

    if (!context) {
      throw new UnauthorizedException(
        'Unauthorized access - no request context',
      );
    }

    const scoped_args = { ...args };
    const security_filter: Record<string, any> = {};

    if (this.store_scoped_models.includes(model)) {
      if (!context.store_id) {
        throw new ForbiddenException('Access denied - store context required');
      }
      security_filter.store_id = context.store_id;
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

  get inventory_batches() {
    return this.scoped_client.inventory_batches;
  }

  get inventory_serial_numbers() {
    return this.scoped_client.inventory_serial_numbers;
  }

  get stock_reservations() {
    return this.scoped_client.stock_reservations;
  }

  get purchase_orders() {
    return this.scoped_client.purchase_orders;
  }

  get purchase_order_items() {
    return this.scoped_client.purchase_order_items;
  }

  get sales_orders() {
    return this.scoped_client.sales_orders;
  }

  get sales_order_items() {
    return this.scoped_client.sales_order_items;
  }

  get stock_transfers() {
    return this.scoped_client.stock_transfers;
  }

  get stock_transfer_items() {
    return this.scoped_client.stock_transfer_items;
  }

  get return_orders() {
    return this.scoped_client.return_orders;
  }

  get return_order_items() {
    return this.scoped_client.return_order_items;
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

  get payments() {
    return this.scoped_client.payments;
  }

  get store_payment_methods() {
    return this.scoped_client.store_payment_methods;
  }

  get product_categories() {
    return this.scoped_client.product_categories;
  }

  get product_images() {
    return this.scoped_client.product_images;
  }

  get product_tax_assignments() {
    return this.scoped_client.product_tax_assignments;
  }

  get product_variants() {
    return this.scoped_client.product_variants;
  }

  get refund_items() {
    return this.scoped_client.refund_items;
  }

  get refunds() {
    return this.scoped_client.refunds;
  }

  get reviews() {
    return this.scoped_client.reviews;
  }

  get stock_levels() {
    return this.scoped_client.stock_levels;
  }

  get inventory_adjustments() {
    return this.scoped_client.inventory_adjustments;
  }

  get inventory_movements() {
    return this.scoped_client.inventory_movements;
  }

  get inventory_transactions() {
    return this.scoped_client.inventory_transactions;
  }

  get order_items() {
    return this.scoped_client.order_items;
  }

  // Global models (no scoping applied)
  get organizations() {
    return this.baseClient.organizations;
  }

  get brands() {
    return this.baseClient.brands;
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
    return this.baseClient.suppliers;
  }

  get supplier_products() {
    return this.baseClient.supplier_products;
  }

  get addresses() {
    return this.baseClient.addresses;
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

  get domain_settings() {
    return this.scoped_client.domain_settings;
  }
}
