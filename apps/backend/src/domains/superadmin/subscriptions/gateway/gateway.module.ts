import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '../../../../common/responses/response.module';
import { WompiModule } from '../../../store/payments/processors/wompi/wompi.module';
import { PaymentEncryptionService } from '../../../store/payments/services/payment-encryption.service';
import { GatewayController } from './gateway.controller';
import { PlatformGatewayService } from './platform-gateway.service';
import { PlatformWompiConfigValidator } from './validators/platform-wompi-config.validator';
import { PlatformWompiWebhookValidatorService } from './platform-wompi-webhook-validator.service';
import { PlatformWebhookController } from './platform-webhook.controller';

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    WompiModule,
    // SubscriptionsModule (store) is @Global, so SubscriptionWebhookService
    // is reachable without an explicit import. We don't add it here to avoid
    // a circular dependency: subscriptions.module.ts already imports this
    // module via PlatformGatewayModule.
  ],
  controllers: [GatewayController, PlatformWebhookController],
  providers: [
    PaymentEncryptionService,
    PlatformWompiConfigValidator,
    PlatformGatewayService,
    PlatformWompiWebhookValidatorService,
  ],
  exports: [PlatformGatewayService, PlatformWompiWebhookValidatorService],
})
export class PlatformGatewayModule {}
