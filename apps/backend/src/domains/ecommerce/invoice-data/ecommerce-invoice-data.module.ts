import { Module } from '@nestjs/common';
import { EcommerceInvoiceDataController } from './ecommerce-invoice-data.controller';
import { InvoiceDataRequestsModule } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [InvoiceDataRequestsModule, NotificationsModule, ResponseModule],
  controllers: [EcommerceInvoiceDataController],
})
export class EcommerceInvoiceDataModule {}
