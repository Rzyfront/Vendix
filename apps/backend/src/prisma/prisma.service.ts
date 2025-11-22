import {
  INestApplication,
  Injectable,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  RequestContextService,
  RequestContext,
} from '../common/context/request-context.service';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly baseClient: PrismaClient;
  private readonly scopedClient: any;

  // Modelos que requieren scoping por organización (tienen organization_id)
  private readonly orgScopedModels = [
    'users',
    'stores',
    'suppliers',
    'domains',
    // 'organizations', // REMOVED: organizations is the root model, doesn't have organization_id
    'addresses',
    'audit_logs',
  ];

  // Modelos que requieren scoping por tienda (tienen store_id)
  private readonly storeScopedModels = [
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
    // MODELOS CORREGIDOS: estos tienen store_id pero estaban mal categorizados
    'categories',
    'products',
    'tax_rates',
    'orders',
    'payments',
    'store_payment_methods', // NUEVO: métodos de pago por tienda
  ];

  constructor() {
    this.baseClient = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'error', 'warn']
          : ['error'],
    });

    // Crear cliente extendido con scoping automático usando Client Extensions
    this.scopedClient = this.createScopedClient();

    console.log(
      '🚀 [PrismaService] PrismaClient initialized with automatic scoping',
    );
  }

  /**
   * Crear cliente con scoping automático
   */
  private createScopedClient() {
    const extensions = this.createQueryExtensions();
    return this.baseClient.$extends({ query: extensions });
  }

  async onModuleInit() {
    await this.baseClient.$connect();
    this.logger.log('✅ Prisma connected to database');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await this.baseClient.$disconnect();
      await app.close();
    });
  }

  /**
   * Crea las extensiones de query para aplicar scoping automático
   */
  private createQueryExtensions() {
    const extensions: any = {};

    // Operaciones que necesitan scoping
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

    // Aplicar scoping a todos los modelos que lo requieren
    const scopedModels = [...this.orgScopedModels, ...this.storeScopedModels];

    for (const model of scopedModels) {
      extensions[model] = {};
      for (const operation of operations) {
        extensions[model][operation] = ({ args, query }: any) => {
          return this.applySecurityScoping(model, args, query);
        };
      }
    }

    return extensions;
  }

  /**
   * Aplica scoping de seguridad a una consulta específica
   */
  private applySecurityScoping(model: string, args: any, query: any) {
    const context = RequestContextService.getContext();

    // Si no hay contexto, devolver consulta sin scoping (para jobs o seeders)
    if (!context) {
      return query(args);
    }

    const scopedArgs = { ...args };
    const securityFilter: Record<string, any> = {};

    // Aplicar scoping por organización
    if (this.orgScopedModels.includes(model) && context.organization_id) {
      securityFilter.organization_id = context.organization_id;
    }

    // Aplicar scoping por tienda
    if (this.storeScopedModels.includes(model) && context.store_id) {
      securityFilter.store_id = context.store_id;
    }

    // Combinar filtro de seguridad con cláusula where existente
    if (Object.keys(securityFilter).length > 0) {
      scopedArgs.where = {
        ...scopedArgs.where,
        ...securityFilter,
      };

      console.log(
        `[PRISMA] 🔒 Applied security filter for ${model}: ${JSON.stringify(securityFilter)}`,
      );
    }

    return query(scopedArgs);
  }

  // Delegar acceso a propiedades al cliente con scoping automático
  get users() {
    return this.scopedClient.users;
  }
  get organizations() {
    return this.baseClient.organizations; // Use base client - organizations is root model
  }
  get stores() {
    return this.scopedClient.stores;
  }
  get domain_settings() {
    return this.scopedClient.domain_settings;
  }
  get addresses() {
    return this.scopedClient.addresses;
  }
  get audit_logs() {
    return this.scopedClient.audit_logs;
  }
  get organization_settings() {
    return this.scopedClient.organization_settings;
  }
  get brands() {
    return this.baseClient.brands;
  } // GLOBAL: sin scoping
  get categories() {
    return this.scopedClient.categories;
  } // STORE-SCOPED
  get inventory_movements() {
    return this.scopedClient.inventory_movements;
  }
  get inventory_transactions() {
    return this.scopedClient.inventory_transactions;
  }
  get login_attempts() {
    return this.scopedClient.login_attempts;
  }
  get order_items() {
    return this.scopedClient.order_items;
  }
  get order_item_taxes() {
    return this.scopedClient.order_item_taxes;
  }
  get orders() {
    return this.scopedClient.orders;
  }
  get system_payment_methods() {
    return this.baseClient.system_payment_methods;
  } // GLOBAL: catálogo de métodos de pago del sistema
  get store_payment_methods() {
    return this.scopedClient.store_payment_methods;
  } // STORE-SCOPED: métodos habilitados por tienda
  get payments() {
    return this.scopedClient.payments;
  }
  get product_categories() {
    return this.scopedClient.product_categories;
  }
  get product_images() {
    return this.scopedClient.product_images;
  }
  get product_tax_assignments() {
    return this.scopedClient.product_tax_assignments;
  }
  get product_variants() {
    return this.scopedClient.product_variants;
  }
  get products() {
    return this.scopedClient.products;
  }
  get refund_items() {
    return this.scopedClient.refund_items;
  }
  get refunds() {
    return this.scopedClient.refunds;
  }
  get reviews() {
    return this.scopedClient.reviews;
  }
  get store_settings() {
    return this.scopedClient.store_settings;
  }
  get user_settings() {
    return this.scopedClient.user_settings;
  }
  get user_sessions() {
    return this.scopedClient.user_sessions;
  }
  get store_users() {
    return this.scopedClient.store_users;
  }
  get tax_categories() {
    return this.scopedClient.tax_categories;
  }
  get tax_rates() {
    return this.scopedClient.tax_rates;
  }
  get email_verification_tokens() {
    return this.scopedClient.email_verification_tokens;
  }
  get refresh_tokens() {
    return this.scopedClient.refresh_tokens;
  }
  get roles() {
    return this.scopedClient.roles;
  }
  get user_roles() {
    return this.scopedClient.user_roles;
  }
  get password_reset_tokens() {
    return this.scopedClient.password_reset_tokens;
  }
  get permissions() {
    return this.scopedClient.permissions;
  }
  get role_permissions() {
    return this.scopedClient.role_permissions;
  }
  get inventory_locations() {
    return this.scopedClient.inventory_locations;
  }
  get stock_levels() {
    return this.scopedClient.stock_levels;
  }
  get inventory_batches() {
    return this.scopedClient.inventory_batches;
  }
  get inventory_serial_numbers() {
    return this.scopedClient.inventory_serial_numbers;
  }
  get suppliers() {
    return this.scopedClient.suppliers;
  }
  get supplier_products() {
    return this.scopedClient.supplier_products;
  }
  get inventory_adjustments() {
    return this.scopedClient.inventory_adjustments;
  }
  get stock_reservations() {
    return this.scopedClient.stock_reservations;
  }
  get purchase_orders() {
    return this.scopedClient.purchase_orders;
  }
  get purchase_order_items() {
    return this.scopedClient.purchase_order_items;
  }
  get sales_orders() {
    return this.scopedClient.sales_orders;
  }
  get sales_order_items() {
    return this.scopedClient.sales_order_items;
  }
  get stock_transfers() {
    return this.scopedClient.stock_transfers;
  }
  get stock_transfer_items() {
    return this.scopedClient.stock_transfer_items;
  }
  get return_orders() {
    return this.scopedClient.return_orders;
  }
  get return_order_items() {
    return this.scopedClient.return_order_items;
  }

  // Métodos especiales - algunos delegados al baseClient para compatibilidad total
  $on: (...args: any[]) => any = (...args) => {
    return (this.baseClient as any).$on(...args);
  };

  $transaction(...args: any[]): any {
    return (this.baseClient as any).$transaction(...args);
  }

  $connect() {
    return this.baseClient.$connect();
  }

  $disconnect() {
    return this.baseClient.$disconnect();
  }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, migraciones)
   */
  withoutScope() {
    return this.baseClient;
  }
}
