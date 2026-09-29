import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createProductionTools } from '../../../ai-engine/tools/domains/menus.tools';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';

/**
 * ProductionOrdersModule — Restaurant Suite Fase C
 *
 * Provides the sub-recipe batch production flow. It depends on the
 * InventoryModule to reuse the singleton `StockLevelManager` and the
 * `InventoryTransactionsService` it owns (consumption + production
 * movements are audited through the same machinery as retail stock).
 *
 * No cross-store module is imported: tenant isolation is enforced by
 * `StorePrismaService` (auto-scope by `store_id`).
 */
@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule],
  controllers: [ProductionOrdersController],
  providers: [ProductionOrdersService],
  exports: [ProductionOrdersService],
})
export class ProductionOrdersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly productionOrdersService: ProductionOrdersService,
  ) {}

  /**
   * K-15: registro descentralizado en el módulo dueño, no en
   * `AIEngineModule` (ciclo DI). `AIToolRegistry` viene del módulo global.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createProductionTools({
        productionOrdersService: this.productionOrdersService,
      }),
    );
  }
}
