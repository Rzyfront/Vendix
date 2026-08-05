import { SalesAnalyticsService } from './sales-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * SalesAnalyticsService.getOrdersForExport are declared; everything else is
 * `any` so the service constructor accepts it.
 */
type MockStorePrismaService = {
  orders: {
    findMany: jest.Mock;
    aggregate: jest.Mock;
    groupBy: jest.Mock;
  };
  order_items: { aggregate: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

/**
 * Builds a single mocked order as returned by the scoped `orders.findMany`
 * include used by getOrdersForExport. Monetary fields are plain numbers here
 * (Prisma Decimal instances behave identically under `Number()`); dates are
 * real Date instances.
 */
function makeOrder(overrides: {
  id: number;
  order_number: string;
  grand_total: number;
  itemCount: number;
  created_at?: Date;
}) {
  const items = Array.from({ length: overrides.itemCount }, (_, i) => ({
    product_name: `Producto ${i + 1}`,
    variant_sku: null,
    quantity: 1,
    unit_price: 100,
    total_price: 100,
    products: { name: `Producto ${i + 1}`, sku: `SKU-${i + 1}` },
  }));

  return {
    id: overrides.id,
    order_number: overrides.order_number,
    created_at: overrides.created_at ?? new Date('2026-07-08T15:30:00.000Z'),
    channel: 'pos',
    state: 'delivered',
    currency: 'COP',
    subtotal_amount: overrides.grand_total,
    discount_amount: 0,
    tax_amount: 0,
    shipping_cost: 0,
    tip_amount: null,
    grand_total: overrides.grand_total,
    users: {
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      document_number: '900123456',
      document_type: 'NIT',
    },
    payments: [
      {
        paid_at: new Date('2026-07-08T15:31:00.000Z'),
        store_payment_method: {
          display_name: 'Efectivo',
          system_payment_method: { display_name: 'Cash' },
        },
      },
    ],
    order_items: items,
  };
}

describe('SalesAnalyticsService', () => {
  let service: SalesAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      orders: {
        findMany: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
      order_items: { aggregate: jest.fn() },
      store_settings: { findFirst: jest.fn() },
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    // getStoreTimezone -> resolveStoreTimezone reads store_settings.findFirst.
    // Returning null yields DEFAULT_STORE_TIMEZONE ('America/Bogota'), so the
    // tz-aware parseDateRange path runs.
    prisma.store_settings.findFirst.mockResolvedValue(null);
    prisma.withoutScope.mockReturnValue({
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, is_super_admin: false, is_owner: false });

    const mockCache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new SalesAnalyticsService(prisma as any, mockCache as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getSalesSummary (QUI-610)', () => {
    it('defect 1+2+3: total_revenue is OPERATING revenue (subtotal − discounts + shipping), VAT and tips are SEPARATE fields', async () => {
      // Single period: subtotal 8000, discounts 0, shipping 0, tax 1520, tip 200,
      // orders 10, units 25, customers 7. Previous: subtotal 7000, tax 1330,
      // orders 8, customers 5.
      //
      // Before the fix: total_revenue = 9720 (folded in tax + tip) — would have
      // shown the DIAN liability and the waiters' money as store income.
      prisma.orders.aggregate
        .mockResolvedValueOnce({
          // current period
          _sum: {
            subtotal_amount: 8000,
            discount_amount: 0,
            shipping_cost: 0,
            tax_amount: 1520,
            tip_amount: 200,
          },
          _count: { id: 10 },
        })
        .mockResolvedValueOnce({
          // previous period
          _sum: {
            subtotal_amount: 7000,
            discount_amount: 0,
            shipping_cost: 0,
            tax_amount: 1330,
            tip_amount: 150,
          },
          _count: { id: 8 },
        });
      prisma.order_items.aggregate.mockResolvedValue({
        _sum: { quantity: 25 },
      });
      prisma.orders.groupBy.mockResolvedValue([
        { customer_id: 1 },
        { customer_id: 2 },
        { customer_id: 3 },
        { customer_id: 4 },
        { customer_id: 5 },
        { customer_id: 6 },
        { customer_id: 7 },
      ]);

      const result = await service.getSalesSummary(QUERY as any);

      // Operating revenue: subtotal − discounts + shipping = 8000
      expect(result.total_revenue).toBe(8000);
      // VAT and tips are SEPARATE fields, never folded into revenue
      expect(result.total_taxes).toBe(1520);
      expect(result.total_tips).toBe(200);
      // AOV = revenue / orders, sharing the same numerator as the revenue card
      expect(result.average_order_value).toBe(800);
      expect(result.total_orders).toBe(10);
      expect(result.total_units_sold).toBe(25);
      expect(result.total_customers).toBe(7);
      // Growth against the SAME definition (operating revenue)
      expect(result.revenue_growth).toBeCloseTo(14.29, 1);
      expect(result.orders_growth).toBe(25);
    });

    it('defect 1: shipping + discounts DO affect revenue, tax does NOT', async () => {
      // subtotal 1000, discount 100, shipping 50, tax 200.
      // operating_revenue = 1000 - 100 + 50 = 950. tax stays out.
      prisma.orders.aggregate
        .mockResolvedValueOnce({
          _sum: {
            subtotal_amount: 1000,
            discount_amount: 100,
            shipping_cost: 50,
            tax_amount: 200,
            tip_amount: 0,
          },
          _count: { id: 1 },
        })
        .mockResolvedValueOnce({
          _sum: {
            subtotal_amount: 0,
            discount_amount: 0,
            shipping_cost: 0,
            tax_amount: 0,
            tip_amount: 0,
          },
          _count: { id: 0 },
        });
      prisma.order_items.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.orders.groupBy.mockResolvedValue([]);

      const result = await service.getSalesSummary(QUERY as any);

      expect(result.total_revenue).toBe(950);
      expect(result.total_taxes).toBe(200);
    });

    it('defect 4: growth is null (not 0) when previous period had 0 revenue / 0 orders', async () => {
      // Current: some revenue. Previous: zero everything.
      prisma.orders.aggregate
        .mockResolvedValueOnce({
          _sum: {
            subtotal_amount: 1000,
            discount_amount: 0,
            shipping_cost: 0,
            tax_amount: 190,
            tip_amount: 0,
          },
          _count: { id: 5 },
        })
        .mockResolvedValueOnce({
          _sum: {
            subtotal_amount: 0,
            discount_amount: 0,
            shipping_cost: 0,
            tax_amount: 0,
            tip_amount: 0,
          },
          _count: { id: 0 },
        });
      prisma.order_items.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      prisma.orders.groupBy.mockResolvedValue([]);

      const result = await service.getSalesSummary(QUERY as any);

      // contract: computeGrowth returns null when previous base is 0;
      // the UI must render that as "sin base de comparación", NOT "0 %".
      expect(result.revenue_growth).toBeNull();
      expect(result.orders_growth).toBeNull();
    });

    it('regression: sales/summary.total_revenue reconciles with financial/profit-loss.revenue.operating_revenue', async () => {
      // Both endpoints must produce the SAME operating revenue for the same
      // period (they're driven by the same orders.aggregate now). This test
      // pins the contract so a future divergence is caught.
      const operatingRevenueSource = {
        subtotal_amount: 5000,
        discount_amount: 200,
        shipping_cost: 100,
        tax_amount: 950,
        tip_amount: 50,
      };

      prisma.orders.aggregate.mockResolvedValue({
        _sum: operatingRevenueSource,
        _count: { id: 4 },
      });
      prisma.order_items.aggregate.mockResolvedValue({
        _sum: { quantity: 10 },
      });
      prisma.orders.groupBy.mockResolvedValue([
        { customer_id: 1 },
        { customer_id: 2 },
      ]);

      const result = await service.getSalesSummary(QUERY as any);
      // operating_revenue = 5000 - 200 + 100 = 4900 (the same formula
      // financial/profit-loss uses via computeOperatingRevenue).
      expect(result.total_revenue).toBe(4900);
    });
  });

  describe('getOrdersForExport', () => {
    it('DATA-COMPLETE-1: 3-item order counts grand_total ONCE (not ×3)', async () => {
      // A single order of 3 items with grand_total 300. Pre-fix, flattening one
      // row per item put grand_total 300 on each of the 3 rows, so summing the
      // export over-counted to 900. The split shape must state it once.
      prisma.orders.findMany.mockResolvedValue([
        makeOrder({
          id: 10,
          order_number: 'O-1',
          grand_total: 300,
          itemCount: 3,
        }),
      ]);

      const result = await service.getOrdersForExport(QUERY as any);

      // One order-level row, three line-level rows.
      expect(result.orders).toHaveLength(1);
      expect(result.items).toHaveLength(3);

      // Order-level total stated exactly once.
      expect(result.orders[0].grand_total).toBe(300);
      const summedGrandTotal = result.orders.reduce(
        (sum, r) => sum + r.grand_total,
        0,
      );
      expect(summedGrandTotal).toBe(300);

      // Line rows carry NO order-level totals.
      expect(result.items[0]).not.toHaveProperty('grand_total');
      expect(result.items[0]).not.toHaveProperty('subtotal');
      expect(result.items[0].order_number).toBe('O-1');
      expect(result.items[0].line_total).toBe(100);

      expect(result.truncated).toBe(false);
    });

    it('DATA-COMPLETE-3: payment_method filter is applied to the where', async () => {
      prisma.orders.findMany.mockResolvedValue([]);

      await service.getOrdersForExport({
        ...QUERY,
        payment_method: 'cash',
      } as any);

      const where = prisma.orders.findMany.mock.calls[0][0].where;
      expect(where.payments).toEqual({
        some: {
          state: 'succeeded',
          store_payment_method: {
            system_payment_method: { name: 'cash' },
          },
        },
      });
    });

    it('DATA-COMPLETE-3: category_id and brand_id filters are applied', async () => {
      prisma.orders.findMany.mockResolvedValue([]);

      await service.getOrdersForExport({
        ...QUERY,
        category_id: 7,
        brand_id: 3,
      } as any);

      const where = prisma.orders.findMany.mock.calls[0][0].where;
      expect(where.order_items).toEqual({
        some: {
          products: {
            is: {
              product_categories: { some: { category_id: 7 } },
              brand_id: 3,
            },
          },
        },
      });
    });

    it('DATA-COMPLETE-4: default state filter is COMPLETED_STATES; override honored', async () => {
      prisma.orders.findMany.mockResolvedValue([]);

      await service.getOrdersForExport(QUERY as any);
      expect(prisma.orders.findMany.mock.calls[0][0].where.state).toEqual({
        in: ['delivered', 'finished'],
      });

      prisma.orders.findMany.mockClear();
      prisma.orders.findMany.mockResolvedValue([]);

      await service.getOrdersForExport(QUERY as any, {
        states: ['cancelled', 'refunded'] as any,
      });
      expect(prisma.orders.findMany.mock.calls[0][0].where.state).toEqual({
        in: ['cancelled', 'refunded'],
      });
    });

    it('returns RAW dates (Date instances), not formatted strings', async () => {
      const createdAt = new Date('2026-07-08T15:30:00.000Z');
      prisma.orders.findMany.mockResolvedValue([
        makeOrder({
          id: 11,
          order_number: 'O-2',
          grand_total: 100,
          itemCount: 1,
          created_at: createdAt,
        }),
      ]);

      const result = await service.getOrdersForExport(QUERY as any);

      expect(result.orders[0].created_at).toBeInstanceOf(Date);
      expect(result.orders[0].created_at).toEqual(createdAt);
      expect(typeof result.orders[0].created_at).not.toBe('string');
      // paid_at is also raw.
      expect(result.orders[0].paid_at).toBeInstanceOf(Date);
    });

    it('DATA-COMPLETE-2: exposes cheap corporate columns (document, currency, payment method)', async () => {
      prisma.orders.findMany.mockResolvedValue([
        makeOrder({
          id: 12,
          order_number: 'O-3',
          grand_total: 100,
          itemCount: 1,
        }),
      ]);

      const result = await service.getOrdersForExport(QUERY as any);
      const row = result.orders[0];

      expect(row.customer_document).toBe('900123456');
      expect(row.customer_document_type).toBe('NIT');
      expect(row.currency).toBe('COP');
      expect(row.payment_method).toBe('Efectivo');
      expect(row.customer_name).toBe('Ada Lovelace');
    });
  });
});
