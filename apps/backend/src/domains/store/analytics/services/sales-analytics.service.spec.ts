import { SalesAnalyticsService } from './sales-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * SalesAnalyticsService.getOrdersForExport are declared; everything else is
 * `any` so the service constructor accepts it.
 */
type MockStorePrismaService = {
  orders: { findMany: jest.Mock };
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
      orders: { findMany: jest.fn() },
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

  // ==================== QUI-549: VENTAS POR CANAL ====================

  describe('getSalesByChannelForExport (QUI-549 + QUI-610 propagation)', () => {
    it('aggregates by channel, sorts by revenue desc, and computes % participation with 2-decimal rounding', async () => {
      prisma.orders.groupBy = prisma.orders.groupBy ?? jest.fn();
      // QUI-610: el servicio ahora deriva el ingreso de subtotal − discount + shipping
      // (ex-IVA), no de grand_total. El mock tiene que entregar los TRES componentes
      // que `computeOperatingRevenue` consume; sin descuentos ni flete, los totales
      // quedan iguales al subtotal (caso base sin IVA).
      prisma.orders.groupBy.mockResolvedValue([
        {
          channel: 'pos',
          _sum: {
            subtotal_amount: 600000,
            discount_amount: 0,
            shipping_cost: 0,
          },
          _count: { id: 12 },
        },
        {
          channel: 'ecommerce',
          _sum: {
            subtotal_amount: 300000,
            discount_amount: 0,
            shipping_cost: 0,
          },
          _count: { id: 8 },
        },
        {
          channel: 'agent',
          _sum: {
            subtotal_amount: 100000,
            discount_amount: 0,
            shipping_cost: 0,
          },
          _count: { id: 2 },
        },
      ] as any);

      const rows = await service.getSalesByChannelForExport({} as any);

      expect(rows).toHaveLength(3);
      // Total 1,000,000. POS 60%, ecommerce 30%, agent 10%.
      const pos = rows.find((r) => r.channel === 'pos');
      expect(pos!.revenue).toBe(600000);
      expect(pos!.order_count).toBe(12);
      expect(pos!.percentage).toBe(60);
      expect(pos!.display_name).toBe('Punto de Venta');

      const ecom = rows.find((r) => r.channel === 'ecommerce');
      expect(ecom!.revenue).toBe(300000);
      expect(ecom!.percentage).toBe(30);
      expect(ecom!.display_name).toBe('Tienda Online');

      const agent = rows.find((r) => r.channel === 'agent');
      expect(agent!.revenue).toBe(100000);
      expect(agent!.percentage).toBe(10);
      expect(agent!.display_name).toBe('Agente IA');

      // Sort: POS (600k) > ecommerce (300k) > agent (100k).
      expect(rows[0].channel).toBe('pos');
      expect(rows[1].channel).toBe('ecommerce');
      expect(rows[2].channel).toBe('agent');
    });

    it('excludes VAT from channel revenue (subtotal − discount + shipping, not grand_total)', async () => {
      prisma.orders.groupBy = prisma.orders.groupBy ?? jest.fn();
      // Si se mantuviera la antigua SUM(grand_total), POS daría 1_190_000
      // (1_000_000 + 19 % IVA). Con el contract, el ingreso es exactamente
      // subtotal − discount + shipping = 1_000_000, sin IVA. La diferencia
      // del 19 % es la garantía de que la propagación de QUI-610 está viva
      // y no solo cambia el nombre de la columna.
      prisma.orders.groupBy.mockResolvedValue([
        {
          channel: 'pos',
          _sum: {
            subtotal_amount: 1_000_000,
            discount_amount: 0,
            shipping_cost: 0,
          },
          _count: { id: 10 },
        },
      ] as any);

      const rows = await service.getSalesByChannelForExport({} as any);
      expect(rows).toHaveLength(1);
      expect(rows[0].revenue).toBe(1_000_000); // ex-VAT, no 1_190_000
      expect(rows[0].percentage).toBe(100);
    });

    it('returns empty array (not paginated envelope) when no channels have sales', async () => {
      prisma.orders.groupBy = prisma.orders.groupBy ?? jest.fn();
      prisma.orders.groupBy.mockResolvedValue([] as any);
      const rows = await service.getSalesByChannelForExport({} as any);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
      expect((rows as any).data).toBeUndefined();
    });
  });
});
