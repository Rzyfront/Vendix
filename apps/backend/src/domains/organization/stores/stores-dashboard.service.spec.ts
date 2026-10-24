import { StoresDashboardService } from './stores-dashboard.service';
import { RequestContextService } from '@common/context/request-context.service';

const summary = (n: number, extra: Record<string, any> = {}) => ({
  cash: {
    income: 100 * n,
    income_without_tax: 80 * n,
    refunds: 10 * n,
    refunds_tax: 2 * n,
    refunds_pending: 1 * n,
    net_profit: 30 * n,
    net_profit_after_expenses: 20 * n,
    balance: 50 * n,
    balance_accumulated: 70 * n,
    expenses_paid: 5 * n,
    cost_coverage: { units_total: 10 * n, units_without_cost: n },
    ...extra,
  },
  operating_expenses: 40 * n,
  comparison: { operating_expenses: 20 * n },
});

describe('StoresDashboardService', () => {
  const ctx = { organization_id: 7, user_id: 1, is_super_admin: false } as any;
  let prisma: any;
  let analytics: { getProfitLossSummary: jest.Mock };
  let service: StoresDashboardService;
  let seenStoreIds: Array<number | undefined>;

  beforeEach(() => {
    seenStoreIds = [];
    prisma = {
      stores: { findMany: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]) },
    };
    analytics = {
      getProfitLossSummary: jest.fn().mockImplementation(async () => {
        const id = RequestContextService.getContext()?.store_id;
        seenStoreIds.push(id);
        return id === 1 ? summary(1) : summary(2);
      }),
    };
    service = new StoresDashboardService(prisma, analytics as any);
  });

  it('calls analytics once per store with that store in context and aggregates', async () => {
    const result = await RequestContextService.runIsolated(ctx, () =>
      service.getProfitLossSummary({} as any),
    );

    expect(analytics.getProfitLossSummary).toHaveBeenCalledTimes(2);
    expect(seenStoreIds.sort()).toEqual([1, 2]);

    expect(result.store_count).toBe(2);
    expect(result.cash.income).toBe(300);
    expect(result.cash.income_without_tax).toBe(240);
    expect(result.cash.refunds).toBe(30);
    expect(result.cash.refunds_tax).toBe(6);
    expect(result.cash.refunds_pending).toBe(3);
    expect(result.cash.net_profit).toBe(90);
    expect(result.cash.net_profit_after_expenses).toBe(60);
    expect(result.cash.balance).toBe(150);
    expect(result.cash.balance_accumulated).toBe(210);
    expect(result.cash.expenses_paid).toBe(15);
    // base = 240 - (30 - 6) = 216 ; 90 / 216 * 100 = 41.67
    expect(result.cash.net_margin).toBe(41.67);
    expect(result.cash.cost_coverage).toEqual({
      units_total: 30,
      units_without_cost: 3,
      coverage_ratio: 0.9,
    });
    expect(result.operating_expenses).toBe(120);
    expect(result.comparison.operating_expenses).toBe(60);
    expect(result.comparison.expenses_growth).toBe(100);
  });

  it('returns null growth and zero margin without a base', async () => {
    prisma.stores.findMany.mockResolvedValue([{ id: 1 }]);
    analytics.getProfitLossSummary.mockResolvedValue({
      cash: null,
      operating_expenses: 10,
      comparison: { operating_expenses: null },
    });
    const result = await RequestContextService.runIsolated(ctx, () =>
      service.getProfitLossSummary({} as any),
    );
    expect(result.cash.net_margin).toBe(0);
    expect(result.cash.cost_coverage.coverage_ratio).toBe(1);
    expect(result.comparison.expenses_growth).toBeNull();
  });

  it('throws when there is no organization_id', async () => {
    await expect(
      RequestContextService.runIsolated(
        { ...ctx, organization_id: undefined },
        () => service.getProfitLossSummary({} as any),
      ),
    ).rejects.toMatchObject({ errorCode: 'ORG_CONTEXT_001' });
    expect(analytics.getProfitLossSummary).not.toHaveBeenCalled();
  });
});
