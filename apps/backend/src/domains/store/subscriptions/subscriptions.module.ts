import { Global, Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { SubscriptionResolverService } from './services/subscription-resolver.service';
import { SubscriptionAccessService } from './services/subscription-access.service';
import { SubscriptionStateService } from './services/subscription-state.service';
import { SubscriptionAccessController } from './controllers/subscription-access.controller';
import { StoreSubscriptionsController } from './controllers/store-subscriptions.controller';
import { SubscriptionCheckoutController } from './controllers/subscription-checkout.controller';
import { AiAccessGuard } from './guards/ai-access.guard';
import { StoreOperationsGuard } from './guards/store-operations.guard';
import { SubscriptionBillingService } from './services/subscription-billing.service';
import { SubscriptionPaymentService } from './services/subscription-payment.service';
import { SubscriptionWebhookService } from './services/subscription-webhook.service';
import { SubscriptionProrationService } from './services/subscription-proration.service';
import { PromotionalApplyService } from './services/promotional-apply.service';
import { PromotionalRulesEvaluator } from './evaluators/promotional-rules.evaluator';
import { PartnerCommissionsService } from './services/partner-commissions.service';
import { SubscriptionTrialService } from './services/subscription-trial.service';
import { SubscriptionPaymentMethodsService } from './services/subscription-payment-methods.service';
import { SubscriptionInvoicePdfService } from './services/subscription-invoice-pdf.service';
import { SubscriptionStateListener } from './listeners/subscription-state.listener';
import { ReconcileStuckPendingJob } from './jobs/reconcile-stuck-pending.job';
import { SubscriptionGateConfig } from './config/subscription-gate.config';
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
    BullModule.registerQueue(
      { name: 'commission-accrual' },
      { name: 'email-notifications' },
    ),
  ],
  controllers: [
    SubscriptionAccessController,
    StoreSubscriptionsController,
    SubscriptionCheckoutController,
  ],
  providers: [
    SubscriptionResolverService,
    SubscriptionAccessService,
    SubscriptionStateService,
    AiAccessGuard,
    StoreOperationsGuard,
    SubscriptionGateConfig,
    SubscriptionBillingService,
    SubscriptionPaymentService,
    SubscriptionWebhookService,
    SubscriptionProrationService,
    PromotionalApplyService,
    PromotionalRulesEvaluator,
    PartnerCommissionsService,
    SubscriptionTrialService,
    SubscriptionPaymentMethodsService,
    SubscriptionInvoicePdfService,
    // Listener: auto-promotes pending_payment / grace_* / blocked subs to
    // `active` on `subscription.payment.succeeded`. Registered as a provider
    // so NestJS instantiates it; the @OnEvent decorator wires the
    // EventEmitterModule subscription.
    SubscriptionStateListener,
    // Cron safety-net: catches subscriptions stuck in pending_payment whose
    // last payment is already succeeded (synchronous webhook promotion +
    // listener both missed). Runs every 5 minutes, idempotent.
    // ScheduleModule.forRoot() is loaded once from JobsModule; the cron
    // registry is global so registering this provider here is enough.
    ReconcileStuckPendingJob,
  ],
  exports: [
    SubscriptionResolverService,
    SubscriptionAccessService,
    SubscriptionStateService,
    AiAccessGuard,
    StoreOperationsGuard,
    SubscriptionGateConfig,
    SubscriptionBillingService,
    SubscriptionPaymentService,
    SubscriptionWebhookService,
    SubscriptionProrationService,
    PromotionalApplyService,
    PartnerCommissionsService,
    SubscriptionTrialService,
    SubscriptionPaymentMethodsService,
    SubscriptionInvoicePdfService,
  ],
})
export class SubscriptionsModule {}
