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
import { EmbeddingSyncJob } from './embedding-sync.job';
import { ArAgingUpdateJob } from './ar-aging-update.job';
import { ApAgingUpdateJob } from './ap-aging-update.job';
import { PaymentTimeoutCleanupJob } from './payment-timeout-cleanup.job';
import { QueueExpiryCleanupJob } from './queue-expiry-cleanup.job';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OrderFlowModule,
    PrismaModule,
    BullModule.registerQueue({ name: 'ai-embedding' }),
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
    EmbeddingSyncJob,
    ArAgingUpdateJob,
    ApAgingUpdateJob,
    PaymentTimeoutCleanupJob,
    QueueExpiryCleanupJob,
  ],
})
export class JobsModule {}
