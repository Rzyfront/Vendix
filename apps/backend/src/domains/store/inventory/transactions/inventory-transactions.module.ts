import { Module } from '@nestjs/common';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { InventoryTransactionsController } from './inventory-transactions.controller';

@Module({
  controllers: [InventoryTransactionsController],
  providers: [InventoryTransactionsService],
  exports: [InventoryTransactionsService],
})
export class InventoryTransactionsModule {}
