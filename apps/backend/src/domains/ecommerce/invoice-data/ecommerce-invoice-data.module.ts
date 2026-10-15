import { AddressesModule } from '../../store/addresses/addresses.module';
import { CustomersModule } from '../../store/customers/customers.module';
import { Module } from '@nestjs/common';
import { EcommerceInvoiceDataController } from './ecommerce-invoice-data.controller';
import { InvoiceDataRequestsModule } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [
    AddressesModule,
    CustomersModule,
    InvoiceDataRequestsModule,
    NotificationsModule,
    ResponseModule,
  ],
  controllers: [EcommerceInvoiceDataController],
})
export class EcommerceInvoiceDataModule {}
