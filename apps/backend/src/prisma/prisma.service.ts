import { INestApplication, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../common/context/request-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
  }

  async onModuleInit() {
    // Conecta a la base de datos cuando el módulo se inicializa
    await this.$connect();
    this.logger.log('✅ Prisma connected to database');
    
    // Aplicar middleware de scope después de conectar
    this.applyOrganizationScope();
  }

  async enableShutdownHooks(app: INestApplication) {
    // Asegura que la conexión se cierre limpiamente al apagar la app
    process.on('beforeExit', async () => {
      await this.$disconnect();
      await app.close();
    });
  }

  /**
   * Aplica el scope de organización automáticamente a todas las queries
   */
  private applyOrganizationScope() {
    // Usar $extends en lugar de $use para Prisma 5+
    const self = this as any;
    
    // Interceptar queries con $use (método legacy pero funcional)
    const originalQuery = self._executeRequest?.bind(self);
    if (!originalQuery) {
      this.logger.warn('⚠️ No se pudo aplicar middleware de scope - método no disponible');
      return;
    }

    self._executeRequest = async (params: any) => {
      const context = RequestContextService.getContext();

      // Sin contexto: permitir la query (puede ser un job o seeder)
      if (!context) {
        return originalQuery(params);
      }

      // Super Admin: bypass completo
      if (context.isSuperAdmin) {
        this.logger.debug(`🔓 Super Admin bypass for ${params.model}.${params.action}`);
        return originalQuery(params);
      }

      // Sin organization_id: no aplicar filtros (usuario público)
      if (!context.organizationId) {
        return originalQuery(params);
      }

      // Modelos que requieren scope de organización
      const orgScopedModels = [
        'stores',
        'products',
        'orders',
        'categories',
        'brands',
        'addresses',
        'taxes',
        'inventory_movements',
        'inventory_snapshots',
        'customers',
        'order_items',
        'payments',
        'refunds',
        'product_images',
        'product_variants',
      ];

      // Modelos que requieren scope de tienda (además de organización)
      const storeScopedModels = [
        'products',
        'orders',
        'inventory_movements',
        'inventory_snapshots',
      ];

      // No aplicar scope a modelos no listados
      if (!params.model || !orgScopedModels.includes(params.model)) {
        return originalQuery(params);
      }

      // ========== OPERACIONES DE LECTURA ==========
      if (['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'].includes(params.action)) {
        params.args = params.args || {};
        params.args.where = params.args.where || {};
        
        // Aplicar filtro de organización
        params.args.where.organization_id = context.organizationId;

        // Aplicar filtro de tienda si aplica
        if (context.storeId && storeScopedModels.includes(params.model)) {
          params.args.where.store_id = context.storeId;
        }

        this.logger.debug(
          `🔍 Scope applied to ${params.model}.${params.action}: org=${context.organizationId}, store=${context.storeId || 'N/A'}`
        );
      }

      // ========== OPERACIONES DE LECTURA ÚNICA ==========
      if (params.action === 'findUnique') {
        // Ejecutar la query primero
        const result = await originalQuery(params);

        // Si no existe, retornar null
        if (!result) {
          return result;
        }

        // Validar que pertenece a la organización
        if (result.organization_id && result.organization_id !== context.organizationId) {
          this.logger.warn(
            `⛔ Access denied: ${params.model} does not belong to org ${context.organizationId}`
          );
          return null; // Simular que no existe
        }

        // Validar tienda si aplica
        if (
          context.storeId &&
          storeScopedModels.includes(params.model) &&
          result.store_id &&
          result.store_id !== context.storeId
        ) {
          this.logger.warn(
            `⛔ Access denied: ${params.model} does not belong to store ${context.storeId}`
          );
          return null;
        }

        return result;
      }

      // ========== OPERACIONES DE CREACIÓN ==========
      if (params.action === 'create') {
        params.args = params.args || {};
        params.args.data = params.args.data || {};

        // Inyectar organization_id automáticamente
        if (!params.args.data.organization_id) {
          params.args.data.organization_id = context.organizationId;
          
          this.logger.debug(
            `➕ Auto-inject org_id=${context.organizationId} to ${params.model}.create`
          );
        }
      }

      // ========== OPERACIONES DE ACTUALIZACIÓN ==========
      if (['update', 'updateMany', 'upsert'].includes(params.action)) {
        params.args = params.args || {};
        params.args.where = params.args.where || {};

        // Validar que solo se actualicen registros de la organización
        params.args.where.organization_id = context.organizationId;

        // Validar tienda si aplica
        if (context.storeId && storeScopedModels.includes(params.model)) {
          params.args.where.store_id = context.storeId;
        }

        this.logger.debug(
          `✏️ Scope applied to ${params.model}.${params.action}: org=${context.organizationId}`
        );
      }

      // ========== OPERACIONES DE ELIMINACIÓN ==========
      if (['delete', 'deleteMany'].includes(params.action)) {
        params.args = params.args || {};
        params.args.where = params.args.where || {};

        // Validar que solo se eliminen registros de la organización
        params.args.where.organization_id = context.organizationId;

        // Validar tienda si aplica
        if (context.storeId && storeScopedModels.includes(params.model)) {
          params.args.where.store_id = context.storeId;
        }

        this.logger.debug(
          `🗑️ Scope applied to ${params.model}.${params.action}: org=${context.organizationId}`
        );
      }

      return originalQuery(params);
    };

    this.logger.log('✅ Organization scope middleware applied');
  }

  /**
   * Ejecuta queries sin scope (útil para jobs, seeders, super admin, etc.)
   */
  withoutScope() {
    return new PrismaClient();
  }
}
