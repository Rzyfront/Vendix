import { Module } from '@nestjs/common';
import { PaymentPoliciesController } from './payment-policies.controller';
import { PaymentPoliciesService } from './payment-policies.service';

@Module({
  imports: [],
  controllers: [PaymentPoliciesController],
  providers: [PaymentPoliciesService],
  exports: [PaymentPoliciesService],
})
export class PaymentPoliciesModule {}
