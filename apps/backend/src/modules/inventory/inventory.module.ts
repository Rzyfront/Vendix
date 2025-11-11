import { Module } from '@nestjs/common';
import { LocationsModule } from './locations/locations.module';
import { StockLevelsModule } from './stock-levels/stock-levels.module';
import { MovementsModule } from './movements/movements.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { InventoryIntegrationService } from './shared/services/inventory-integration.service';
import { StockLevelManager } from './shared/services/stock-level-manager.service';
import { InventoryBatchesService } from './batches/inventory-batches.service';
import { InventorySerialNumbersService } from './serial-numbers/inventory-serial-numbers.service';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
  ],
  controllers: [],
  providers: [
    InventoryIntegrationService,
    StockLevelManager,
    InventoryBatchesService,
    InventorySerialNumbersService,
    InventoryTransactionsService,
  ],
  exports: [
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryIntegrationService,
    StockLevelManager,
    InventoryBatchesService,
    InventorySerialNumbersService,
    InventoryTransactionsService,
  ],
})
export class InventoryModule {}
