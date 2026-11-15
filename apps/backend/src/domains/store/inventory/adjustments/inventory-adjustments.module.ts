import { Module } from '@nestjs/common';
import { BulkUploadsModule } from '../../bulk-uploads/bulk-uploads.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { InventoryCountScannerService } from './inventory-count-scanner.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { StoreSkuGeneratorService } from './store-sku-generator.service';
import { SettingsModule } from '../../settings/settings.module';

@Module({
  controllers: [InventoryAdjustmentsController],
  providers: [
    InventoryAdjustmentsService,
    InventoryAdjustmentsBulkService,
    InventoryCountScannerService,
    StockLevelManager,
    StoreSkuGeneratorService,
  ],
  imports: [
    InventoryTransactionsModule,
    BulkUploadsModule,
    PrismaModule,
    EventEmitterModule,
    ResponseModule,
    SettingsModule,
    S3Module,
  ],
  exports: [InventoryAdjustmentsService, StoreSkuGeneratorService],
})
export class InventoryAdjustmentsModule {}
