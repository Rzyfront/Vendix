import { Module } from '@nestjs/common';
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
export class ProductionOrdersModule {}
