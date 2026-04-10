import { Module } from '@nestjs/common';
import { InvoiceDataRequestsController } from './invoice-data-requests.controller';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { ResponseModule } from '../../../../common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [InvoiceDataRequestsController],
  providers: [InvoiceDataRequestsService],
  exports: [InvoiceDataRequestsService],
})
export class InvoiceDataRequestsModule {}
