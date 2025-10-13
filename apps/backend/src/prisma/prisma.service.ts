import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context.service';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  public client: any; // Cliente extendido

  constructor() {
    console.log('🚀 [PrismaService] Constructor llamado - creando cliente base');
    
    const baseClient = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    });
    
    console.log('🚀 [PrismaService] Aplicando extensión de scope...');
    
    // Aplicar extensión con scope
  this.client = baseClient.$extends({
      name: 'organizationScope',
      query: {
        // Aplicar a TODOS los modelos
        $allModels: {
          // Intercept ALL operations
          async $allOperations({ operation, model, args, query }: any) {
            const context = RequestContextService.getContext();

            // Schema-derived lists of models containing the respective keys
            const orgScopedModels = ['users', 'audit_logs', 'organization_settings', 'stores', 'domain_settings', 'addresses'];
            const storeScopedModels = ['store_users', 'login_attempts', 'domain_settings', 'addresses', 'categories', 'orders', 'payment_methods', 'products', 'store_settings', 'tax_categories', 'tax_rates', 'audit_logs'];

            const isOrgScoped = orgScopedModels.includes(model);
            const isStoreScoped = storeScopedModels.includes(model);

            // If there is no context, or the model is not scoped at all, or the user is a super admin, bypass the logic.
            if (!context || (!isOrgScoped && !isStoreScoped) || context.is_super_admin) {
              return query(args);
            }
        
            const { organization_id, store_id } = context;
            const modifiedArgs = { ...args };

            // --- WRITE OPERATIONS: INJECT IDs --- 
            if (operation === 'create') {
              modifiedArgs.data = { ...modifiedArgs.data };
              if (isOrgScoped) modifiedArgs.data.organization_id = organization_id;
              if (isStoreScoped && store_id) modifiedArgs.data.store_id = store_id;
            }

            if (operation === 'createMany') {
              if (Array.isArray(modifiedArgs.data)) {
                modifiedArgs.data = modifiedArgs.data.map(item => ({
                  ...item,
                  ...(isOrgScoped && { organization_id: organization_id }),
                  ...(isStoreScoped && store_id && { store_id: store_id }),
                }));
              }
            }

            // --- READ/WRITE OPERATIONS: APPLY SECURITY FILTERS --- 
            const securityFilter = {};
            if (isOrgScoped) {
              securityFilter['organization_id'] = organization_id;
            }
            if (isStoreScoped && store_id) {
              securityFilter['store_id'] = store_id;
            }

            if (Object.keys(securityFilter).length > 0) {
              if (['findUnique', 'findFirst', 'findMany', 'count', 'update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
                modifiedArgs.where = { ...modifiedArgs.where, ...securityFilter };
              }

              if (operation === 'upsert') {
                modifiedArgs.where = { ...modifiedArgs.where, ...securityFilter };
                // Also apply IDs to the create part of the upsert
                modifiedArgs.create = { ...modifiedArgs.create, ...securityFilter };
              }
            }

            return query(modifiedArgs);
          },
        },
      },
    });
    
    console.log('🚀 [PrismaService] Extensión aplicada exitosamente');
  }

  async onModuleInit() {
    await this.client.$connect();
    this.logger.log('✅ Prisma connected to database');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await this.client.$disconnect();
      await app.close();
    });
  }

  // Delegate all property access to the extended client
  get users() { return this.client.users; }
  get organizations() { return this.client.organizations; }
  get stores() { return this.client.stores; }
  get domain_settings() { return this.client.domain_settings; }
  get addresses() { return this.client.addresses; }
  get audit_logs() { return this.client.audit_logs; }
  get organization_settings() { return this.client.organization_settings; }
  get brands() { return this.client.brands; }
  get categories() { return this.client.categories; }
  get customers() { return this.client.customers; }
  get inventory_movements() { return this.client.inventory_movements; }
  get inventory_snapshots() { return this.client.inventory_snapshots; }
  get inventory_transactions() { return this.client.inventory_transactions; }
  get login_attempts() { return this.client.login_attempts; }
  get order_items() { return this.client.order_items; }
  get order_item_taxes() { return this.client.order_item_taxes; }
  get orders() { return this.client.orders; }
  get payment_methods() { return this.client.payment_methods; }
  get payments() { return this.client.payments; }
  get product_categories() { return this.client.product_categories; }
  get product_images() { return this.client.product_images; }
  get product_tax_assignments() { return this.client.product_tax_assignments; }
  get product_variants() { return this.client.product_variants; }
  get products() { return this.client.products; }
  get refund_items() { return this.client.refund_items; }
  get refunds() { return this.client.refunds; }
  get reviews() { return this.client.reviews; }
  get store_settings() { return this.client.store_settings; }
  get store_users() { return this.client.store_users; }
  get tax_categories() { return this.client.tax_categories; }
  get tax_rates() { return this.client.tax_rates; }
  get taxes() { return this.client.taxes; }
  get email_verification_tokens() { return this.client.email_verification_tokens; }
  get refresh_tokens() { return this.client.refresh_tokens; }
  get roles() { return this.client.roles; }
  get user_roles() { return this.client.user_roles; }
  get password_reset_tokens() { return this.client.password_reset_tokens; }
  get permissions() { return this.client.permissions; }
  get role_permissions() { return this.client.role_permissions; }

  // Delegate special methods
  $transaction(...args: any[]) { return this.client.$transaction(...args); }
  $connect() { return this.client.$connect(); }
  $disconnect() { return this.client.$disconnect(); }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, etc.)
   */
  withoutScope() {
    return new PrismaClient();
  }
}