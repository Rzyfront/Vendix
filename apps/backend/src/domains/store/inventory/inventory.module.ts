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
import { StockValidatorService } from './shared/services/stock-validator.service';
import { InventoryBatchesService } from './batches/inventory-batches.service';
import { InventorySerialNumbersModule } from './serial-numbers/inventory-serial-numbers.module';
import { InventoryTransactionsService } from './transactions/inventory-transactions.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [
    ResponseModule,
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryAdjustmentsModule,
    InventorySerialNumbersModule,
    PrismaModule,
  ],
  controllers: [InventoryController],
  providers: [
    StorePrismaService,
    InventoryValidationService,
    InventoryIntegrationService,
    StockLevelManager,
    StockValidatorService,
    InventoryBatchesService,
    InventoryTransactionsService,
  ],
  exports: [
    LocationsModule,
    StockLevelsModule,
    MovementsModule,
    SuppliersModule,
    InventoryAdjustmentsModule,
    InventorySerialNumbersModule,
    InventoryValidationService,
    InventoryIntegrationService,
    StockLevelManager,
    StockValidatorService,
    InventoryBatchesService,
    InventoryTransactionsService,
  ],
})
export class InventoryModule {}
