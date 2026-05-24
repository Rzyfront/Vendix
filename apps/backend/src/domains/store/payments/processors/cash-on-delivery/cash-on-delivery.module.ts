import { Module } from '@nestjs/common';
import { CashOnDeliveryPaymentProcessor } from './cash-on-delivery.processor';

@Module({
  providers: [CashOnDeliveryPaymentProcessor],
  exports: [CashOnDeliveryPaymentProcessor],
})
export class CashOnDeliveryPaymentModule {}
