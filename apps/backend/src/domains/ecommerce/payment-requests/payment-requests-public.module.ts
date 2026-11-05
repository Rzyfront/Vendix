import { Module } from '@nestjs/common';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PaymentLinksModule } from '../../store/payment-links/payment-links.module';
import { PaymentRequestsPublicController } from './payment-requests-public.controller';
import { PaymentRequestsPublicService } from './payment-requests-public.service';

@Module({
  imports: [PrismaModule, S3Module, PaymentLinksModule],
  controllers: [PaymentRequestsPublicController],
  providers: [PaymentRequestsPublicService, S3PathHelper],
})
export class PaymentRequestsPublicModule {}
