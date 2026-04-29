import { Module, forwardRef } from '@nestjs/common';
import { PaymentLinksController } from './payment-links.controller';
import { PaymentLinksService } from './payment-links.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { WompiModule } from '../payments/processors/wompi/wompi.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    forwardRef(() => WompiModule),
    forwardRef(() => PaymentsModule),
  ],
  controllers: [PaymentLinksController],
  providers: [PaymentLinksService],
  exports: [PaymentLinksService],
})
export class PaymentLinksModule {}
