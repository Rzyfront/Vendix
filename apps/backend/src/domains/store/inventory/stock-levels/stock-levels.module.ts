import { Module } from '@nestjs/common';
import { StockLevelsController } from './stock-levels.controller';
import { StockLevelsService } from './stock-levels.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventoryBatchesService } from '../batches/inventory-batches.service';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryTransactionsModule],
  controllers: [StockLevelsController],
  providers: [StockLevelsService, InventoryBatchesService, StockLevelManager],
  exports: [StockLevelsService],
})
export class StockLevelsModule {}
