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
import { PromotionalActivationJob } from './promotional-activation.job';
import { PartnerPayoutBatchJob } from './partner-payout-batch.job';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionsModule } from '../domains/store/subscriptions/subscriptions.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OrderFlowModule,
    PrismaModule,
    SubscriptionsModule,
    BullModule.registerQueue(
      { name: 'ai-embedding' },
      { name: 'subscription-payment-retry' },
    ),
  ],
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
    PromotionalActivationJob,
    PartnerPayoutBatchJob,
  ],
})
export class JobsModule {}
