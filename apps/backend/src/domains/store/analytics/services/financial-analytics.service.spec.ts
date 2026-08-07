import { FinancialAnalyticsService } from './financial-analytics.service';
import { Logger } from '@nestjs/common';
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
  // QUI-630: getTaxSummary moved to $queryRaw. Each call returns the rows the
  // SQL would have produced; the first call is the GROUP BY for taxes, the
  // second is the taxable/exempt split.
  $queryRaw: jest.Mock;
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
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    // getStoreTimezone -> resolveStoreTimezone reads store_settings.findFirst.
    // Returning null yields DEFAULT_STORE_TIMEZONE ('America/Bogota'), so the
    // tz-aware parseDateRange path runs (the legacy UTC path is not used here).
    prisma.store_settings.findFirst.mockResolvedValue(null);

    // QUI-630: the unscoped prisma client returned by withoutScope() is the
    // surface that getTaxSummary calls $queryRaw on. Share the mock function
    // across both the top-level `prisma.$queryRaw` and the `withoutScope()`
    // client so each test can set up its own per-call responses via
    // `mockResolvedValueOnce` on a SINGLE jest.fn().
    const queryRawMock = prisma.$queryRaw;
    prisma.withoutScope.mockReturnValue({
      $queryRaw: queryRawMock,
    });
    // Default empty responses for the two queries; individual tests override
    // these with mockResolvedValueOnce.
    queryRawMock.mockResolvedValue([]);
    // Re-bind after the previous mockResolvedValue to keep the default in sync.
    prisma.withoutScope.mockReturnValue({ $queryRaw: queryRawMock });

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
    it('nets delivered + refunded in the same period to zero net_profit and zero operating_revenue (QUI-662)', async () => {
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

      // QUI-662: the refund must also drop operating_revenue, not only net_profit
      // (operatingRevenue = 2500, refundSubtotal = 2500, refundShipping = 0).
      expect(result.revenue.operating_revenue).toBe(0);
      expect(result.bottom_line.net_profit).toBe(0);
      expect(result.bottom_line.order_count).toBe(2);
    });

    it('QUI-662: cross-period refund makes operating_revenue negative (no base, refund in current period)', async () => {
      // Orders aggregate is called twice (current + previous). With the same
      // mock both calls return 0; the previous-period result has the same
      // operating_revenue = 0. Refund in BOTH periods = 2500 subtotal_refund
      // with 0 shipping_refund, so:
      //   current:  operatingRevenue = 0 - 2500 + 0 = -2500
      //   previous: previousOperatingRevenue = 0 (no orders)
      // We assert the current-period value to lock in the contract that a
      // cross-period refund moves operating_revenue negative (same asymmetry
      // as net_profit — the "real" cost of the refund is recognized here even
      // though the sale was elsewhere).
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

      expect(result.revenue.operating_revenue).toBe(-2500);
    });

    it('QUI-662: emits total_invoiced (grand_total sum) and balance (invoiced - refunds - operating_expenses)', async () => {
      // 1 order, $25k base + $4.75k tax = $29.75k grand_total.
      // No refunds, $2k operating expenses. COGS is intentionally not in the
      // balance formula (asset-consumption charge, not a cash outflow).
      prisma.orders.aggregate.mockResolvedValue({
        _sum: {
          subtotal_amount: 25000,
          discount_amount: 0,
          tax_amount: 4750,
          shipping_cost: 0,
          grand_total: 29750,
        },
        _count: { id: 1 },
      });
      prisma.withoutScope.mockReturnValue({
        $queryRaw: jest.fn().mockResolvedValue([{ cogs: 0 }]),
      });
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: {
          amount: 0,
          subtotal_refund: 0,
          tax_refund: 0,
          shipping_refund: 0,
        },
      });
      prisma.expenses.aggregate.mockResolvedValue({ _sum: { amount: 2000 } });

      const result = await service.getProfitLossSummary(QUERY as any);

      expect(result.revenue.total_invoiced).toBe(29750);
      // balance = total_invoiced - refundAmount - operating_expenses
      //        = 29750 - 0 - 2000 = 27750
      expect(result.bottom_line.balance).toBe(27750);
      // Previous period inherits the same mock (no separate `Once` for it),
      // so previousBalance == currentBalance == 27750 and growth is 0.
      expect(result.comparison.balance_growth).toBe(0);
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
      // QUI-662: include the new fields in the same invariant.
      const numbers = [
        result.revenue.gross_revenue,
        result.revenue.discounts,
        result.revenue.net_revenue,
        result.revenue.shipping_revenue,
        result.revenue.operating_revenue,
        result.revenue.total_invoiced,
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
        result.bottom_line.balance,
      ];
      for (const n of numbers) {
        expect(n).toBe(round2(n));
      }
    });
  });

  describe('getTaxSummary', () => {
    it('QUI-630 defect 1+2: base is derived from each tax row (tax/rate), NOT the item total — a line with two taxes splits its base correctly', async () => {
      // SQL output for one item that carries IVA 19% (tax=190) and INC 8% (tax=80).
      // Item total = 1000, but each tax's base must be derived from the tax's own
      // amount/rate: 190/0.19 = 1000, 80/0.08 = 1000. Before the fix the OLD code
      // summed `item.total_price` per tax row, so the IVA row would show base=1000
      // AND the INC row would show base=1000 (same item), inflating the aggregate.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'inc',
          tax_name: 'INC 8%',
          tax_rate: 8,
          is_compound: false,
          total_tax: '80.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      const ivaRow = result.breakdown.find((b) => b.tax_name === 'IVA 19%');
      const incRow = result.breakdown.find((b) => b.tax_name === 'INC 8%');
      // Per-tax base derived from its OWN amount/rate, not duplicated from item.
      expect(ivaRow?.taxable_amount).toBe(1000);
      expect(incRow?.taxable_amount).toBe(1000);
      // taxable_revenue only counts items WITH at least one tax row.
      expect(result.total_taxable_revenue).toBe(1000);
      expect(result.exempt_revenue).toBe(0);
      expect(result.total_tax_collected).toBe(270);
    });

    it('QUI-630 defect 3: exempt_revenue is separate and does NOT dilute effective_tax_rate', async () => {
      // 1 item with tax (1000 base, 190 tax) and 1 exempt item (500, no taxes).
      // OLD code: taxable_revenue = 1500, effective_rate = 190/1500 = 12.67%
      // NEW code: taxable_revenue = 1000, exempt_revenue = 500, effective_rate = 19%
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '500.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.total_taxable_revenue).toBe(1000);
      expect(result.exempt_revenue).toBe(500);
      expect(result.effective_tax_rate).toBe(19);
    });

    it('QUI-630 defect 5: refunded orders are EXCLUDED from tax collected (defect: their tax was already collected when delivered)', async () => {
      // Period with one delivered order (tax 190) and one refunded order (tax 50).
      // The SQL behind $queryRaw was already filtered by COMPLETED_SALE_STATES
      // (no `refunded`), so only the 190 reaches the aggregate. The refund
      // subtracts separately via `refunds.tax_refund`.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({
        _sum: { tax_refund: 50 },
      });

      const result = await service.getTaxSummary(QUERY as any);

      // The refunded order's 50 is NOT in collected (it's not in the GROUP BY
      // because `orders.state IN ('delivered','finished')` excludes 'refunded').
      expect(result.total_tax_collected).toBe(190);
      // It IS subtracted as a refund.
      expect(result.total_tax_refunded).toBe(50);
      expect(result.net_tax).toBe(140);
    });

    it('QUI-630 defect 7: tax_type NULL is surfaced as `unclassified` (never silently classified as `iva`)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'unclassified', // already COALESCEd in SQL
          tax_name: 'Unknown tax',
          tax_rate: 5,
          is_compound: false,
          total_tax: '50.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      const row = result.breakdown.find((b) => b.tax_name === 'Unknown tax');
      expect(row?.tax_type).toBe('unclassified');
    });

    it('DATA-CELL-2: total_tax_collected equals the SUM of the rounded breakdown rows (regression check)', async () => {
      // Three rows with unrounded tax amounts that will round to 2 decimals.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '138.126',
          taxable_amount: '727.0000000000',
        },
        {
          tax_type: 'inc',
          tax_name: 'INC 8%',
          tax_rate: 8,
          is_compound: false,
          total_tax: '139.514',
          taxable_amount: '1743.9250000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1743.925', exempt_revenue: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      const ivaRow = result.breakdown.find((b) => b.tax_name === 'IVA 19%');
      const incRow = result.breakdown.find((b) => b.tax_name === 'INC 8%');
      expect(ivaRow?.total_tax).toBe(138.13);
      expect(incRow?.total_tax).toBe(139.51);

      const detailSum = result.breakdown.reduce((s, b) => s + b.total_tax, 0);
      expect(round2(detailSum)).toBe(result.total_tax_collected);
      expect(result.total_tax_collected).toBe(277.64);
    });

    it('QUI-630 defect 4: emits IVA descontable from purchase_order_items (deductible_tax_amount)', async () => {
      // Sales side: 1 delivered order, IVA 19% of 1000 base = 190 tax.
      // Purchase side: 1 received order, deductible_tax_amount = 95 (half the IVA).
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans in this test).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      // New purchase-side query (third $queryRaw call after orphan probe).
      prisma.$queryRaw.mockResolvedValueOnce([
        { tax_type: 'iva', total_tax: '190.000', deductible_tax: '95.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_descontable).toBe(95);
      // Sales-side IVA stays at 190, computed from the breakdown (defect 1+2).
      expect(result.iva_generado).toBe(190);
    });

    it('QUI-630 defect 4: emits retenciones practicadas from sales breakdown (withholding + reteiva + reteica)', async () => {
      // One delivered order with three tax rows: IVA 19% (190), retefuente 1%
      // (tax_type='withholding', 10), reteiva 15% (tax_type='reteiva', 15).
      // The OLD endpoint ignored these — the new contract sums them as
      // `rete_practicadas` (a credit against the DIAN obligación).
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'withholding',
          tax_name: 'ReteFuente 1%',
          tax_rate: 1,
          is_compound: false,
          total_tax: '10.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'reteiva',
          tax_name: 'ReteIVA 15%',
          tax_rate: 15,
          is_compound: false,
          total_tax: '15.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      // No purchase rows in the period.
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.rete_practicadas).toBe(25);
    });

    it('QUI-630 defect 4: emits retenciones sufridas from purchase_order_items (withholding + reteiva + reteica)', async () => {
      // Sales side: 1 delivered order with IVA 19% of 1000 = 190 tax.
      // Purchase side: 1 received order with tax_type='reteiva' total_tax=15.
      // `rete_sufridas` is the credit (purchase-side withholding reduces the
      // store's tax obligation, since the supplier already moved the money
      // to the DIAN on the store's behalf).
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { tax_type: 'reteiva', total_tax: '15.000', deductible_tax: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.rete_sufridas).toBe(15);
    });

    it('QUI-630: net_vat_position uses computeNetVatPosition (formula = iva_generado + inc_generado + ica_generado − iva_descontable − rete_sufridas − rete_practicadas)', async () => {
      // Sales: IVA 190 + INC 80 + ICA 50 = 320 collected.
      // Purchases: IVA descontable 95 + reteiva sufrida 15.
      // Retenciones practicadas on sales: retefuente 10.
      // Formula (both retenciones are credits, both subtracted):
      //   net_vat_position = (190 + 80 + 50) − 95 − 15 − 10 = 200
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'inc',
          tax_name: 'INC 8%',
          tax_rate: 8,
          is_compound: false,
          total_tax: '80.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'ica',
          tax_name: 'ICA Bogotá',
          tax_rate: 5,
          is_compound: false,
          total_tax: '50.000',
          taxable_amount: '1000.0000000000',
        },
        {
          tax_type: 'withholding',
          tax_name: 'ReteFuente 1%',
          tax_rate: 1,
          is_compound: false,
          total_tax: '10.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { tax_type: 'iva', total_tax: '190.000', deductible_tax: '95.000' },
        { tax_type: 'reteiva', total_tax: '15.000', deductible_tax: '0.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_generado).toBe(190);
      expect(result.inc_generado).toBe(80);
      expect(result.ica_generado).toBe(50);
      expect(result.iva_descontable).toBe(95);
      expect(result.rete_practicadas).toBe(10);
      expect(result.rete_sufridas).toBe(15);
      // (190 + 80 + 50) − 95 − 15 − 10 = 200 (both retenciones are credits).
      // Was 220 before the fix — the old `+ rete_practicadas` over-counted
      // the sales-side credit by 2x.
      expect(result.net_vat_position).toBe(200);
      // `net_tax` is the historical definition (all collected − refunds) and
      // is no longer the DIAN posición — it sums every tax row including
      // withholding/reteiva. 190 (IVA) + 80 (INC) + 50 (ICA) + 10 (retefuente)
      // = 330.
      expect(result.net_tax).toBe(330);
    });

    it('QUI-630: net_vat_position can be NEGATIVE (saldo a favor) when descontable + rete_sufridas exceed generado', async () => {
      // Sales: only IVA 50 generated. Purchases: IVA descontable 200.
      // Net = 50 − 200 = −150 (saldo a favor).
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '50.000',
          taxable_amount: '263.1578947368',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '263.158', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { tax_type: 'iva', total_tax: '380.000', deductible_tax: '200.000' },
      ]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_generado).toBe(50);
      expect(result.iva_descontable).toBe(200);
      expect(result.net_vat_position).toBe(-150);
    });

    it('QUI-630 review: sales-side retenciones practicadas are credits (subtracted). Locks in the sign semantics for rete_practicadas', async () => {
      // Sales: IVA 100 + retefuente 40 (practicada on sales) = 100 generated.
      // Purchases: none. No descontable, no sufridas.
      // OLD formula (bug): 100 − 0 − 0 + 40 = 140 (over-counted by 80)
      // NEW formula:        100 − 0 − 0 − 40 = 60  (correct: credit subtracted)
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '100.000',
          taxable_amount: '526.3157894737',
        },
        {
          tax_type: 'withholding',
          tax_name: 'ReteFuente 4%',
          tax_rate: 4,
          is_compound: false,
          total_tax: '40.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '526.316', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      // No purchase rows in the period.
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_generado).toBe(100);
      expect(result.rete_practicadas).toBe(40);
      expect(result.rete_sufridas).toBe(0);
      expect(result.iva_descontable).toBe(0);
      // Lock in the credit semantics: a $40 sales-side retencion reduces
      // the position by $40, not increases it.
      expect(result.net_vat_position).toBe(60);
    });

    it('QUI-630: effective_tax_rate is null (NOT 0) when the period has no taxable revenue', async () => {
      // Empty period: no sales, no purchases. Old code returned 0.
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '0.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe (no orphans).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      // Matches `computeGrowth(null)` semantics: null = sin base de comparación.
      expect(result.effective_tax_rate).toBeNull();
      expect(result.total_tax_collected).toBe(0);
      expect(result.net_vat_position).toBe(0);
    });

    it('QUI-630 review: logs a warning when orphan purchase_orders (deleted location) are detected in the period', async () => {
      // Sales side: 1 delivered order with IVA 19% of 1000 = 190 tax.
      // Orphan probe: 3 purchase_orders refer to a deleted location.
      // No purchase tax rows contribute (the orphan rows are EXCLUDED).
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // Orphan-location probe: 3 orphans detected.
      prisma.$queryRaw.mockResolvedValueOnce([{ orphan_count: 3 }]);
      // Purchase tax rows: empty (the orphan rows are excluded).
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_generado).toBe(190);
      expect(result.iva_descontable).toBe(0);
      expect(result.net_vat_position).toBe(190);
      // The orphan probe must have logged a warning with the count.
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 purchase_order(s)'),
      );
      loggerSpy.mockRestore();
    });

    it('QUI-630: blocks default to 0 when the period has no rows of that tax type (helper is safe)', async () => {
      // Sales with only IVA. No INC, no ICA, no retenciones.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '190.000',
          taxable_amount: '1000.0000000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1000.000', exempt_revenue: '0.000' },
      ]);
      // No purchase rows in the period.
      prisma.$queryRaw.mockResolvedValueOnce([]);
      prisma.refunds.aggregate.mockResolvedValue({ _sum: { tax_refund: 0 } });

      const result = await service.getTaxSummary(QUERY as any);

      expect(result.iva_generado).toBe(190);
      expect(result.inc_generado).toBe(0);
      expect(result.ica_generado).toBe(0);
      expect(result.iva_descontable).toBe(0);
      expect(result.rete_practicadas).toBe(0);
      expect(result.rete_sufridas).toBe(0);
      // Position reduces to: 190 − 0 − 0 + 0 = 190
      expect(result.net_vat_position).toBe(190);
    });
  });

  describe('getTaxSummaryForExport', () => {
    beforeEach(() => {
      // Two rows that match the SQL GROUP BY output: one IVA, one INC, each
      // with unrounded tax amounts that round to 2 decimals.
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          tax_type: 'iva',
          tax_name: 'IVA 19%',
          tax_rate: 19,
          is_compound: false,
          total_tax: '138.126',
          taxable_amount: '727.0000000000',
        },
        {
          tax_type: 'inc',
          tax_name: 'INC 8%',
          tax_rate: 8,
          is_compound: false,
          total_tax: '139.514',
          taxable_amount: '1743.9250000000',
        },
      ]);
      prisma.$queryRaw.mockResolvedValueOnce([
        { taxable_revenue: '1743.925', exempt_revenue: '0.000' },
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
    it('QUI-543: returns RAW Date instants (no .toISOString().split formatting)', async () => {
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
