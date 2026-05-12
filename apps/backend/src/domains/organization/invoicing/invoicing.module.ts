import { Module } from '@nestjs/common';
import { OrgDianConfigModule } from './dian-config/dian-config.module';
import { OrgInvoiceResolutionsModule } from './invoice-resolutions/invoice-resolutions.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { OrgInvoicingController } from './invoicing.controller';
import { OrgInvoicingService } from './invoicing.service';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    OrgDianConfigModule,
    OrgInvoiceResolutionsModule,
  ],
  controllers: [OrgInvoicingController],
  providers: [OrgInvoicingService],
  exports: [
    OrgDianConfigModule,
    OrgInvoiceResolutionsModule,
    OrgInvoicingService,
  ],
})
export class OrgInvoicingModule {}
