import { CustomersAnalyticsService } from './customers-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * CustomersAnalyticsService.getAbandonedCartsSummary are declared; everything
 * else is `any` so the service constructor accepts it.
 */
type MockStorePrismaService = {
  store_settings: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
  accounts_receivable?: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
} & Partial<StorePrismaService>;

describe('CustomersAnalyticsService.getAbandonedCartsSummary (QUI-628)', () => {
  let service: CustomersAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      store_settings: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    prisma.store_settings.findFirst.mockResolvedValue(null);

    // Share the same $queryRaw mock across `prisma.$queryRaw` and the
    // `withoutScope()` client. Tests then set per-call responses via
    // mockResolvedValueOnce on the shared function.
    const queryRawMock = prisma.$queryRaw;
    prisma.withoutScope.mockReturnValue({ $queryRaw: queryRawMock });

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, is_super_admin: false, is_owner: false });

    service = new CustomersAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('QUI-628: abandoned + recovered share the same denominator family, neither is hardcoded 0', async () => {
    // 30 abandoned carts (subtotal 1000), 70 recovered carts (subtotal 5000).
    // abandonment_rate = 30 / (30 + 70) = 30%; recovery_rate = 70 / 100 = 70%.
    // The OLD code's `recovery_rate = orders / carts` would have produced a
    // bogus number from a different universe; here both sides come from carts.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 30n, total_value: '1000.00' }]) // abandoned
      .mockResolvedValueOnce([{ count: 70n, total_value: '5000.00' }]) // recovered
      .mockResolvedValueOnce([{ count: 25n }]); // previous period abandoned

    const result = await service.getAbandonedCartsSummary(QUERY as any);

    expect(result.total_abandoned_carts).toBe(30);
    expect(result.total_abandoned_value).toBe(1000);
    expect(result.recovered_carts).toBe(70);
    expect(result.recovered_value).toBe(5000);
    expect(result.abandonment_rate).toBe(30);
    expect(result.recovery_rate).toBe(70);
    // growth = (30 - 25) / 25 * 100 = 20, contract returns rounded number
    expect(result.abandonment_rate_growth).toBe(20);
    // previous recovered set was fabricated; null until both periods use the
    // new schema (intentional honesty gap)
    expect(result.recovery_rate_growth).toBeNull();
  });

  it('QUI-628: when previous period had zero abandoned carts, growth is null (not 0%)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 5n, total_value: '100.00' }])
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n }]); // previous period: 0

    const result = await service.getAbandonedCartsSummary(QUERY as any);

    // contract: computeGrowth returns null when previous base is 0;
    // the UI must render that as "sin base de comparación", not as 0%
    expect(result.abandonment_rate_growth).toBeNull();
  });

  it('QUI-628: empty period (no abandoned, no recovered) returns 0% rates and null growth', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n }]);

    const result = await service.getAbandonedCartsSummary(QUERY as any);

    expect(result.total_abandoned_carts).toBe(0);
    expect(result.recovered_carts).toBe(0);
    expect(result.abandonment_rate).toBe(0);
    expect(result.recovery_rate).toBe(0);
    // potential_recovery_value is gone — it was a duplicate of recovered_value
    expect((result as any).potential_recovery_value).toBeUndefined();
  });

  it('QUI-628: abandoned + recovered uses carts.last_activity_at / carts.converted_at (single time column per side)', async () => {
    // The SQL strings sent to $queryRaw are the contract: one date column per
    // side. Prisma.sql template literals produce Sql value objects, so we
    // serialize each call's first argument via JSON.stringify to inspect the
    // embedded SQL fragments.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n }]);

    await service.getAbandonedCartsSummary(QUERY as any);

    const calls = prisma.$queryRaw.mock.calls.map((c) => {
      const arg = c[0] as any;
      // Prisma's Sql value object has a `strings` array of fragments and
      // `values` for parameters. Join the strings to recover the SQL body.
      if (Array.isArray(arg?.strings)) return arg.strings.join(' ');
      return String(arg);
    });
    // Abandoned query: filters by c.last_activity_at (the only time column
    // for the abandoned side). orders.placed_at must NOT appear here — that
    // was the defect of using two parallel date columns.
    expect(
      calls.some(
        (s) => s.includes('c.last_activity_at') && s.includes('cart_items'),
      ),
    ).toBe(true);
    // Recovered query: filters by c.converted_at (the time the cart converted,
    // not the time the order was placed — orders.placed_at appears in the
    // conversion flow but the metric anchors on the cart's own converted_at).
    expect(calls.some((s) => s.includes('c.converted_at'))).toBe(true);
  });

  it('ADR-01 (F-002): abandoned side uses the derived definition, never the stored state', async () => {
    // Nothing ever writes state='abandoned' (writers only put active /
    // converted, expiry deletes items without touching state), so filtering
    // by the stored state measured a structural ~0. The derived definition
    // is: state='active' + last_activity_at older than X + EXISTS items.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n, total_value: '0.00' }])
      .mockResolvedValueOnce([{ count: 0n }]);

    await service.getAbandonedCartsSummary(QUERY as any);

    const sqls = prisma.$queryRaw.mock.calls.map((c) => {
      const arg = c[0] as any;
      if (Array.isArray(arg?.strings)) return arg.strings.join(' ');
      return String(arg);
    });
    // The unreachable stored-state filter must be gone from every query.
    expect(sqls.some((s) => s.includes("c.state = 'abandoned'"))).toBe(false);
    // Abandoned-side queries carry the full derived definition.
    const abandonedSqls = sqls.filter((s) => s.includes('cart_items'));
    expect(abandonedSqls.length).toBeGreaterThan(0);
    for (const s of abandonedSqls) {
      expect(s).toContain("c.state = 'active'");
      expect(s).toContain('c.last_activity_at');
      expect(s).toContain('make_interval');
    }
    // The inactivity window X travels as a bound parameter from the named
    // constant — single source of truth, no hardcoded duplicate here.
    const windowX = (service as any).ABANDONED_CART_INACTIVITY_MINUTES;
    expect(windowX).toBeGreaterThan(0);
    const allValues = prisma.$queryRaw.mock.calls.flatMap((c) => {
      const first = (c[0] as any) ?? {};
      // The mock is invoked as a template tag (`mock\`...${v}...\``), so
      // bound parameters arrive as the trailing call arguments. A real
      // Prisma Sql object would carry them in `.values` instead.
      if (Array.isArray(first.values)) return first.values as unknown[];
      return c.slice(1) as unknown[];
    });
    expect(allValues).toContain(windowX);
    // Recovered side is untouched: still the stored converted state.
    expect(sqls.some((s) => s.includes("c.state = 'converted'"))).toBe(true);
  });
});

describe('CustomersAnalyticsService.getAccountsReceivable (QUI-540)', () => {
  let service: CustomersAnalyticsService;
  let prisma: MockStorePrismaService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      store_settings: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
      accounts_receivable: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    } as MockStorePrismaService;

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, organization_id: 2, is_super_admin: false, is_owner: false });

    service = new CustomersAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queries open and partial accounts_receivable with positive balance', async () => {
    const mockReceivables = [
      {
        id: 1,
        customer_id: 101,
        source_type: 'order',
        source_id: 50,
        document_number: 'REC-001',
        original_amount: 1000,
        paid_amount: 200,
        balance: 800,
        currency: 'COP',
        issue_date: new Date('2026-06-01'),
        due_date: new Date('2026-06-15'),
        days_overdue: 25,
        last_payment_date: null,
        status: 'partial',
        customer: {
          first_name: 'Juan',
          last_name: 'Perez',
          email: 'juan@example.com',
          document_number: '12345678',
        },
      },
      {
        id: 2,
        customer_id: 102,
        source_type: 'order',
        source_id: 51,
        document_number: 'REC-002',
        original_amount: 500,
        paid_amount: 0,
        balance: 500,
        currency: 'COP',
        issue_date: new Date('2026-05-01'),
        due_date: new Date('2026-05-10'),
        days_overdue: 75,
        last_payment_date: null,
        status: 'open',
        customer: null,
      },
    ];

    prisma.accounts_receivable!.count.mockResolvedValue(2);
    prisma.accounts_receivable!.findMany.mockResolvedValue(mockReceivables);

    const result = await service.getAccountsReceivable({ page: 1, limit: 10 } as any);

    expect(prisma.accounts_receivable!.count).toHaveBeenCalledWith({
      where: {
        store_id: 10,
        status: { in: ['open', 'partial'] },
        balance: { gt: 0 },
      },
    });

    expect(prisma.accounts_receivable!.findMany).toHaveBeenCalledWith({
      where: {
        store_id: 10,
        status: { in: ['open', 'partial'] },
        balance: { gt: 0 },
      },
      select: expect.any(Object),
      orderBy: { due_date: 'asc' },
      skip: 0,
      take: 10,
    });

    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.data).toHaveLength(2);

    expect(result.data[0]).toEqual({
      id: 1,
      customer_id: 101,
      customer_name: 'Juan Perez',
      customer_email: 'juan@example.com',
      customer_document: '12345678',
      document_number: 'REC-001',
      source_type: 'order',
      source_id: 50,
      issue_date: mockReceivables[0].issue_date,
      due_date: mockReceivables[0].due_date,
      days_overdue: 25,
      aging_bucket: '0-30',
      original_amount: 1000,
      paid_amount: 200,
      balance: 800,
      currency: 'COP',
      status: 'partial',
      last_payment_date: null,
    });

    expect(result.data[1].aging_bucket).toBe('61-90');
    expect(result.data[1].customer_name).toBe('');
  });

  it('throws when store context is missing', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(null as any);

    await expect(service.getAccountsReceivable({} as any)).rejects.toThrow();
  });
});

