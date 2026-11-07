import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { PaymentRequestsController } from './payment-requests.controller';
import { PaymentRequestsService } from './payment-requests.service';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, PaymentLinksModule],
  controllers: [PaymentRequestsController],
  providers: [PaymentRequestsService],
  exports: [PaymentRequestsService],
})
export class PaymentRequestsModule {}
