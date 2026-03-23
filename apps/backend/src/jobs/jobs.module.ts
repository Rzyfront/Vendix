import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OrderAutoFinishJob } from './order-auto-finish.job';
import { OrderFlowModule } from '../domains/store/orders/order-flow/order-flow.module';
import { LayawayOverdueJob } from './layaway-overdue.job';
import { LayawayRemindersJob } from './layaway-reminders.job';
import { CreditOverdueCheckJob } from './credit-overdue-check.job';
import { CreditRemindersJob } from './credit-reminders.job';
import { DepreciationMonthlyJob } from './depreciation-monthly.job';
import { DataRetentionJob } from './data-retention.job';
import { CertificateExpiryAlertJob } from './certificate-expiry-alert.job';
import { InvoiceRetryJob } from './invoice-retry.job';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    OrderFlowModule,
    PrismaModule,
  ],
  providers: [
    OrderAutoFinishJob,
    LayawayOverdueJob,
    LayawayRemindersJob,
    CreditOverdueCheckJob,
    CreditRemindersJob,
    DepreciationMonthlyJob,
    DataRetentionJob,
    CertificateExpiryAlertJob,
    InvoiceRetryJob,
  ],
})
export class JobsModule {}
