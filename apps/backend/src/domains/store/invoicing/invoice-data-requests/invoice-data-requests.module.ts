import { Module } from '@nestjs/common';
import { InvoiceDataRequestsController } from './invoice-data-requests.controller';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { InvoiceDataRequestSubmittedListener } from './invoice-data-request-submitted.listener';
import { ResponseModule } from '../../../../common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InvoicingModule } from '../invoicing.module';

@Module({
  imports: [ResponseModule, PrismaModule, InvoicingModule],
  controllers: [InvoiceDataRequestsController],
  providers: [InvoiceDataRequestsService, InvoiceDataRequestSubmittedListener],
  exports: [InvoiceDataRequestsService],
})
export class InvoiceDataRequestsModule {}
