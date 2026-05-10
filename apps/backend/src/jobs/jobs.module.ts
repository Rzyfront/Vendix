import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { OrderAutoFinishJob } from './order-auto-finish.job';
import { OrderFlowModule } from '../domains/store/orders/order-flow/order-flow.module';
import { LayawayOverdueJob } from './layaway-overdue.job';
import { LayawayRemindersJob } from './layaway-reminders.job';
import { DepreciationMonthlyJob } from './depreciation-monthly.job';
import { DataRetentionJob } from './data-retention.job';
import { CertificateExpiryAlertJob } from './certificate-expiry-alert.job';
import { InvoiceRetryJob } from './invoice-retry.job';
import { BookingRemindersJob } from './booking-reminders.job';
import { BookingConfirmationJob } from './booking-confirmation.job';
import { EmbeddingSyncJob } from './embedding-sync.job';
import { ArAgingUpdateJob } from './ar-aging-update.job';
import { ApAgingUpdateJob } from './ap-aging-update.job';
import { PaymentTimeoutCleanupJob } from './payment-timeout-cleanup.job';
import { QueueExpiryCleanupJob } from './queue-expiry-cleanup.job';
import { SubscriptionStateEngineJob } from './subscription-state-engine.job';
import { SubscriptionRenewalBillingJob } from './subscription-renewal-billing.job';
import { SubscriptionReminderDispatchJob } from './subscription-reminder-dispatch.job';
import { SubscriptionPaymentRetryJob } from './subscription-payment-retry.job';
import { SubscriptionWebhookReconcilerJob } from './subscription-webhook-reconciler.job';
import { SubscriptionWebhookReconcilerController } from './subscription-webhook-reconciler.controller';
import { SubscriptionTrialNotifierJob } from './subscription-trial-notifier.job';
import { PaymentMethodExpiryNotifierJob } from './payment-method-expiry-notifier.job';
import { PromotionalActivationJob } from './promotional-activation.job';
import { PartnerPayoutBatchJob } from './partner-payout-batch.job';
import { CommissionAccrualJob } from './commission-accrual.job';
import { SubscriptionDraftCleanupJob } from './subscription-draft-cleanup.job';
import { SaasMetricsSnapshotJob } from './saas-metrics-snapshot.job';
import { FiscalObligationDetectorJob } from './fiscal-obligation-detector.job';
import { FiscalStatusListener } from './fiscal-status.listener';
import { FiscalStatusService } from '../common/services/fiscal-status.service';
// PaymentConfirmedEmailJob is intentionally NOT imported here. Its handler
// logic (job name `payment.confirmed.email`) was consolidated into
// `EmailNotificationsProcessor` (G10). Registering both as
// `@Processor('email-notifications')` would create two competing WorkerHosts
// on the same queue and roughly half of every job kind would be picked up by
// the wrong worker (and logged as "Unknown email job"). The file is kept on
// disk for git history and may be removed in a follow-up cleanup.
// import { PaymentConfirmedEmailJob } from './payment-confirmed-email.job';
import { EmailNotificationsProcessor } from './email-notifications.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../domains/store/subscriptions/subscriptions.module';
import { EmailModule } from '../email/email.module';
import { WompiModule } from '../domains/store/payments/processors/wompi/wompi.module';
import { PlatformGatewayModule } from '../domains/superadmin/subscriptions/gateway/gateway.module';
import { ResponseModule } from '../common/responses/response.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OrderFlowModule,
    PrismaModule,
    SubscriptionsModule,
    EmailModule,
    // Direct imports needed by SubscriptionWebhookReconcilerJob:
    // SubscriptionsModule is @Global but does NOT re-export WompiProcessor /
    // PlatformGatewayService — pull them in explicitly here.
    WompiModule,
    PlatformGatewayModule,
    ResponseModule,
    BullModule.registerQueue(
      { name: 'ai-embedding' },
      { name: 'subscription-payment-retry' },
      { name: 'commission-accrual' },
      { name: 'email-notifications' },
    ),
  ],
  controllers: [SubscriptionWebhookReconcilerController],
  providers: [
    OrderAutoFinishJob,
    LayawayOverdueJob,
    LayawayRemindersJob,
    DepreciationMonthlyJob,
    DataRetentionJob,
    CertificateExpiryAlertJob,
    InvoiceRetryJob,
    BookingRemindersJob,
    BookingConfirmationJob,
    EmbeddingSyncJob,
    ArAgingUpdateJob,
    ApAgingUpdateJob,
    PaymentTimeoutCleanupJob,
    QueueExpiryCleanupJob,
    SubscriptionStateEngineJob,
    SubscriptionRenewalBillingJob,
    SubscriptionReminderDispatchJob,
    SubscriptionPaymentRetryJob,
    SubscriptionWebhookReconcilerJob,
    SubscriptionTrialNotifierJob,
    PaymentMethodExpiryNotifierJob,
    PromotionalActivationJob,
    PartnerPayoutBatchJob,
    CommissionAccrualJob,
    SubscriptionDraftCleanupJob,
    SaasMetricsSnapshotJob,
    FiscalStatusService,
    FiscalObligationDetectorJob,
    FiscalStatusListener,
    EmailNotificationsProcessor,
  ],
})
export class JobsModule {}
