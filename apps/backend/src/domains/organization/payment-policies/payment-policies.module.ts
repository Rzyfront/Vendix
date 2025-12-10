import { Module } from '@nestjs/common';
import { PaymentPoliciesController } from './payment-policies.controller';
import { PaymentPoliciesService } from './payment-policies.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';

@Module({
  imports: [],
  controllers: [PaymentPoliciesController],
  providers: [PaymentPoliciesService, OrganizationPrismaService],
  exports: [PaymentPoliciesService],
})
export class PaymentPoliciesModule {}
