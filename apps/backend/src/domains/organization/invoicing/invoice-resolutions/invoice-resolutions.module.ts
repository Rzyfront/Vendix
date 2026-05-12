import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { OrgInvoiceResolutionsController } from './invoice-resolutions.controller';
import { OrgInvoiceResolutionsService } from './invoice-resolutions.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [OrgInvoiceResolutionsController],
  providers: [OrgInvoiceResolutionsService],
  exports: [OrgInvoiceResolutionsService],
})
export class OrgInvoiceResolutionsModule {}
