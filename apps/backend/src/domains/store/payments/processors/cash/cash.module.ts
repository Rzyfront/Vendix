import { Module } from '@nestjs/common';
import { CashPaymentProcessor } from './cash.processor';

@Module({
  providers: [CashPaymentProcessor],
  exports: [CashPaymentProcessor],
})
export class CashPaymentModule {}
