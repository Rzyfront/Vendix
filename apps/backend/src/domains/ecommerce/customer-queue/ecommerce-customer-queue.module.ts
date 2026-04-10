import { Module } from '@nestjs/common';
import { EcommerceCustomerQueueController } from './ecommerce-customer-queue.controller';
import { CustomerQueueModule } from '../../store/customer-queue/customer-queue.module';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
  imports: [CustomerQueueModule, ResponseModule],
  controllers: [EcommerceCustomerQueueController],
})
export class EcommerceCustomerQueueModule {}
