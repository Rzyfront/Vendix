import { Module } from '@nestjs/common';
import { StripeProcessor } from './stripe.processor';

@Module({
  providers: [StripeProcessor],
  exports: [StripeProcessor],
})
export class StripeModule {}
