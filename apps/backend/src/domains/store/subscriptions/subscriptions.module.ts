import { Global, Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { SubscriptionResolverService } from './services/subscription-resolver.service';
import { SubscriptionAccessService } from './services/subscription-access.service';
import { SubscriptionStateService } from './services/subscription-state.service';
import { SubscriptionAccessController } from './controllers/subscription-access.controller';
import { StoreSubscriptionsController } from './controllers/store-subscriptions.controller';
import { SubscriptionCheckoutController } from './controllers/subscription-checkout.controller';
import { AiAccessGuard } from './guards/ai-access.guard';
import { SubscriptionBillingService } from './services/subscription-billing.service';
import { SubscriptionPaymentService } from './services/subscription-payment.service';
import { SubscriptionWebhookService } from './services/subscription-webhook.service';
import { SubscriptionProrationService } from './services/subscription-proration.service';
import { PromotionalApplyService } from './services/promotional-apply.service';
import { PromotionalRulesEvaluator } from './evaluators/promotional-rules.evaluator';
import { PartnerCommissionsService } from './services/partner-commissions.service';
import { SubscriptionTrialService } from './services/subscription-trial.service';
import { PaymentsModule } from '../payments/payments.module';
import { WompiModule } from '../payments/processors/wompi/wompi.module';
import { PlatformGatewayModule } from '../../superadmin/subscriptions/gateway/gateway.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    forwardRef(() => PaymentsModule),
    // SaaS billing path: WompiProcessor (called directly, bypassing
    // per-store PaymentGatewayService) + PlatformGatewayService for
    // platform-level credentials.
    WompiModule,
    PlatformGatewayModule,
  ],
  controllers: [SubscriptionAccessController, StoreSubscriptionsController, SubscriptionCheckoutController],
  providers: [
    SubscriptionResolverService,
    SubscriptionAccessService,
    SubscriptionStateService,
    AiAccessGuard,
    SubscriptionBillingService,
    SubscriptionPaymentService,
    SubscriptionWebhookService,
    SubscriptionProrationService,
    PromotionalApplyService,
    PromotionalRulesEvaluator,
    PartnerCommissionsService,
    SubscriptionTrialService,
  ],
  exports: [
    SubscriptionResolverService,
    SubscriptionAccessService,
    SubscriptionStateService,
    AiAccessGuard,
    SubscriptionBillingService,
    SubscriptionPaymentService,
    SubscriptionWebhookService,
    SubscriptionProrationService,
    PromotionalApplyService,
    PartnerCommissionsService,
    SubscriptionTrialService,
  ],
})
export class SubscriptionsModule {}
