import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StockTransfersController } from './stock-transfers.controller';
import { StockTransfersService } from './stock-transfers.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../../inventory/transactions/inventory-transactions.service';

@Module({
  imports: [PrismaModule],
  controllers: [StockTransfersController],
  providers: [
    StockTransfersService,
    StockLevelManager,
    InventoryTransactionsService,
  ],
  exports: [StockTransfersService],
})
export class StockTransfersModule {}
