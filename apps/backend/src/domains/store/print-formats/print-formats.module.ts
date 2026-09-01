import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseService } from '@common/responses/response.service';
import { QrService } from '../../../common/services/qr.service';
import { S3Module } from '../../../common/services/s3.module';
// CP-DTLP-20260827 — IDOR fix (H-1). Registered at controller scope on
// `PrintFormatsController` so only the write-surface that reads `x-store-id`
// pays the extra lookup. Library/CRUD endpoints don't carry the header and
// stay unguarded.
import { StoreTenantGuard } from '@common/guards/store-tenant.guard';

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
// [print-editor-dsk P2.2] — Single render path service (replaces the
// double-render srcdoc+doc.write pattern from `document-print.service.ts`).
import { PrintDocumentRendererService } from './services/print-document-renderer.service';

// [print-editor-dsk P9] — Prometheus instrumentation for the gateway.
// Pure `prom-client` adapter, no DI deps; registered as a plain provider
// so the gateway can inject it without a side-effect import. The service
// does NOT register with the global `@willsoto/nestjs-prometheus` registry
// here on purpose: it is a leaf metric owned by this module, and any
// cross-module collector would be wired in `app.module.ts` instead.
import { PrintGatewayMetricsService } from './services/print-gateway.metrics';

// [print-editor-dsk P1.1] — AJV validator is loaded LAZILY by services that
// need it (`print-formats.service.ts` calls `validatePrintFormatDefinition`
// at request time). NO side-effect import here: an eager AJV compile at
// module load would propagate any AJV/schema error into Nest's module
// graph and break the entire boot. Loading on demand keeps the boot
// resilient and the validator reusable from any other consumer (e.g.
// the spec).

// [print-editor-dsk P7] — Adapter registry: 11 frozen `FormatAdapter`
// records keyed by `format_type`. Used by `print-formats.service.ts` to
// reject `sections` that name regions a format doesn't allow (e.g.
// `qr-block` on a non-fiscal `pos_sale_ticket`). Pure in-memory, no
// DI dependencies, so a plain class registration is enough.
import { FormatAdapterRegistryService } from './services/format-adapter-registry.service';

// Providers & Registry
// [print-editor-dsk P3.1] — Servicio que sirve el picker de documentos
// recientes del editor (endpoint `GET /:formatType/documents`). Sin
// registro, el provider del controller lanzaría DI al primer hit.
import { DocumentIndexService } from './services/document-index.service';
import { DocumentDataProviderRegistry } from './providers/document-data-provider.registry';
import { PosSaleTicketDataProvider } from './providers/pos-sale-ticket.provider';
import { PosElectronicInvoiceDataProvider } from './providers/pos-electronic-invoice.provider';
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
// [print-editor-dsk P8] — Cuatro providers nuevos: planilla de ruta DSD +
// tres certificados de retención. El cast `as unknown as print_format_type_enum`
// en sus `formatType` los mantiene en verde mientras `prisma generate` no haya
// regenerado `@prisma/client` con los cuatro valores recién agregados al enum
// de Postgres.
import { DispatchRouteDataProvider } from './providers/dispatch-route.provider';
import { WithholdingPracticedDataProvider } from './providers/withholding-practiced.provider';
import { WithholdingSufferedDataProvider } from './providers/withholding-suffered.provider';
import { WithholdingEmployeeCertificateDataProvider } from './providers/withholding-employee.provider';

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
    StoreTenantGuard,
    PrintFormatsService,
    PrintGatewayService,
    PrintTemplateCompilerService,
    PrintLayoutComposerService,
    PrintFiscalValidatorService,
    FiscalInvoicePdfRenderService,
    // [print-editor-dsk P9] — Prometheus service. No DI dependencies; the
    // gateway injects it via constructor (see `print-gateway.service.ts`).
    PrintGatewayMetricsService,
    // [print-editor-dsk P2.2] — wired into `preview()` so the HTML the
    // Hub/control-panel renders carries explicit pixel dimensions and a
    // single, consistent `.vendix-print-page` container.
    PrintDocumentRendererService,
    // [print-editor-dsk P7] — Registry used by `print-formats.service.ts`
    // for region-allowlist validation on overrides / template definitions.
    FormatAdapterRegistryService,
    DocumentDataProviderRegistry,
    // [print-editor-dsk P3.1] — Servicio del picker de documentos
    // recientes. Sólo depende del registry (no de providers concretos),
    // así que basta con registrarlo una vez y los once providers pasan
    // a tener su `listRecent` disponible a través del servicio.
    DocumentIndexService,
    PosSaleTicketDataProvider,
    PosElectronicInvoiceDataProvider,
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
    // [print-editor-dsk P8] — Providers 12–15: dispatch_route + 3 retenciones.
    DispatchRouteDataProvider,
    WithholdingPracticedDataProvider,
    WithholdingSufferedDataProvider,
    WithholdingEmployeeCertificateDataProvider,
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
    private readonly posElectronicInvoiceProvider: PosElectronicInvoiceDataProvider,
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
    // [print-editor-dsk P8] — Cuatro providers más para onModuleInit.
    private readonly dispatchRouteProvider: DispatchRouteDataProvider,
    private readonly withholdingPracticedProvider: WithholdingPracticedDataProvider,
    private readonly withholdingSufferedProvider: WithholdingSufferedDataProvider,
    private readonly withholdingEmployeeCertificateProvider: WithholdingEmployeeCertificateDataProvider,
  ) {}

  onModuleInit() {
    this.registry.register(this.posSaleTicketProvider);
    this.registry.register(this.posElectronicInvoiceProvider);
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
    // [print-editor-dsk P8] — Providers 12–15 del Hub.
    this.registry.register(this.dispatchRouteProvider);
    this.registry.register(this.withholdingPracticedProvider);
    this.registry.register(this.withholdingSufferedProvider);
    this.registry.register(this.withholdingEmployeeCertificateProvider);
  }
}
