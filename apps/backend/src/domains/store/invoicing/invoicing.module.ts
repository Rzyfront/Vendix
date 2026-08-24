import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { QrService } from '@common/services/qr.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InvoiceProviderModule } from './providers/invoice-provider.module';
import { DianDirectModule } from './providers/dian-direct/dian-direct.module';
import { InvoicingController } from './invoicing.controller';
import { ResolutionsController } from './resolutions/resolutions.controller';
import { DianConfigController } from './dian-config/dian-config.controller';
import { SuperAdminCertificatesPendingController } from './dian-config/dian-config.controller';
import { InvoicingService } from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { CreditNotesService } from './credit-notes/credit-notes.service';
import { InvoiceEmissionGateService } from './services/invoice-emission-gate.service';
import { ResolutionsService } from './resolutions/resolutions.service';
import { ResolutionScannerService } from './resolutions/resolution-scanner.service';
import { DianHabilitationScannerService } from './dian-config/dian-habilitation-scanner.service';
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';
import { TrmService } from './services/trm.service';
import { CustomerFiscalIdentityValidator } from './validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from './validators/fiscal-document.validator';
import { DianConfigService } from './dian-config/dian-config.service';
import { BullModule } from '@nestjs/bullmq';
import { DianTestSetProcessor } from './dian-config/dian-test-set.processor';
import { DianTestService } from './dian-config/dian-test.service';
import { DianNumberingRangeService } from './dian-config/dian-numbering-range.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { DianEventsService } from './services/dian-events.service';
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';
import { InvoiceRetryListener } from './services/invoice-retry.listener';
import { FiscalTransmissionLedgerService } from './services/fiscal-transmission-ledger.service';
import { ManualCertificateIssuerAdapter } from './dian-config/certificates/manual-certificate-issuer.adapter';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';
import { WithholdingTaxModule } from '../withholding-tax/withholding-tax.module';
import { PosFiscalController } from './pos/pos-fiscal.controller';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';
import { PosSaleCompletedListener } from './pos/pos-sale-completed.listener';
import { ProfilesController } from './profiles/profiles.controller';
import { ProfilesModule } from './profiles/profiles.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    InvoiceProviderModule,
    DianDirectModule,
    WithholdingTaxModule,
    // Cola del set de pruebas DIAN. Se registra en CADA módulo que declara
    // `DianTestService` en sus providers, porque Nest instancia el servicio una
    // vez por módulo y cada instancia necesita resolver su `@InjectQueue`.
    BullModule.registerQueue({ name: 'dian-test-set' }),
    // Proveedores de los perfiles de facturación. Su CONTROLLER va en el array
    // de abajo, no acá: ver la nota de `profiles.module.ts`.
    ProfilesModule,
  ],
  controllers: [
    DianConfigController,
    // QUI-657 — cola de plataforma para tramitar certificados de firma de los
    // tenants que no tienen uno. Vive en este módulo (no en super-admin) porque
    // reutiliza `DianConfigService` y el adaptador de validación de certificados
    // sin reexportarlos; su prefijo de ruta y su permiso sí son de plataforma.
    SuperAdminCertificatesPendingController,
    ResolutionsController,
    // ANTES de `InvoicingController`, igual que resolutions y dian-config, y por
    // el mismo motivo verificado: `InvoicingController` monta en `store/invoicing`
    // con `@Get(':id')`, así que registrado primero atrapa
    // `GET /api/store/invoicing/profiles` y `ParseIntPipe` responde 400 sobre la
    // cadena «profiles». Express resuelve por orden de registro y el orden es la
    // posición en ESTE array. No lo muevas debajo.
    ProfilesController,
    InvoicingController,
    // Superficie fiscal del POS. Controller aparte a propósito: no lleva
    // `@RequireModuleFlow('invoicing')`, porque el indicador del cajero tiene
    // que poder preguntar el estado incluso en una tienda que no factura
    // electrónicamente — y responder «no aplica» en vez de 403.
    PosFiscalController,
  ],
  providers: [
    // Renders the DIAN verification URL as a scannable PNG for the invoice's
    // graphic representation. Registered as a direct provider, matching how
    // `products.module.ts` consumes it — there is no `QrModule` in this repo.
    QrService,
    // Las dos compuertas de emisión (área fiscal activa + habilitación DIAN
    // viva) extraídas de `InvoicingService`, para que el carril de notas de
    // crédito cruce el MISMO predicado y no una copia. Va antes que sus dos
    // consumidores por legibilidad; el orden no importa para Nest.
    InvoiceEmissionGateService,
    InvoicingService,
    InvoiceFlowService,
    CreditNotesService,
    ResolutionsService,
    ResolutionScannerService,
    DianHabilitationScannerService,
    InvoiceNumberGenerator,
    // Motor aritmético único del documento, puerta de identidad fiscal del
    // adquiriente y prevalidador DIAN del documento. Los tres son PUROS —sin
    // Prisma, sin contexto, sin HTTP— y se registran como providers sólo para
    // poder inyectarlos; se pueden instanciar con `new` en un test sin levantar
    // Nest.
    InvoiceCalculatorService,
    CustomerFiscalIdentityValidator,
    FiscalDocumentValidator,
    // TRM oficial (Superintendencia Financiera vía datos abiertos). Singleton de
    // módulo A PROPÓSITO: su caché es de instancia, y una TRM publicada es
    // inmutable, así que una sola instancia sirve a todas las tiendas sin
    // riesgo de mezclar datos de tenants —la TRM no es un dato de tenant—.
    TrmService,
    DianConfigService,
    DianTestService,
    // Cruce entre los rangos que la DIAN tiene autorizados (`GetNumberingRange`)
    // y las `invoice_resolutions` guardadas. Depende de `DianTestService` sólo
    // para la llamada SOAP —credenciales WS-Security incluidas—: aquí vive el
    // parseo, el diff y la escritura, y sobre todo la regla de que la ClTec se
    // compara en el servidor y nunca sale al cliente.
    DianNumberingRangeService,
    // Worker de la cola `dian-test-set`. Se registra SOLO aquí: las otras dos
    // superficies (organización y plataforma) reusan este mismo servicio, y un
    // worker por módulo levantaría tres consumidores para la misma cola.
    DianTestSetProcessor,
    InvoicePdfService,
    DianEventsService,
    InvoiceRetryQueueService,
    InvoiceRetryListener,
    FiscalTransmissionLedgerService,
    ManualCertificateIssuerAdapter,
    ModuleFlowGuard,
    // Carril del POS: emisión desacoplada del cobro + el oyente que la dispara
    // después del commit de la venta.
    PosFiscalEmissionService,
    PosSaleCompletedListener,
  ],
  exports: [
    InvoicingService,
    InvoiceFlowService,
    CreditNotesService,
    InvoicePdfService,
    DianEventsService,
    InvoiceRetryQueueService,
    FiscalTransmissionLedgerService,
    PosFiscalEmissionService,
    // Exported so `DianTestSetRepollJob` can re-poll DIAN for a pending
    // habilitación batch without a second copy of the WS-Security credential
    // loading and the persistence rules.
    DianTestService,
  ],
})
export class InvoicingModule {}
