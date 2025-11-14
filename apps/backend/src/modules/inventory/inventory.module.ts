import { Module } from '@nestjs/common';
import { LocationsModule } from './locations/locations.module';
import { StockLevelsModule } from './stock-levels/stock-levels.module';
import { MovementsModule } from './movements/movements.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { InventoryController } from './inventory.controller';
import { InventoryValidationService } from './services/inventory-validation.service';
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
  controllers: [InventoryController],
  providers: [
    InventoryValidationService,
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
    InventoryValidationService,
    InventoryIntegrationService,
    StockLevelManager,
    InventoryBatchesService,
    InventorySerialNumbersService,
    InventoryTransactionsService,
  ],
})
export class InventoryModule {}
