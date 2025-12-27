import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { LocationsModule } from './locations/locations.module';
import { StockLevelsModule } from './stock-levels/stock-levels.module';
import { MovementsModule } from './movements/movements.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { InventoryAdjustmentsModule } from './adjustments/inventory-adjustments.module';
import { InventoryController } from './inventory.controller';
import { InventoryValidationService } from './services/inventory-validation.service';
import { InventoryIntegrationService } from './shared/services/inventory-integration.service';
import { StockLevelManager } from './shared/services/stock-level-manager.service';
import { InventoryBatchesService } from './batches/inventory-batches.service';
import { InventorySerialNumbersService } from './serial-numbers/inventory-serial-numbers.service';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

@Module({
  imports: [
    ResponseModule,
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryAdjustmentsModule,
  ],
  controllers: [InventoryController],
  providers: [
    StorePrismaService,
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
export class InventoryModule { }
