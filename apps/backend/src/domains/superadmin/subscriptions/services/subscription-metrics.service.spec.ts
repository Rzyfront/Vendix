import { Prisma } from '@prisma/client';
import { SubscriptionMetricsService } from './subscription-metrics.service';

describe('SubscriptionMetricsService', () => {
  let service: SubscriptionMetricsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      subscription_invoices: {
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      subscription_events: {
        findMany: jest.fn(),
      },
      store_subscriptions: {
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      subscription_plans: {
        findMany: jest.fn(),
      },
    };
    service = new SubscriptionMetricsService(prisma);
  });

  describe('getMRR', () => {
    it('sums paid invoice totals and divides by months in period', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal(900000) }, // 3 invoices x 300k
      });

      const start = new Date('2026-03-01T00:00:00Z');
      const end = new Date('2026-03-31T23:59:59Z'); // ~1 month
      const mrr = await service.getMRR(start, end);

      expect(mrr.value.toString()).toBe('900000');
      expect(mrr.currency).toBe('COP');
      // ~1 month -> monthly_avg ≈ total
      expect(mrr.monthly_avg.toString()).toBe('900000');

      const where =
        prisma.subscription_invoices.aggregate.mock.calls[0][0].where;
      expect(where.state).toBe('paid');
      expect(where.period_start.gte).toEqual(start);
    });

    it('returns 0 when no paid invoices exist', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: null },
      });
      const mrr = await service.getMRR(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-31T23:59:59Z'),
      );
      expect(mrr.value.toString()).toBe('0');
      expect(mrr.monthly_avg.toString()).toBe('0');
    });
  });

  describe('getChurnRate', () => {
    it('computes churn = cancelled / active_at_start * 100', async () => {
      // 1 cancellation distinct sub
      prisma.subscription_events.findMany.mockResolvedValue([
        { store_subscription_id: 42 },
      ]);
      // 5 active at start
      prisma.store_subscriptions.count.mockResolvedValue(5);

      const churn = await service.getChurnRate(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );

      expect(churn.cancelled_count).toBe(1);
      expect(churn.active_at_start).toBe(5);
      expect(churn.rate_pct).toBe(20);
    });

    it('returns 0% when no active subs at start', async () => {
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count.mockResolvedValue(0);

      const churn = await service.getChurnRate(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );
      expect(churn.rate_pct).toBe(0);
    });
  });

  describe('getARPU', () => {
    it('returns mrr / active_subs', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal(1000000) },
      });
      prisma.store_subscriptions.count.mockResolvedValue(10);

      const arpu = await service.getARPU(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );

      expect(arpu.active_subs).toBe(10);
      expect(arpu.value.toString()).toBe('100000');
    });

    it('falls back to dividing by 1 when active_subs = 0', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal(50000) },
      });
      prisma.store_subscriptions.count.mockResolvedValue(0);

      const arpu = await service.getARPU(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );
      expect(arpu.value.toString()).toBe('50000');
    });
  });

  describe('getLTV', () => {
    it('returns null when churn = 0', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal(1000000) },
      });
      prisma.subscription_events.findMany.mockResolvedValue([]);
      prisma.store_subscriptions.count
        .mockResolvedValueOnce(10) // active for ARPU
        .mockResolvedValueOnce(10); // active_at_start for churn

      const ltv = await service.getLTV(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );
      expect(ltv.value).toBeNull();
    });

    it('returns ARPU / churn when churn > 0', async () => {
      prisma.subscription_invoices.aggregate.mockResolvedValue({
        _sum: { total: new Prisma.Decimal(1000000) },
      });
      prisma.subscription_events.findMany.mockResolvedValue([
        { store_subscription_id: 1 },
        { store_subscription_id: 2 },
      ]);
      // Order matters: getARPU first (count = 10), then getChurn (count = 10)
      prisma.store_subscriptions.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(10);

      const ltv = await service.getLTV(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );
      // ARPU = 100000, churn = 2/10 = 20% -> LTV = 100000 / 0.2 = 500000
      expect(ltv.value?.toString()).toBe('500000');
    });
  });

  describe('getActiveBreakdown', () => {
    it('groups subscriptions by state and by plan', async () => {
      prisma.store_subscriptions.groupBy
        .mockResolvedValueOnce([
          { state: 'active', _count: { _all: 10 } },
          { state: 'trial', _count: { _all: 3 } },
        ])
        .mockResolvedValueOnce([
          { plan_id: 1, _count: { _all: 8 } },
          { plan_id: 2, _count: { _all: 5 } },
        ]);
      prisma.subscription_plans.findMany.mockResolvedValue([
        { id: 1, name: 'Basic' },
        { id: 2, name: 'Pro' },
      ]);

      const out = await service.getActiveBreakdown();
      expect(out.by_state).toEqual({ active: 10, trial: 3 });
      expect(out.by_plan).toEqual([
        { plan_id: 1, plan_name: 'Basic', count: 8 },
        { plan_id: 2, plan_name: 'Pro', count: 5 },
      ]);
    });
  });
});
