import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../../../prisma/prisma.module';
import { PaymentsModule } from '../../payments.module';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { PaymentEncryptionService } from '../../services/payment-encryption.service';
import { WompiClientFactory } from './wompi.factory';
import { WompiProcessor } from './wompi.processor';

@Module({
  imports: [PrismaModule, forwardRef(() => PaymentsModule)],
  providers: [
    WompiClientFactory,
    {
      provide: WompiProcessor,
      useFactory: (
        factory: WompiClientFactory,
        prisma: StorePrismaService,
        encryption: PaymentEncryptionService,
      ) => new WompiProcessor(factory, prisma, encryption),
      inject: [
        WompiClientFactory,
        StorePrismaService,
        PaymentEncryptionService,
      ],
    },
  ],
  exports: [WompiProcessor, WompiClientFactory],
})
export class WompiModule {}
