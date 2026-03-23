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
import { InvoiceNumberGenerator } from './utils/invoice-number-generator';
import { DianConfigService } from './dian-config/dian-config.service';
import { DianTestService } from './dian-config/dian-test.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { InvoiceRetryQueueService } from './services/invoice-retry-queue.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    InvoiceProviderModule,
    DianDirectModule,
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
    InvoiceNumberGenerator,
    DianConfigService,
    DianTestService,
    InvoicePdfService,
    InvoiceRetryQueueService,
  ],
  exports: [InvoicingService, InvoiceFlowService, InvoicePdfService, InvoiceRetryQueueService],
})
export class InvoicingModule {}
