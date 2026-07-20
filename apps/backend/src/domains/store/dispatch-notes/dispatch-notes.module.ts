import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DispatchNotesService } from './dispatch-notes.service';
import { DispatchNotesController } from './dispatch-notes.controller';
import { ReceiptScanProcessor } from './receipt-scan.processor';
import { DispatchNoteFlowService } from './dispatch-note-flow/dispatch-note-flow.service';
import { DispatchNotePdfService } from './pdf/dispatch-note-pdf.service';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import { DispatchNoteEventsListener } from './listeners/dispatch-note-events.listener';
import { DispatchFulfillmentListener } from './listeners/dispatch-fulfillment.listener';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';
import { InventoryModule } from '../inventory/inventory.module';
// QUI-431 — explicit import so the serial pool + enforcement services are
// available for injection into DispatchNoteFlowService / the events listener.
// (InventoryModule already re-exports this module; the explicit import documents
// the dependency and is harmless.)
import { InventorySerialNumbersModule } from '../inventory/serial-numbers/inventory-serial-numbers.module';
import { OrderStockCommitModule } from '../inventory/shared/order-stock-commit.module';
import { PurchaseOrdersModule } from '../orders/purchase-orders/purchase-orders.module';
// QUI-498 — order ↔ remisión unification: import OrderFlowModule so the events
// listener can inject OrderFlowService and reconcile the linked order's state
// (and clear the COD balance) from a standalone remisión delivered/invoiced.
// Acyclic: OrderFlowModule does NOT import DispatchNotesModule (nor transitively
// via Prisma/Response/CashRegisters/Settings/Serials/OrderStockCommit).
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    InventoryModule,
    InventorySerialNumbersModule,
    OrderStockCommitModule,
    PurchaseOrdersModule,
    OrderFlowModule,
    // Async purchase-receipt OCR scanner. BullMQ root is already configured
    // globally (embeddings/ai-generation); each domain only registers its own
    // queue. Producer: DispatchNotesService.enqueueReceiptScan; consumer:
    // ReceiptScanProcessor.
    BullModule.registerQueue({ name: 'receipt-scan' }),
  ],
  controllers: [DispatchNotesController],
  providers: [
    DispatchNotesService,
    DispatchNoteFlowService,
    DispatchNotePdfService,
    DispatchNumberGenerator,
    RouteNumberGenerator,
    DispatchNoteEventsListener,
    // Bug C — recomputes orders.dispatch_fulfillment on confirm/deliver/void
    // so a fully-remitida order stops showing as despachable.
    DispatchFulfillmentListener,
    // receipt-scan queue worker — injects DispatchNotesService and restores the
    // tenant RequestContext from the job payload before running the OCR.
    ReceiptScanProcessor,
  ],
  exports: [DispatchNotesService],
})
export class DispatchNotesModule {}
