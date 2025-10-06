import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    // Aplicar interceptores después de la construcción
    this.applyOrganizationScope();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('✅ Prisma connected to database');
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await this.$disconnect();
      await app.close();
    });
  }

  /**
   * Aplica el scope interceptando queries con una extensión de Prisma
   */
  private applyOrganizationScope() {
    // Modelos que tienen organization_id y deben filtrarse por organización
    const orgScopedModels = [
      'addresses',
      'audit_logs',
      'domain_settings',
      'organization_settings',
      'stores',
      'users',
      // Modelos de productos y ventas (heredan org a través de store)
      'brands',
      'categories',
      'customers',
      'inventory_movements',
      'inventory_snapshots',
      'inventory_transactions',
      'login_attempts',
      'order_items',
      'order_item_taxes',
      'orders',
      'payment_methods',
      'payments',
      'product_categories',
      'product_images',
      'product_tax_assignments',
      'product_variants',
      'products',
      'refund_items',
      'refunds',
      'reviews',
      'store_settings',
      'store_users',
      'tax_categories',
      'tax_rates',
      'taxes',
    ];

    // Modelos que TAMBIÉN requieren filtro de tienda (además de organización)
    const storeScopedModels = [
      'addresses',
      'audit_logs',
      'categories',
      'domain_settings',
      'inventory_movements',
      'inventory_snapshots',
      'login_attempts',
      'orders',
      'payment_methods',
      'products',
      'store_settings',
      'store_users',
      'tax_categories',
      'tax_rates',
    ];

    // Interceptar cada modelo con scope
    orgScopedModels.forEach((modelName) => {
      const model = (this as any)[modelName];
      if (!model) return;

      // Guardar métodos originales
      const originalFindMany = model.findMany.bind(model);
      const originalFindFirst = model.findFirst.bind(model);
      const originalFindUnique = model.findUnique.bind(model);
      const originalCount = model.count.bind(model);
      const originalCreate = model.create.bind(model);
      const originalCreateMany = model.createMany.bind(model);
      const originalUpdate = model.update.bind(model);
      const originalUpdateMany = model.updateMany.bind(model);
      const originalDelete = model.delete.bind(model);
      const originalDeleteMany = model.deleteMany.bind(model);

      // Interceptar findMany
      model.findMany = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
          this.logger.debug(`🔍 Scope applied to ${modelName}.findMany`);
        }
        return originalFindMany(args);
      };

      // Interceptar findFirst
      model.findFirst = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
          this.logger.debug(`🔍 Scope applied to ${modelName}.findFirst`);
        }
        return originalFindFirst(args);
      };

      // Interceptar findUnique
      model.findUnique = async (args: any) => {
        const result = await originalFindUnique(args);
        const context = RequestContextService.getContext();
        
        if (result && context && !context.isSuperAdmin && context.organizationId) {
          if (result.organization_id && result.organization_id !== context.organizationId) {
            this.logger.warn(`⛔ Access denied: ${modelName}`);
            return null;
          }
          if (context.storeId && storeScopedModels.includes(modelName) && 
              result.store_id && result.store_id !== context.storeId) {
            this.logger.warn(`⛔ Access denied: ${modelName} (store)`);
            return null;
          }
        }
        return result;
      };

      // Interceptar count
      model.count = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
        }
        return originalCount(args);
      };

      // Interceptar create
      model.create = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && context.organizationId) {
          args = args || {};
          args.data = args.data || {};
          if (!args.data.organization_id) {
            args.data.organization_id = context.organizationId;
            this.logger.debug(`➕ Auto-inject org_id to ${modelName}.create`);
          }
        }
        return originalCreate(args);
      };

      // Interceptar createMany
      model.createMany = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && context.organizationId && args?.data) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((item: any) => ({
              ...item,
              organization_id: item.organization_id || context.organizationId,
            }));
          }
        }
        return originalCreateMany(args);
      };

      // Interceptar update
      model.update = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
          this.logger.debug(`✏️ Scope applied to ${modelName}.update`);
        }
        return originalUpdate(args);
      };

      // Interceptar updateMany
      model.updateMany = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
        }
        return originalUpdateMany(args);
      };

      // Interceptar delete
      model.delete = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
          this.logger.debug(`🗑️ Scope applied to ${modelName}.delete`);
        }
        return originalDelete(args);
      };

      // Interceptar deleteMany
      model.deleteMany = async (args: any) => {
        const context = RequestContextService.getContext();
        if (context && !context.isSuperAdmin && context.organizationId) {
          args = args || {};
          args.where = args.where || {};
          args.where.organization_id = context.organizationId;
          if (context.storeId && storeScopedModels.includes(modelName)) {
            args.where.store_id = context.storeId;
          }
        }
        return originalDeleteMany(args);
      };
    });

    this.logger.log('✅ Organization scope middleware applied');
  }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, etc.)
   */
  withoutScope() {
    return new PrismaClient();
  }
}
