import { Module } from '@nestjs/common';
import { PaymentPoliciesController } from './payment-policies.controller';
import { PaymentPoliciesService } from './payment-policies.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { S3Service } from '@common/services/s3.service';

@Module({
  imports: [],
  controllers: [PaymentPoliciesController],
  providers: [PaymentPoliciesService, OrganizationPrismaService, S3Service],
  exports: [PaymentPoliciesService],
})
export class PaymentPoliciesModule { }
