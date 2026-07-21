import { FinancialAnalyticsService } from './financial-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * FinancialAnalyticsService are declared; everything else is `any` so the
 * service constructor accepts it.
 */
type MockStorePrismaService = {
  orders: { aggregate: jest.Mock; findFirst: jest.Mock };
  order_items: { findMany: jest.Mock };
  refunds: { aggregate: jest.Mock };
  expenses: { aggregate: jest.Mock };
  cash_register_sessions: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

/**
 * Mirrors `FinancialAnalyticsService.round2` (round-half-away-from-zero, 2 dec)
 * so the reconciliation/rounding assertions below are exact instead of relying
 * on `toBeCloseTo`.
 */
const round2 = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
};

describe('FinancialAnalyticsService', () => {
  let service: FinancialAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      orders: { aggregate: jest.fn(), findFirst: jest.fn() },
      order_items: { findMany: jest.fn() },
      refunds: { aggregate: jest.fn() },
      expenses: { aggregate: jest.fn() },
      cash_register_sessions: { findMany: jest.fn() },
      store_settings: { findFirst: jest.fn() },
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    // getStoreTimezone -> resolveStoreTimezone reads store_settings.findFirst.
    // Returning null yields DEFAULT_STORE_TIMEZONE ('America/Bogota'), so the
    // tz-aware parseDateRange path runs (the legacy UTC path is not used here).
    prisma.store_settings.findFirst.mockResolvedValue(null);

    // withoutScope().$queryRaw is used for the COGS raw SQL.
    prisma.withoutScope.mockReturnValue({
      $queryRaw: jest.fn().mockResolvedValue([{ cogs: 0 }]),
    });

    // Default currency lookup for the financial export (overridable per test).
    prisma.orders.findFirst.mockResolvedValue({ currency: 'COP' });

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, is_super_admin: false, is_owner: false });

    // Cache mock: get() -> undefined forces a cache miss so the real compute
    // path runs and the existing assertions hold; set() is a no-op.
    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new FinancialAnalyticsService(prisma as any, mockCache as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getProfitLossSummary', () => {
    it('nets delivered + refunded in the same period to zero net_profit', async () => {
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 2500,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          grand_total: 2500,
        },
        _count: { id: 2 },
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 2500,
          subtotal_refund: 2500,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      expect(result.bottom_line.net_profit).toBe(0);
      expect(result.bottom_line.order_count).toBe(2);
    });

    it('regression: refunded-only period yields net_profit 0 (not -2500)', async () => {
      // Pre-fix: 'refunded' was excluded from revenue, so this returned -2500.
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 2500,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          grand_total: 2500,
        },
        _count: { id: 1 },
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 2500,
          subtotal_refund: 2500,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      expect(result.revenue.gross_revenue).toBe(2500);
      expect(result.refunds.subtotal_refunds).toBe(2500);
      expect(result.bottom_line.net_profit).toBe(0);
      expect(result.bottom_line.order_count).toBe(1);
    });

    it('computes net_profit for a delivered-only period', async () => {
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 2500,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          grand_total: 2500,
        },
        _count: { id: 1 },
      });
      // COGS = 1000
      prisma.withoutScope.mockReturnValue({
        $queryRaw: jest.fn().mockResolvedValue([{ cogs: 1000 }]),
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 0,
          subtotal_refund: 0,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      expect(result.revenue.gross_revenue).toBe(2500);
      expect(result.costs.cost_of_goods_sold).toBe(1000);
      expect(result.bottom_line.net_profit).toBe(1500);
    });

    it('locks in cross-period refund asymmetry: no revenue this period -> net_profit -2500', async () => {
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 0,
          discount_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          grand_total: 0,
        },
        _count: { id: 0 },
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 2500,
          subtotal_refund: 2500,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      expect(result.revenue.gross_revenue).toBe(0);
      expect(result.refunds.subtotal_refunds).toBe(2500);
      expect(result.bottom_line.net_profit).toBe(-2500);
    });

    it('DATA-CELL-1: every monetary output is rounded to 2 decimals (no float artifacts)', async () => {
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 1234.567,
          discount_amount: 34.561,
          tax_amount: 0,
          shipping_cost: 0,
          grand_total: 1200.006,
        },
        _count: { id: 3 },
      });
      prisma.withoutScope.mockReturnValue({
        $queryRaw: jest.fn().mockResolvedValue([{ cogs: 200.123 }]),
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 0,
          subtotal_refund: 0,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      // Exact expected 2-decimal values (raw math rounded only at output).
      expect(result.revenue.gross_revenue).toBe(1234.57);
      expect(result.revenue.discounts).toBe(34.56);
      expect(result.revenue.net_revenue).toBe(1200.01);
      expect(result.costs.cost_of_goods_sold).toBe(200.12);
      expect(result.costs.gross_profit).toBe(999.88);
      expect(result.bottom_line.net_profit).toBe(999.88);

      // Generic invariant: no emitted number carries >2 decimals / float noise.
      const numbers = [
        result.revenue.gross_revenue,
        result.revenue.discounts,
        result.revenue.net_revenue,
        result.revenue.shipping_revenue,
        result.revenue.tax_collected,
        result.costs.cost_of_goods_sold,
        result.costs.gross_profit,
        result.costs.gross_margin,
        result.refunds.total_refunds,
        result.refunds.subtotal_refunds,
        result.refunds.tax_refunds,
        result.refunds.shipping_refunds,
        result.operating_expenses,
        result.bottom_line.net_profit,
        result.bottom_line.net_margin,
      ];
      for (const n of numbers) {
        expect(n).toBe(round2(n));
      }
    });
  });

  describe('getTaxSummary', () => {
    it('mirror: refunded-only period nets tax to 0 (not negative)', async () => {
      prisma.order_items.findMany.mockResolvedValue([
        {
          id: 1,
          total_price: 2500,
          tax_amount_item: 475,
          order_item_taxes: [
            {
              tax_name: 'IVA 19%',
              tax_rate: 19,
              tax_amount: 475,
              tax_type: 'iva',
              is_compound: false,
            },
          ],
        },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: { tax_refund: 475 },
      });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.total_tax_collected).toBe(475);
      expect(result.total_tax_refunded).toBe(475);
      expect(result.net_tax).toBe(0);
    });

    it('DATA-CELL-2: total_tax_collected equals the SUM of the rounded breakdown rows', async () => {
      prisma.order_items.findMany.mockResolvedValue([
        {
          id: 1,
          total_price: 1000,
          tax_amount_item: 138.126,
          order_item_taxes: [
            {
              tax_name: 'IVA 19%',
              tax_rate: 19,
              tax_amount: 138.126,
              tax_type: 'iva',
              is_compound: false,
            },
          ],
        },
        {
          id: 2,
          total_price: 1200,
          tax_amount_item: 139.514,
          order_item_taxes: [
            {
              tax_name: 'INC 8%',
              tax_rate: 8,
              tax_amount: 139.514,
              tax_type: 'inc',
              is_compound: false,
            },
          ],
        },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      // Each breakdown row is rounded to 2 decimals ...
      const ivaRow = result.breakdown.find((b) => b.tax_name === 'IVA 19%');
      const incRow = result.breakdown.find((b) => b.tax_name === 'INC 8%');
      expect(ivaRow?.total_tax).toBe(138.13);
      expect(incRow?.total_tax).toBe(139.51);

      // ... and the collected total is the SUM of those rounded rows.
      const detailSum = result.breakdown.reduce((s, b) => s + b.total_tax, 0);
      expect(round2(detailSum)).toBe(result.total_tax_collected);
      expect(result.total_tax_collected).toBe(277.64);
    });
  });

  describe('getTaxSummaryForExport', () => {
    beforeEach(() => {
      prisma.order_items.findMany.mockResolvedValue([
        {
          id: 1,
          total_price: 1000,
          tax_amount_item: 138.126,
          order_item_taxes: [
            {
              tax_name: 'IVA 19%',
              tax_rate: 19,
              tax_amount: 138.126,
              tax_type: 'iva',
              is_compound: false,
            },
          ],
        },
        {
          id: 2,
          total_price: 1200,
          tax_amount_item: 139.514,
          order_item_taxes: [
            {
              tax_name: 'INC 8%',
              tax_rate: 8,
              tax_amount: 139.514,
              tax_type: 'inc',
              is_compound: false,
            },
          ],
        },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });
    });

    it('DATA-CELL-2: the TOTAL row equals the sum of the detail tax_collected', async () => {
      const rows = await service.getTaxSummaryForExport(QUERY as any);

      const details = rows.filter((r) => r.row_type === 'detail');
      const total = rows.find((r) => r.row_type === 'total');

      expect(details).toHaveLength(2);
      expect(total).toBeDefined();

      const detailSum = details.reduce((s, r) => s + r.tax_collected, 0);
      expect(round2(detailSum)).toBe(total!.tax_collected);
      expect(total!.tax_collected).toBe(277.64);
    });

    it('DATA-CELL-3: the TOTAL row uses null (never "") for non-applicable columns', async () => {
      const rows = await service.getTaxSummaryForExport(QUERY as any);
      const total = rows.find((r) => r.row_type === 'total')!;

      expect(total.tax_type).toBeNull();
      expect(total.tax_rate).toBeNull();
      expect(total.is_compound).toBeNull();
      // Never the empty string that would create mixed-type columns.
      expect(total.tax_rate as unknown).not.toBe('');
      expect(total.is_compound as unknown).not.toBe('');
    });

    it('no numeric/boolean cell is an empty string across all rows', async () => {
      const rows = await service.getTaxSummaryForExport(QUERY as any);

      for (const row of rows) {
        // tax_rate: number | null (never '')
        expect(
          row.tax_rate === null || typeof row.tax_rate === 'number',
        ).toBe(true);
        // is_compound: boolean | null (never '')
        expect(
          row.is_compound === null || typeof row.is_compound === 'boolean',
        ).toBe(true);
        // monetary columns are always numeric
        expect(typeof row.taxable_amount).toBe('number');
        expect(typeof row.tax_collected).toBe('number');
      }
    });
  });

  describe('getFinancialSummaryForExport', () => {
    beforeEach(() => {
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 1234.567,
          discount_amount: 34.561,
          tax_amount: 100.004,
          shipping_cost: 12.5,
          grand_total: 1300,
        },
        _count: { id: 4 },
      });
      prisma.withoutScope.mockReturnValue({
        $queryRaw: jest.fn().mockResolvedValue([{ cogs: 200.123 }]),
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 50.117,
          subtotal_refund: 40.113,
          tax_refund: 8.001,
          shipping_refund: 2.003,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 30.5 } });
      prisma.order_items.findMany.mockResolvedValue([]);
    });

    it('DATA-COMPLETE-6: exposes enriched sections with raw values', async () => {
      const rows = await service.getFinancialSummaryForExport(QUERY as any);

      const byMetric = (metric: string) => rows.find((r) => r.metric === metric);

      // Period metadata is a RAW Date instant (not formatted, not a string).
      const start = byMetric('period_start');
      const end = byMetric('period_end');
      expect(start?.date).toBeInstanceOf(Date);
      expect(end?.date).toBeInstanceOf(Date);
      expect(start?.unit).toBe('date');

      // Currency surfaced from the period's latest order.
      expect(byMetric('currency')?.text).toBe('COP');

      // Enrichment fields present.
      expect(byMetric('discounts')?.value).toBe(34.56);
      expect(byMetric('shipping_revenue')?.value).toBe(12.5);
      expect(byMetric('subtotal_refunds')?.value).toBe(40.11);
      expect(byMetric('tax_refunds')?.value).toBe(8.0);
      expect(byMetric('gross_margin')?.unit).toBe('percent');
      expect(byMetric('net_margin')?.unit).toBe('percent');
      expect(byMetric('order_count')?.value).toBe(4);
      expect(byMetric('order_count')?.unit).toBe('count');
    });

    it('keeps every column single-typed: no cell is an empty string', async () => {
      const rows = await service.getFinancialSummaryForExport(QUERY as any);

      for (const row of rows) {
        expect(row.value === null || typeof row.value === 'number').toBe(true);
        expect(row.date === null || row.date instanceof Date).toBe(true);
        expect(row.text === null || typeof row.text === 'string').toBe(true);
        // no column ever carries '' (the mixed-type anti-pattern)
        expect(row.value as unknown).not.toBe('');
        expect(row.text as unknown).not.toBe('');
      }
    });
  });

  describe('getCashSessionsForExport', () => {
    it('DATA-CELL-4: returns RAW Date instants (no .toISOString().split formatting)', async () => {
      const openedAt = new Date('2026-07-08T15:30:00.000Z');
      const closedAt = new Date('2026-07-08T23:45:00.000Z');

      prisma.cash_register_sessions.findMany.mockResolvedValue([
        {
          status: 'closed',
          opened_at: openedAt,
          closed_at: closedAt,
          opening_amount: 100.005,
          expected_closing_amount: 500.001,
          actual_closing_amount: 498.766,
          difference: -1.234,
          register: { name: 'Caja 1' },
          opened_by_user: { first_name: 'Ana', last_name: 'Ruiz' },
          closed_by_user: null,
          movements: [
            { type: 'sale', amount: 300.11 },
            { type: 'expense', amount: 20.22 },
          ],
        },
      ]);

      const rows = await service.getCashSessionsForExport(QUERY as any);

      expect(rows).toHaveLength(1);
      const row = rows[0];

      // Dates are raw Date objects, identical instants (NOT date-only strings).
      expect(row.opened_at).toBeInstanceOf(Date);
      expect(row.opened_at.getTime()).toBe(openedAt.getTime());
      expect(row.closed_at).toBeInstanceOf(Date);
      expect(row.closed_at!.getTime()).toBe(closedAt.getTime());

      // Money is numeric and rounded to 2 decimals.
      expect(row.total_sales).toBe(300.11);
      expect(row.total_expenses).toBe(20.22);
      expect(row.opening_amount).toBe(round2(100.005));
      expect(typeof row.difference).toBe('number');
      expect(row.difference).toBe(round2(row.difference));

      // Nullable string columns are null (never ''), single-typed.
      expect(row.closed_by_name).toBeNull();
      expect(row.register_name).toBe('Caja 1');
    });
  });
});
