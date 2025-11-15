import { Module } from '@nestjs/common';
import { PaypalProcessor } from './paypal.processor';

@Module({
  providers: [PaypalProcessor],
  exports: [PaypalProcessor],
})
export class PaypalModule {}
