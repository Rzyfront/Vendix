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

  // Paid invoice whose service period is fully inside March 2026.
  const marchInvoice = (total: number) => ({
    total: new Prisma.Decimal(total),
    period_start: new Date('2026-03-01T00:00:00Z'),
    period_end: new Date('2026-03-31T00:00:00Z'),
  });
  const MARCH_START = new Date('2026-03-01T00:00:00Z');
  const MARCH_END = new Date('2026-03-31T23:59:59Z');

  describe('getMRR', () => {
    it('sums paid invoices inside the period and divides by months in period', async () => {
      prisma.subscription_invoices.findMany.mockResolvedValue([
        marchInvoice(300000),
        marchInvoice(300000),
        marchInvoice(300000),
      ]);

      const mrr = await service.getMRR(MARCH_START, MARCH_END);

      expect(mrr.value.toString()).toBe('900000');
      expect(mrr.currency).toBe('COP');
      expect(mrr.monthly_avg.toString()).toBe('900000');

      const where = prisma.subscription_invoices.findMany.mock.calls[0][0].where;
      expect(where.state).toBe('paid');
      // Overlap, not containment.
      expect(where.period_start.lt).toEqual(MARCH_END);
      expect(where.period_end.gt).toEqual(MARCH_START);
    });

    it('counts the overlapping share of invoices that run past the window (OPS-37: MRR was $0)', async () => {
      // Window: 2026-10-11 → 2026-11-10 (30 days), as in the super admin "last 30 days".
      const from = new Date('2026-10-11T00:00:00Z');
      const to = new Date('2026-11-10T00:00:00Z');
      prisma.subscription_invoices.findMany.mockResolvedValue([
        // Annual 1,095,000 for 365 days → 3,000/day → 30 days = 90,000.
        {
          total: new Prisma.Decimal(1095000),
          period_start: new Date('2026-06-01T00:00:00Z'),
          period_end: new Date('2027-06-01T00:00:00Z'),
        },
        // Monthly 60,000 for 30 days starting 2026-11-01 → 9 of 30 days in window = 18,000.
        {
          total: new Prisma.Decimal(60000),
          period_start: new Date('2026-11-01T00:00:00Z'),
          period_end: new Date('2026-12-01T00:00:00Z'),
        },
      ]);

      const mrr = await service.getMRR(from, to);

      expect(mrr.value.toString()).toBe('108000');
      expect(mrr.monthly_avg.toString()).toBe('108000');
    });

    it('returns 0 when no paid invoices exist', async () => {
      prisma.subscription_invoices.findMany.mockResolvedValue([]);
      const mrr = await service.getMRR(
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-31T23:59:59Z'),
      );
      expect(mrr.value.toString()).toBe('0');
      expect(mrr.monthly_avg.toString()).toBe('0');
    });

    it('counts an invoice with an empty service period only if it starts inside the window', async () => {
      const at = new Date('2026-03-10T00:00:00Z');
      prisma.subscription_invoices.findMany.mockResolvedValue([
        { total: new Prisma.Decimal(50000), period_start: at, period_end: at },
      ]);
      const mrr = await service.getMRR(MARCH_START, MARCH_END);
      expect(mrr.value.toString()).toBe('50000');
    });
  });

  describe('getMRREvolution', () => {
    afterEach(() => jest.useRealTimers());

    it('spreads each paid invoice over the months its service period covers', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-15T12:00:00Z'));
      // Annual 365,000 from 2026-10-01 (365 days) → 1,000/day: Oct 31,000; Nov 30,000.
      prisma.subscription_invoices.findMany.mockResolvedValue([
        {
          total: new Prisma.Decimal(365000),
          period_start: new Date('2026-10-01T00:00:00Z'),
          period_end: new Date('2027-10-01T00:00:00Z'),
        },
      ]);

      const points = await service.getMRREvolution(2);

      expect(points.map((p) => [p.month, p.mrr.toString()])).toEqual([
        ['2026-10', '31000'],
        ['2026-11', '30000'],
      ]);
      const where = prisma.subscription_invoices.findMany.mock.calls[0][0].where;
      expect(where.period_start.lt).toEqual(new Date('2026-12-01T00:00:00Z'));
      expect(where.period_end.gt).toEqual(new Date('2026-10-01T00:00:00Z'));
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
      prisma.subscription_invoices.findMany.mockResolvedValue([
        marchInvoice(1000000),
      ]);
      prisma.store_subscriptions.count.mockResolvedValue(10);

      const arpu = await service.getARPU(
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-03-31T23:59:59Z'),
      );

      expect(arpu.active_subs).toBe(10);
      expect(arpu.value.toString()).toBe('100000');
    });

    it('falls back to dividing by 1 when active_subs = 0', async () => {
      prisma.subscription_invoices.findMany.mockResolvedValue([
        marchInvoice(50000),
      ]);
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
      prisma.subscription_invoices.findMany.mockResolvedValue([
        marchInvoice(1000000),
      ]);
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
      prisma.subscription_invoices.findMany.mockResolvedValue([
        marchInvoice(1000000),
      ]);
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
