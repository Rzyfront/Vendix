import { FinancialAnalyticsService } from './financial-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * FinancialAnalyticsService are declared; everything else is `any` so the
 * service constructor accepts it.
 */
type MockStorePrismaService = {
  orders: { aggregate: jest.Mock };
  order_items: { findMany: jest.Mock };
  refunds: { aggregate: jest.Mock };
  expenses: { aggregate: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

describe('FinancialAnalyticsService', () => {
  let service: FinancialAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      orders: { aggregate: jest.fn() },
      order_items: { findMany: jest.fn() },
      refunds: { aggregate: jest.fn() },
      expenses: { aggregate: jest.fn() },
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

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, is_super_admin: false, is_owner: false });

    service = new FinancialAnalyticsService(prisma as any);
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
  });
});