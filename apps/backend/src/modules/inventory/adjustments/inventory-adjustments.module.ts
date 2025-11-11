import { Module } from '@nestjs/common';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';

@Module({
  controllers: [InventoryAdjustmentsController],
  providers: [InventoryAdjustmentsService],
  imports: [InventoryTransactionsModule],
  exports: [InventoryAdjustmentsService],
})
export class InventoryAdjustmentsModule {}
