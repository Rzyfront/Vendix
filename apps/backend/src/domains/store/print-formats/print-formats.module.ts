import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseService } from '@common/responses/response.service';
import { QrService } from '../../../common/services/qr.service';
import { S3Module } from '../../../common/services/s3.module';
// CP-DTLP-20260827 — IDOR fix (H-1). Registered at controller scope on
// `PrintFormatsController` so only the write-surface that reads `x-store-id`
// pays the extra lookup. Library/CRUD endpoints don't carry the header and
// stay unguarded.
import { StoreTenantInterceptor } from '@common/middleware/store-tenant.interceptor';

// Controllers
import { PrintFormatsController } from './controllers/print-formats.controller';
import { PrintTemplatesLibraryController } from './controllers/print-templates-library.controller';

// Services
import { PrintFormatsService } from './services/print-formats.service';
import { PrintGatewayService } from './services/print-gateway.service';
import { PrintTemplateCompilerService } from './services/print-template-compiler.service';
import { PrintLayoutComposerService } from './services/print-layout-composer.service';
import { PrintFiscalValidatorService } from './services/print-fiscal-validator.service';
// E.11 casilla 4 — motor PDF bajo demanda del gateway (builder pdfkit, sin S3).
import { FiscalInvoicePdfRenderService } from './services/fiscal-invoice-pdf-render.service';

// Providers & Registry
import { DocumentDataProviderRegistry } from './providers/document-data-provider.registry';
import { PosSaleTicketDataProvider } from './providers/pos-sale-ticket.provider';
import { SalesOrderInvoiceDataProvider } from './providers/sales-order-invoice.provider';
import { DispatchNoteDataProvider } from './providers/dispatch-note.provider';
import { QuotationDataProvider } from './providers/quotation.provider';
import { CreditNoteDataProvider } from './providers/credit-note.provider';
import { PurchaseOrderDataProvider } from './providers/purchase-order.provider';
import { TransferNoteDataProvider } from './providers/transfer-note.provider';
import { FiscalInvoiceDataProvider } from './providers/fiscal-invoice.provider';
import { FiscalCreditNoteDataProvider } from './providers/fiscal-credit-note.provider';
import { KitchenTicketDataProvider } from './providers/kitchen-ticket.provider';
import { DispatchTicketDataProvider } from './providers/dispatch-ticket.provider';

@Module({
  imports: [
    PrismaModule,
    // E.11 casilla 4 — el render PDF bajo demanda descarga el logo del emisor
    // desde S3 (best-effort), igual que hace `generatePdf` en invoicing.
    S3Module,
  ],
  // ORDEN DELIBERADO. `PrintTemplatesLibraryController` sirve
  // `store/print-formats/library`; `PrintFormatsController` sirve
  // `store/print-formats/:formatType`. Nest resuelve por orden de registro, así
  // que con el orden inverso la ruta parametrizada se tragaba «library» y
  // `GET /store/print-formats/library` respondía 500 (`PrismaClientValidation`:
  // «library» no es un valor de `print_format_type_enum`). La biblioteca del Hub
  // quedaba inalcanzable y el selector de plantilla del perfil, siempre vacío.
  controllers: [PrintTemplatesLibraryController, PrintFormatsController],
  providers: [
    ResponseService,
    QrService,
    StoreTenantInterceptor,
    PrintFormatsService,
    PrintGatewayService,
    PrintTemplateCompilerService,
    PrintLayoutComposerService,
    PrintFiscalValidatorService,
    FiscalInvoicePdfRenderService,
    DocumentDataProviderRegistry,
    PosSaleTicketDataProvider,
    SalesOrderInvoiceDataProvider,
    DispatchNoteDataProvider,
    QuotationDataProvider,
    CreditNoteDataProvider,
    PurchaseOrderDataProvider,
    TransferNoteDataProvider,
    FiscalInvoiceDataProvider,
    FiscalCreditNoteDataProvider,
    KitchenTicketDataProvider,
    // CP-DTLP-20260827 (Phase B.4.b): 11th provider, registrado contra el
    // registry para que `print-gateway.service.ts` lo encuentre en
    // `formatType === 'dispatch_ticket'`. Sin este registro, FB-23
    // (`/store/print-formats/render` con dispatch_ticket) devolvería
    // PRINT_DATA_PROVIDER_MISSING_001 (ERR-03) en vez de 200.
    DispatchTicketDataProvider,
  ],
  // BE-E5 (E.5): exportar `FiscalInvoicePdfRenderService` para que
  // `InvoiceDeliveryModule` (reenvío de facturas, `POST /:id/deliver`) pueda
  // inyectarlo y entregar el ZIP con el PDF re-renderizado en el formato
  // configurado de la tienda — `store_settings.settings.receipts.invoice_format`,
  // misma fuente que ya consume `buildFiscalInvoicePdfData` vía
  // `resolveFiscalInvoicePaperFormat`. Slice-1 del motor (commit `d4141e00c`)
  // ya corre dentro del gateway; este export abre el mismo camino al reenvío.
  exports: [
    PrintGatewayService,
    PrintFormatsService,
    FiscalInvoicePdfRenderService,
  ],
})
export class PrintFormatsModule implements OnModuleInit {
  constructor(
    private readonly registry: DocumentDataProviderRegistry,
    private readonly posSaleTicketProvider: PosSaleTicketDataProvider,
    private readonly salesOrderInvoiceProvider: SalesOrderInvoiceDataProvider,
    private readonly dispatchNoteProvider: DispatchNoteDataProvider,
    private readonly quotationProvider: QuotationDataProvider,
    private readonly creditNoteProvider: CreditNoteDataProvider,
    private readonly purchaseOrderProvider: PurchaseOrderDataProvider,
    private readonly transferNoteProvider: TransferNoteDataProvider,
    private readonly fiscalInvoiceProvider: FiscalInvoiceDataProvider,
    private readonly fiscalCreditNoteProvider: FiscalCreditNoteDataProvider,
    private readonly kitchenTicketProvider: KitchenTicketDataProvider,
    // CP-DTLP-20260827 (Phase B.4.b): inyectado para registrar en
    // onModuleInit. Mantener el orden alfabético-ish de los providers
    // (lo de arriba viene de commits previos; este queda al final
    // porque es el último en sumarse al Hub).
    private readonly dispatchTicketProvider: DispatchTicketDataProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.posSaleTicketProvider);
    this.registry.register(this.salesOrderInvoiceProvider);
    this.registry.register(this.dispatchNoteProvider);
    this.registry.register(this.quotationProvider);
    this.registry.register(this.creditNoteProvider);
    this.registry.register(this.purchaseOrderProvider);
    this.registry.register(this.transferNoteProvider);
    this.registry.register(this.fiscalInvoiceProvider);
    this.registry.register(this.fiscalCreditNoteProvider);
    this.registry.register(this.kitchenTicketProvider);
    // CP-DTLP-20260827 (Phase B.4.b): undécimo provider. Sin esta línea, el
    // gateway devuelve 500 (PRINT_DATA_PROVIDER_MISSING_001) al pedir
    // `format_type: 'dispatch_ticket'`.
    this.registry.register(this.dispatchTicketProvider);
  }
}
