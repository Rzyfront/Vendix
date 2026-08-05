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
