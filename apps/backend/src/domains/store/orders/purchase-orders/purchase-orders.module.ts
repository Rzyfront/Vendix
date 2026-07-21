import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { S3Module } from '@common/services/s3.module';
import { SettingsModule } from '../../settings/settings.module';
import { AccountsPayableModule } from '../../accounts-payable/accounts-payable.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    InventoryModule,
    S3Module,
    SettingsModule,
    // FASE 3 — el PurchaseOrdersService inyecta AccountsPayableService para
    // espejar pagos PO→AP y backfill de anticipos.
    AccountsPayableModule,
  ],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, InvoiceScannerService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
