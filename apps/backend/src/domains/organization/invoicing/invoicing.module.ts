import { Module } from '@nestjs/common';
import { OrgDianConfigModule } from './dian-config/dian-config.module';
import { OrgInvoiceResolutionsModule } from './invoice-resolutions/invoice-resolutions.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { OrgInvoicingController } from './invoicing.controller';
import { OrgInvoicingService } from './invoicing.service';
import { ReceivedDocumentsModule as SharedReceivedDocumentsModule } from '../../received-documents/received-documents.module';
import { OrganizationReceivedDocumentsController } from '../../received-documents/organization-received-documents.controller';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    OrgDianConfigModule,
    OrgInvoiceResolutionsModule,
    SharedReceivedDocumentsModule,
  ],
  controllers: [OrganizationReceivedDocumentsController, OrgInvoicingController],
  providers: [OrgInvoicingService],
  exports: [
    OrgDianConfigModule,
    OrgInvoiceResolutionsModule,
    OrgInvoicingService,
  ],
})
export class OrgInvoicingModule {}
