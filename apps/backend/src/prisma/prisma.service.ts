import {
  INestApplication,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context.service';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  public prisma: any; // Cliente con middleware
  public client: any; // Alias for backward compatibility

  private readonly orgScopedModels = [
    'users',
    'stores',
    'suppliers',
    'domains',
    'brands',
    'categories',
    'products',
    'taxes',
    'orders',
    'payments',
    'refunds',
    'inventory',
    'audit',
    'addresses',
  ];

  private readonly storeScopedModels = [
    'store_users',
    'store_settings',
    'inventory_locations',
    'stock_levels',
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
  ];

  constructor() {
    this.prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });

    // Store references for middleware
    const orgScopedModels = this.orgScopedModels;
    const storeScopedModels = this.storeScopedModels;

    this.client = this.prisma;
    console.log('🚀 [PrismaService] PrismaClient initialized successfully');
  }

  async onModuleInit() {
    await this.prisma.$connect();
    this.logger.log('✅ Prisma connected to database');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await this.prisma.$disconnect();
      await app.close();
    });
  }

  // Delegate all property access to the client
  get users() {
    return this.prisma.users;
  }
  get organizations() {
    return this.prisma.organizations;
  }
  get stores() {
    return this.prisma.stores;
  }
  get domain_settings() {
    return this.prisma.domain_settings;
  }
  get addresses() {
    return this.prisma.addresses;
  }
  get audit_logs() {
    return this.prisma.audit_logs;
  }
  get organization_settings() {
    return this.prisma.organization_settings;
  }
  get brands() {
    return this.prisma.brands;
  }
  get categories() {
    return this.prisma.categories;
  }
  get inventory_movements() {
    return this.prisma.inventory_movements;
  }
  get inventory_transactions() {
    return this.prisma.inventory_transactions;
  }
  get login_attempts() {
    return this.prisma.login_attempts;
  }
  get order_items() {
    return this.prisma.order_items;
  }
  get order_item_taxes() {
    return this.prisma.order_item_taxes;
  }
  get orders() {
    return this.prisma.orders;
  }
  get payment_methods() {
    return this.prisma.payment_methods;
  }
  get payments() {
    return this.prisma.payments;
  }
  get product_categories() {
    return this.prisma.product_categories;
  }
  get product_images() {
    return this.prisma.product_images;
  }
  get product_tax_assignments() {
    return this.prisma.product_tax_assignments;
  }
  get product_variants() {
    return this.prisma.product_variants;
  }
  get products() {
    return this.prisma.products;
  }
  get refund_items() {
    return this.prisma.refund_items;
  }
  get refunds() {
    return this.prisma.refunds;
  }
  get reviews() {
    return this.prisma.reviews;
  }
  get store_settings() {
    return this.prisma.store_settings;
  }
  get user_settings() {
    return this.prisma.user_settings;
  }
  get store_users() {
    return this.prisma.store_users;
  }
  get tax_categories() {
    return this.prisma.tax_categories;
  }
  get tax_rates() {
    return this.prisma.tax_rates;
  }
  get email_verification_tokens() {
    return this.prisma.email_verification_tokens;
  }
  get refresh_tokens() {
    return this.prisma.refresh_tokens;
  }
  get roles() {
    return this.prisma.roles;
  }
  get user_roles() {
    return this.prisma.user_roles;
  }
  get password_reset_tokens() {
    return this.prisma.password_reset_tokens;
  }
  get permissions() {
    return this.prisma.permissions;
  }
  get role_permissions() {
    return this.prisma.role_permissions;
  }
  get inventory_locations() {
    return this.prisma.inventory_locations;
  }
  get stock_levels() {
    return this.prisma.stock_levels;
  }
  get inventory_batches() {
    return this.prisma.inventory_batches;
  }
  get inventory_serial_numbers() {
    return this.prisma.inventory_serial_numbers;
  }
  get suppliers() {
    return this.prisma.suppliers;
  }
  get supplier_products() {
    return this.prisma.supplier_products;
  }
  get inventory_adjustments() {
    return this.prisma.inventory_adjustments;
  }
  get stock_reservations() {
    return this.prisma.stock_reservations;
  }
  get purchase_orders() {
    return this.prisma.purchase_orders;
  }
  get purchase_order_items() {
    return this.prisma.purchase_order_items;
  }
  get sales_orders() {
    return this.prisma.sales_orders;
  }
  get sales_order_items() {
    return this.prisma.sales_order_items;
  }
  get stock_transfers() {
    return this.prisma.stock_transfers;
  }
  get stock_transfer_items() {
    return this.prisma.stock_transfer_items;
  }
  get return_orders() {
    return this.prisma.return_orders;
  }
  get return_order_items() {
    return this.prisma.return_order_items;
  }

  // Delegate special methods
  $transaction(...args: any[]) {
    return this.prisma.$transaction(...args);
  }
  $connect() {
    return this.prisma.$connect();
  }
  $disconnect() {
    return this.prisma.$disconnect();
  }

  /**
   * Aplica filtros de seguridad a los argumentos de Prisma query
   */
  applySecurityFilter(params: any, context?: any): any {
    const orgScopedModels = this.orgScopedModels;
    const storeScopedModels = this.storeScopedModels;

    const currentContext = context || RequestContextService.getContext();
    const isOrgScoped = orgScopedModels.includes(params.model);
    const isStoreScoped = storeScopedModels.includes(params.model);

    // If there is no context, or the model is not scoped at all, or the user is a super admin without owner role, bypass the logic.
    if (
      !currentContext ||
      (!isOrgScoped && !isStoreScoped) ||
      (currentContext.is_super_admin && !currentContext.is_owner)
    ) {
      console.log(
        `[PRISMA] Bypassing scope for ${params.model}.${params.action} - context: ${!!currentContext}, isOrgScoped: ${isOrgScoped}, isStoreScoped: ${isStoreScoped}, is_super_admin: ${currentContext?.is_super_admin}, is_owner: ${currentContext?.is_owner}, org_id: ${currentContext?.organization_id}`,
      );
      return params;
    }

    const securityFilter: Record<string, any> = {};

    if (isOrgScoped && currentContext.organization_id) {
      securityFilter.organization_id = currentContext.organization_id;
    }

    if (isStoreScoped && currentContext.store_id) {
      securityFilter.store_id = currentContext.store_id;
    }

    if (Object.keys(securityFilter).length > 0) {
      if (
        [
          'findUnique',
          'findFirst',
          'findMany',
          'count',
          'update',
          'updateMany',
          'delete',
          'deleteMany',
        ].includes(params.action)
      ) {
        if (params.args.where) {
          params.args.where = {
            ...params.args.where,
            ...securityFilter,
          };
        } else {
          params.args.where = securityFilter;
        }
        console.log(
          `[PRISMA] Applying security filter for ${params.model}.${params.action}: ${JSON.stringify(securityFilter)}`,
        );
      }
    }

    return params;
  }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, etc.)
   */
  withoutScope() {
    return new PrismaClient();
  }
}
