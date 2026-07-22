import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { PaymentReceiptScanProcessor } from './payment-receipt-scan.processor';
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
    // FASE TRACK B2 — cola dedicada `payment-receipt-scan` para OCR async
    // de comprobantes de pago (calque de dispatch-notes `receipt-scan` y
    // expenses `expense-scan`). El root BullMQ ya está configurado
    // globalmente por AIQueueModule; aquí solo registramos la cola del dominio.
    BullModule.registerQueue({ name: 'payment-receipt-scan' }),
  ],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    InvoiceScannerService,
    PaymentReceiptScanProcessor,
  ],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
