import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { PlatformOrgService } from '../../../common/services/platform-org.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { DianDirectModule } from '../../store/invoicing/providers/dian-direct/dian-direct.module';

import { VendorSupportDocumentsController } from './vendor-support-documents/vendor-support-documents.controller';
import { VendorSupportDocumentsService } from './vendor-support-documents/vendor-support-documents.service';
import { VendorSupportFiscalService } from './vendor-support-documents/vendor-support-fiscal.service';
import { VendorSupportFiscalListener } from './vendor-support-documents/vendor-support-fiscal.listener';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, DianDirectModule],
  controllers: [VendorSupportDocumentsController],
  providers: [
    VendorSupportDocumentsService,
    VendorSupportFiscalService,
    VendorSupportFiscalListener,
    PlatformOrgService,
    GlobalPrismaService,
  ],
  exports: [VendorSupportDocumentsService, VendorSupportFiscalService],
})
export class SuperadminInvoicingModule {}
