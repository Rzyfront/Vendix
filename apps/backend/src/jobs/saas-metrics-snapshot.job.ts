import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

/**
 * RNC-34: Monthly MRR/ARR snapshot. Runs on the 1st of each month at 02:00 UTC.
 * Materializes key SaaS metrics into saas_metrics_snapshot for historical
 * reporting without recalculating from raw data.
 */
@Injectable()
export class SaasMetricsSnapshotJob {
  private readonly logger = new Logger(SaasMetricsSnapshotJob.name);
  private isRunning = false;

  constructor(private readonly prisma: GlobalPrismaService) {}

  @Cron('0 2 1 * *')
  async handleMonthlySnapshot(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Metrics snapshot job already running, skipping');
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
    } catch (err: any) {
      this.logger.error(
        `Metrics snapshot batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  async runOnce(): Promise<void> {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    // Get previous month for churn calculation
    const prevMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const prevYearMonth = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}`;

    const activeSubs = await this.prisma
      .withoutScope()
      .store_subscriptions.count({
        where: {
          state: { in: ['active', 'trial', 'grace_soft', 'grace_hard'] },
        },
      });

    // MRR: sum of effective_price for active monthly subscriptions + prorated quarterly/annual
    // RNC-39: exclude no_plan subscriptions (plan_id IS NULL) from MRR.
    const activePriced = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: { in: ['active', 'grace_soft', 'grace_hard'] },
          plan_id: { not: null },
        },
        select: {
          effective_price: true,
          plan: { select: { billing_cycle: true } },
        },
      });

    let mrr = new Prisma.Decimal(0);
    for (const sub of activePriced) {
      // Defensive: skip if plan join is null (data anomaly).
      if (!sub.plan) continue;
      const price = new Prisma.Decimal(sub.effective_price);
      switch (sub.plan?.billing_cycle) {
        case 'quarterly':
          mrr = mrr.plus(price.dividedBy(3));
          break;
        case 'semiannual':
          mrr = mrr.plus(price.dividedBy(6));
          break;
        case 'annual':
          mrr = mrr.plus(price.dividedBy(12));
          break;
        case 'lifetime':
          break;
        default:
          mrr = mrr.plus(price);
      }
    }
    const arr = mrr.times(12);

    // Churn: voluntary = cancelled by user in prev month
    const churnVoluntary = await this.prisma
      .withoutScope()
      .subscription_events.count({
        where: {
          type: 'cancelled',
          created_at: {
            gte: prevMonth,
            lt: now,
          },
        },
      });

    // Churn involuntary = chargeback/dunning fail in prev month
    const churnInvoluntary = await this.prisma
      .withoutScope()
      .subscription_events.count({
        where: {
          type: 'chargeback_received',
          created_at: {
            gte: prevMonth,
            lt: now,
          },
        },
      });

    // New subscriptions from prev month
    const newSubs = await this.prisma.withoutScope().subscription_events.count({
      where: {
        type: 'activated',
        created_at: {
          gte: prevMonth,
          lt: now,
        },
      },
    });

    // Trial conversions
    const trialConversions = await this.prisma
      .withoutScope()
      .subscription_events.count({
        where: {
          type: 'state_transition',
          from_state: 'trial',
          to_state: 'active',
          created_at: {
            gte: prevMonth,
            lt: now,
          },
        },
      });

    // Total revenue for prev month — subscription_invoices has no paid_at,
    // so derive revenue from successful payments in the period.
    const revenueResult = await this.prisma
      .withoutScope()
      .subscription_payments.aggregate({
        where: {
          state: 'succeeded',
          paid_at: {
            gte: prevMonth,
            lt: now,
          },
        },
        _sum: { amount: true },
      });
    const totalRevenue = revenueResult._sum?.amount ?? new Prisma.Decimal(0);

    // Partner payouts for prev month
    const payoutResult = await this.prisma
      .withoutScope()
      .partner_payout_batches.aggregate({
        where: {
          state: 'paid',
          paid_at: {
            gte: prevMonth,
            lt: now,
          },
        },
        _sum: { total_amount: true },
      });
    const partnerPayouts =
      payoutResult._sum.total_amount ?? new Prisma.Decimal(0);

    await this.prisma.withoutScope().saas_metrics_snapshot.upsert({
      where: { year_month: yearMonth },
      create: {
        year_month: yearMonth,
        snapshot_at: now,
        mrr,
        arr,
        active_subscriptions: activeSubs,
        churn_voluntary: churnVoluntary,
        churn_involuntary: churnInvoluntary,
        new_subscriptions: newSubs,
        trial_conversions: trialConversions,
        total_revenue: totalRevenue,
        partner_payouts_total: partnerPayouts,
      },
      update: {
        snapshot_at: now,
        mrr,
        arr,
        active_subscriptions: activeSubs,
        churn_voluntary: churnVoluntary,
        churn_involuntary: churnInvoluntary,
        new_subscriptions: newSubs,
        trial_conversions: trialConversions,
        total_revenue: totalRevenue,
        partner_payouts_total: partnerPayouts,
      },
    });

    this.logger.log(
      `Metrics snapshot ${yearMonth}: MRR=${mrr.toFixed(2)} ARR=${arr.toFixed(2)} active=${activeSubs} churn_v=${churnVoluntary} churn_i=${churnInvoluntary}`,
    );
  }
}
