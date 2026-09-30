import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createPurchasingTools } from '../../../../ai-engine/tools/domains/purchasing.tools';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SuppliersService } from '../../inventory/suppliers/suppliers.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { PaymentReceiptScanProcessor } from './payment-receipt-scan.processor';
import { InvoiceRevalidateProcessor } from './invoice-revalidate.processor';
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
    // QUI-855 paso 8a — cola dedicada `invoice-revalidate` (revalidación con IA
    // de la precarga de compras; 202 + job_id + poll con IDOR por tienda).
    BullModule.registerQueue({ name: 'invoice-revalidate' }),
  ],
  controllers: [PurchaseOrdersController],
  providers: [
    PurchaseOrdersService,
    InvoiceScannerService,
    PaymentReceiptScanProcessor,
    InvoiceRevalidateProcessor,
  ],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    // Viene de `SuppliersModule`, re-exportado por `InventoryModule` (ya
    // importado arriba): se inyecta sin agregar ninguna arista al grafo.
    private readonly suppliersService: SuppliersService,
  ) {}

  /**
   * O-33..O-36: compras vía `PurchaseOrdersService` (dueño de la máquina de
   * estados de la OC y de la guarda PO_VARIANT_001). Registro
   * descentralizado en el módulo dueño, no en `AIEngineModule` (ciclo DI).
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createPurchasingTools({
        purchaseOrdersService: this.purchaseOrdersService,
        suppliersService: this.suppliersService,
      }),
    );
  }
}
