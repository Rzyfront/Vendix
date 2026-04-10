import { Module } from '@nestjs/common';
import { EcommerceInvoiceDataController } from './ecommerce-invoice-data.controller';
import { InvoiceDataRequestsModule } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [InvoiceDataRequestsModule, ResponseModule],
  controllers: [EcommerceInvoiceDataController],
})
export class EcommerceInvoiceDataModule {}
