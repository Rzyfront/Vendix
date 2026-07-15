import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { InventoryCountScannerService } from './inventory-count-scanner.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  controllers: [InventoryAdjustmentsController],
  providers: [
    InventoryAdjustmentsService,
    InventoryAdjustmentsBulkService,
    InventoryCountScannerService,
    StockLevelManager,
  ],
  imports: [
    InventoryTransactionsModule,
    PrismaModule,
    EventEmitterModule,
    ResponseModule,
  ],
  exports: [InventoryAdjustmentsService],
})
export class InventoryAdjustmentsModule {}
