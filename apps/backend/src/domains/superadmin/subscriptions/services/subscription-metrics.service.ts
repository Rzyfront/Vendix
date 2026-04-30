import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

const ACTIVE_STATES: Prisma.store_subscriptionsWhereInput['state'] = {
  in: ['active', 'trial', 'grace_soft', 'grace_hard'],
};

const CHURN_STATES = ['cancelled', 'expired'] as const;

export interface MRRResult {
  value: Prisma.Decimal;
  currency: string;
  monthly_avg: Prisma.Decimal;
}

export interface ChurnResult {
  rate_pct: number;
  cancelled_count: number;
  active_at_start: number;
}

export interface ARPUResult {
  value: Prisma.Decimal;
  currency: string;
  active_subs: number;
}

export interface LTVResult {
  value: Prisma.Decimal | null;
  currency: string;
}

export interface ActiveBreakdownResult {
  by_state: Record<string, number>;
  by_plan: Array<{ plan_id: number; plan_name: string; count: number }>;
}

export interface MRREvolutionPoint {
  month: string; // YYYY-MM
  mrr: Prisma.Decimal;
}

/**
 * SaaS metrics for superadmin dashboard.
 *
 * MRR: sum of paid invoice totals in period / months in period.
 * Churn: cancellations in period / active subs at period start.
 * ARPU: MRR / active subs at period start.
 * LTV: ARPU / churn_rate (null when churn=0).
 *
 * All money math via Prisma.Decimal (vendix-saas-billing skill).
 * Period boundaries assumed UTC-safe (vendix-date-timezone).
 */
@Injectable()
export class SubscriptionMetricsService {
  private readonly currency = 'COP';

  constructor(private readonly prisma: GlobalPrismaService) {}

  // ─── MRR ───────────────────────────────────────────────────────────
  async getMRR(periodStart: Date, periodEnd: Date): Promise<MRRResult> {
    const agg = await this.prisma.subscription_invoices.aggregate({
      where: {
        state: 'paid',
        period_start: { gte: periodStart },
        period_end: { lte: periodEnd },
      },
      _sum: { total: true },
    });

    const total = agg._sum.total ?? new Prisma.Decimal(0);
    const months = this.monthsBetween(periodStart, periodEnd);
    const monthlyAvg = total.div(new Prisma.Decimal(Math.max(1, months)));

    return {
      value: total,
      currency: this.currency,
      monthly_avg: monthlyAvg,
    };
  }

  // ─── Churn ─────────────────────────────────────────────────────────
  async getChurnRate(periodStart: Date, periodEnd: Date): Promise<ChurnResult> {
    // Cancellations within the period via subscription_events
    const cancelledEvents = await this.prisma.subscription_events.findMany({
      where: {
        created_at: { gte: periodStart, lte: periodEnd },
        OR: [
          { type: 'cancelled' },
          {
            type: 'state_transition',
            to_state: { in: [...CHURN_STATES] },
          },
        ],
      },
      select: { store_subscription_id: true },
      distinct: ['store_subscription_id'],
    });
    const cancelledCount = cancelledEvents.length;

    // Active subs at period start: subs created before periodStart and
    // still alive at periodStart (i.e. not yet cancelled/expired before that).
    // Approximation: subs in active/trial/grace_* whose started_at < periodStart,
    // OR subs currently in cancelled/expired but whose cancelled_at >= periodStart.
    const activeAtStart = await this.prisma.store_subscriptions.count({
      where: {
        OR: [
          {
            state: { in: ['active', 'trial', 'grace_soft', 'grace_hard'] },
            started_at: { lt: periodStart },
          },
          {
            state: { in: [...CHURN_STATES] },
            started_at: { lt: periodStart },
            cancelled_at: { gte: periodStart },
          },
        ],
      },
    });

    const ratePct =
      activeAtStart > 0
        ? Math.round((cancelledCount / activeAtStart) * 10000) / 100
        : 0;

    return {
      rate_pct: ratePct,
      cancelled_count: cancelledCount,
      active_at_start: activeAtStart,
    };
  }

  // ─── ARPU ──────────────────────────────────────────────────────────
  async getARPU(periodStart: Date, periodEnd: Date): Promise<ARPUResult> {
    const [mrr, activeSubs] = await Promise.all([
      this.getMRR(periodStart, periodEnd),
      this.prisma.store_subscriptions.count({
        where: {
          state: 'active',
          started_at: { lt: periodStart },
        },
      }),
    ]);

    const denom = new Prisma.Decimal(Math.max(1, activeSubs));
    const arpu = mrr.value.div(denom);

    return {
      value: arpu,
      currency: this.currency,
      active_subs: activeSubs,
    };
  }

  // ─── LTV ───────────────────────────────────────────────────────────
  async getLTV(periodStart: Date, periodEnd: Date): Promise<LTVResult> {
    const [arpu, churn] = await Promise.all([
      this.getARPU(periodStart, periodEnd),
      this.getChurnRate(periodStart, periodEnd),
    ]);

    if (!churn.rate_pct || churn.rate_pct <= 0) {
      return { value: null, currency: this.currency };
    }

    // LTV = ARPU / (churn_rate / 100)
    const churnDecimal = new Prisma.Decimal(churn.rate_pct).div(100);
    const ltv = arpu.value.div(churnDecimal);

    return { value: ltv, currency: this.currency };
  }

  // ─── Active Breakdown ──────────────────────────────────────────────
  async getActiveBreakdown(): Promise<ActiveBreakdownResult> {
    const [byStateRows, byPlanRows] = await Promise.all([
      this.prisma.store_subscriptions.groupBy({
        by: ['state'],
        _count: { _all: true },
      }),
      this.prisma.store_subscriptions.groupBy({
        by: ['plan_id'],
        where: { state: { in: ['active', 'trial', 'grace_soft'] } },
        _count: { _all: true },
      }),
    ]);

    const by_state: Record<string, number> = {};
    for (const row of byStateRows) {
      by_state[String(row.state)] = row._count._all;
    }

    // RNC-39: plan_id may be null (no_plan rows). Filter those out — they
    // are surfaced separately via the by_state breakdown and have no plan
    // metadata to display.
    const planIds = byPlanRows
      .map((r) => r.plan_id)
      .filter((id): id is number => id !== null);
    const plans = planIds.length
      ? await this.prisma.subscription_plans.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true },
        })
      : [];
    const planNameById = new Map(plans.map((p) => [p.id, p.name] as const));

    const by_plan = byPlanRows
      .filter(
        (row): row is typeof row & { plan_id: number } => row.plan_id !== null,
      )
      .map((row) => ({
        plan_id: row.plan_id,
        plan_name: planNameById.get(row.plan_id) ?? `Plan #${row.plan_id}`,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return { by_state, by_plan };
  }

  // ─── MRR Evolution ─────────────────────────────────────────────────
  async getMRREvolution(months = 12): Promise<MRREvolutionPoint[]> {
    const safeMonths = Math.max(1, Math.min(months, 36));
    const now = new Date();
    const buckets: Array<{ start: Date; end: Date; key: string }> = [];

    for (let i = safeMonths - 1; i >= 0; i--) {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1, 0, 0, 0, 0),
      );
      const end = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() - i + 1,
          1,
          0,
          0,
          0,
          0,
        ),
      );
      const key = `${start.getUTCFullYear()}-${String(
        start.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
      buckets.push({ start, end, key });
    }

    const overallStart = buckets[0].start;
    const overallEnd = buckets[buckets.length - 1].end;

    const invoices = await this.prisma.subscription_invoices.findMany({
      where: {
        state: 'paid',
        period_start: { gte: overallStart, lt: overallEnd },
      },
      select: { total: true, period_start: true },
    });

    const totals = new Map<string, Prisma.Decimal>();
    for (const b of buckets) totals.set(b.key, new Prisma.Decimal(0));

    for (const inv of invoices) {
      const d = inv.period_start;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const existing = totals.get(key);
      if (existing) {
        totals.set(key, existing.add(inv.total));
      }
    }

    return buckets.map((b) => ({
      month: b.key,
      mrr: totals.get(b.key) ?? new Prisma.Decimal(0),
    }));
  }

  // ─── helpers ───────────────────────────────────────────────────────
  private monthsBetween(start: Date, end: Date): number {
    if (end.getTime() <= start.getTime()) return 1;
    const ms = end.getTime() - start.getTime();
    const days = ms / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.round(days / 30.4375));
  }
}
