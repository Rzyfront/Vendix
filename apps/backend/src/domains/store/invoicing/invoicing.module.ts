import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InvoiceProviderModule } from './providers/invoice-provider.module';
import { DianDirectModule } from './providers/dian-direct/dian-direct.module';
import { InvoicingController } from './invoicing.controller';
import { ResolutionsController } from './resolutions/resolutions.controller';
import { DianConfigController } from './dian-config/dian-config.controller';
import { InvoicingService } from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { CreditNotesService } from './credit-notes/credit-notes.service';
import { ResolutionsService } from './resolutions/resolutions.service';
import { ResolutionScannerService } from './resolutions/resolution-scanner.service';
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';
import { DianConfigService } from './dian-config/dian-config.service';
import { BullModule } from '@nestjs/bullmq';
import { DianTestSetProcessor } from './dian-config/dian-test-set.processor';
import { DianTestService } from './dian-config/dian-test.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { DianEventsService } from './services/dian-events.service';
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';
import { InvoiceRetryListener } from './services/invoice-retry.listener';
import { FiscalTransmissionLedgerService } from './services/fiscal-transmission-ledger.service';
import { ManualCertificateIssuerAdapter } from './dian-config/certificates/manual-certificate-issuer.adapter';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';
import { WithholdingTaxModule } from '../withholding-tax/withholding-tax.module';

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
  ],
  controllers: [
    DianConfigController,
    ResolutionsController,
    InvoicingController,
  ],
  providers: [
    InvoicingService,
    InvoiceFlowService,
    CreditNotesService,
    ResolutionsService,
    ResolutionScannerService,
    InvoiceNumberGenerator,
    DianConfigService,
    DianTestService,
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
  ],
  exports: [
    InvoicingService,
    InvoiceFlowService,
    CreditNotesService,
    InvoicePdfService,
    DianEventsService,
    InvoiceRetryQueueService,
    FiscalTransmissionLedgerService,
    // Exported so `DianTestSetRepollJob` can re-poll DIAN for a pending
    // habilitación batch without a second copy of the WS-Security credential
    // loading and the persistence rules.
    DianTestService,
  ],
})
export class InvoicingModule {}
