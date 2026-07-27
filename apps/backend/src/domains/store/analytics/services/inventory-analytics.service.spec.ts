import { InventoryAnalyticsService } from './inventory-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * InventoryAnalyticsService (in the paths exercised here) are declared;
 * everything else is `any` so the service constructor accepts it.
 */
type MockStorePrismaService = {
  products: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  inventory_movements: { findMany: jest.Mock };
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

type MockOperatingScopeService = {
  getOperatingScope: jest.Mock;
} & Partial<OperatingScopeService>;

/** Builds `count` product rows for the stock-levels reader. */
function buildProducts(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Producto ${i + 1}`,
    sku: `SKU-${i + 1}`,
    product_images: [],
    stock_quantity: i, // varied so statuses differ
    cost_price: 10,
    min_stock_level: 0,
    max_stock_level: 1000,
    reorder_point: 5,
  }));
}

describe('InventoryAnalyticsService', () => {
  let service: InventoryAnalyticsService;
  let prisma: MockStorePrismaService;
  let operatingScope: MockOperatingScopeService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      products: { findMany: jest.fn() },
      // resolveStoreTimezone / loadMergedSettings read store_settings.findFirst;
      // null -> DEFAULT_STORE_TIMEZONE ('America/Bogota') + default settings.
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      inventory_movements: { findMany: jest.fn() },
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    operatingScope = {
      getOperatingScope: jest.fn().mockResolvedValue('STORE'),
    };

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
      is_owner: false,
    } as any);

    service = new InventoryAnalyticsService(
      prisma as any,
      operatingScope as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== DATA-COMPLETE-7 ====================

  describe('getStockLevelsForExport (DATA-COMPLETE-7)', () => {
    it('returns the COMPLETE array (not a {data,meta} envelope) even past 100 rows, ignoring page/limit', async () => {
      prisma.products.findMany.mockResolvedValue(buildProducts(150));

      // The frontend sends page+limit; the export reader must ignore them and
      // return every row instead of a paginated envelope or a 100-row cap.
      const result = await service.getStockLevelsForExport({
        page: 1,
        limit: 50,
      } as any);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(150);
      // It is a flat array, NOT the paginated envelope that broke the export.
      expect((result as any).data).toBeUndefined();
      expect((result as any).meta).toBeUndefined();
      // Row carries raw numeric fields (no pre-formatting).
      expect(typeof result[0].total_value).toBe('number');
      expect(result[0]).toHaveProperty('product_id');
    });

    it('honors the status filter but still returns a flat array', async () => {
      prisma.products.findMany.mockResolvedValue(buildProducts(150));

      const result = await service.getStockLevelsForExport({
        status: 'out_of_stock',
      } as any);

      expect(Array.isArray(result)).toBe(true);
      // Only the single stock_quantity === 0 product qualifies.
      expect(result.every((r) => r.status === 'out_of_stock')).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('regression: getStockLevels(page+limit) returns the {data,meta} envelope that broke the CSV export', async () => {
      prisma.products.findMany.mockResolvedValue(buildProducts(150));

      const paged = await service.getStockLevels({
        page: 1,
        limit: 50,
      } as any);

      // This is the exact shape whose `.length` was undefined downstream.
      expect(Array.isArray(paged)).toBe(false);
      expect((paged as any).data).toHaveLength(50);
      expect((paged as any).meta.pagination.total).toBe(150);
    });
  });

  // ==================== RAW DATES ====================

  describe('getMovementsForExport (raw values)', () => {
    it('returns created_at as a RAW Date (no toISOString/split) and raw field keys (no Spanish headers, no presentation fallbacks)', async () => {
      const rawInstant = new Date('2026-07-15T23:30:00.000Z');
      prisma.inventory_movements.findMany.mockResolvedValue([
        {
          id: 7,
          created_at: rawInstant,
          product_id: 3,
          products: { name: 'Café', sku: 'CF-1' },
          from_location: null,
          to_location: { name: 'Bodega' },
          users: { username: 'ana' },
          movement_type: 'stock_in',
          quantity: 12,
          reason: 'compra',
          source_order_id: 99,
        },
      ]);

      const rows = await service.getMovementsForExport({
        date_from: '2026-07-01',
        date_to: '2026-07-31',
      } as any);

      expect(rows).toHaveLength(1);
      const row = rows[0];

      // Date is the raw instant, NOT a formatted 'YYYY-MM-DD' string.
      expect(row.created_at).toBeInstanceOf(Date);
      expect(row.created_at).toBe(rawInstant);

      // Raw English field keys — no Spanish header keys leaked as data keys.
      expect(row).not.toHaveProperty('Fecha');
      expect(row).not.toHaveProperty('Producto');
      expect(row).not.toHaveProperty('Cantidad');

      // Raw values: missing relations are null, not '-'/'Desconocido'.
      expect(row.product_name).toBe('Café');
      expect(row.sku).toBe('CF-1');
      expect(row.movement_type).toBe('stock_in');
      expect(row.quantity).toBe(12);
      expect(row.from_location).toBeNull();
      expect(row.to_location).toBe('Bodega');
      expect(row.user_name).toBe('ana');
      expect(row.reason).toBe('compra');
      expect(row.reference_id).toBe('99');
    });

    it('keeps created_at null when the movement has no timestamp (raw passthrough)', async () => {
      prisma.inventory_movements.findMany.mockResolvedValue([
        {
          id: 8,
          created_at: null,
          product_id: 4,
          products: null,
          from_location: null,
          to_location: null,
          users: null,
          movement_type: 'adjustment',
          quantity: 1,
          reason: null,
          source_order_id: null,
        },
      ]);

      const rows = await service.getMovementsForExport({
        date_from: '2026-07-01',
        date_to: '2026-07-31',
      } as any);

      expect(rows[0].created_at).toBeNull();
      expect(rows[0].product_name).toBeNull();
      expect(rows[0].reference_id).toBeNull();
    });
  });

  // ==================== DATA-SCOPE-1 ====================

  describe('getInventorySummary (DATA-SCOPE-1: one scope universe)', () => {
    it('STORE scope: counts come from the scoped store products; value AND quantity come from the valuation (same universe), never the product loop', async () => {
      operatingScope.getOperatingScope.mockResolvedValue('STORE');

      // Scoped product universe: 3 SKUs -> 1 out_of_stock (0), 1 low (<=5), 1 in.
      prisma.products.findMany.mockResolvedValue([
        { id: 1, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
        { id: 2, stock_quantity: 3, min_stock_level: 0, reorder_point: 5 },
        { id: 3, stock_quantity: 50, min_stock_level: 0, reorder_point: 5 },
      ]);

      // Valuation is authoritative for value + on-hand quantity (store universe).
      const valuationSpy = jest
        .spyOn(service, 'getInventoryValuation')
        .mockResolvedValue([
          {
            location_id: 1,
            location_name: 'A',
            total_quantity: 200,
            total_value: 5000,
            average_cost: 25,
            percentage_of_total: 100,
          },
        ] as any);

      const summary = await service.getInventorySummary({} as any);

      expect(summary.total_sku_count).toBe(3);
      expect(summary.out_of_stock_count).toBe(1);
      expect(summary.low_stock_count).toBe(1);

      // The fix: value AND quantity are from the valuation (same universe), NOT
      // the product loop (which would total 53 units, not 200).
      expect(summary.total_stock_value).toBe(5000);
      expect(summary.total_quantity_on_hand).toBe(200);

      // STORE scope reads the scoped client, never the org-wide withoutScope read.
      expect(prisma.products.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.withoutScope).not.toHaveBeenCalled();
      expect(valuationSpy).toHaveBeenCalledTimes(1);
    });

    it('ORGANIZATION scope: product universe is org-wide via withoutScope + stores.organization_id, matching the valuation universe', async () => {
      operatingScope.getOperatingScope.mockResolvedValue('ORGANIZATION');

      const orgProductsFindMany = jest.fn().mockResolvedValue([
        { id: 1, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
        { id: 2, stock_quantity: 100, min_stock_level: 0, reorder_point: 5 },
      ]);
      prisma.withoutScope.mockReturnValue({
        products: { findMany: orgProductsFindMany },
      });

      jest.spyOn(service, 'getInventoryValuation').mockResolvedValue([
        {
          location_id: 1,
          location_name: 'A',
          total_quantity: 10,
          total_value: 100,
          average_cost: 10,
          percentage_of_total: 20,
        },
        {
          location_id: 2,
          location_name: 'B',
          total_quantity: 20,
          total_value: 400,
          average_cost: 20,
          percentage_of_total: 80,
        },
      ] as any);

      const summary = await service.getInventorySummary({} as any);

      // Universe for counts is the org-wide products read, NOT the scoped client.
      expect(prisma.products.findMany).not.toHaveBeenCalled();
      expect(orgProductsFindMany).toHaveBeenCalledTimes(1);
      const whereArg = orgProductsFindMany.mock.calls[0][0].where;
      expect(whereArg.stores).toEqual({ organization_id: 1 });
      expect(whereArg.state).toBe('active');
      expect(whereArg.track_inventory).toBe(true);

      // Consolidated value + quantity summed across the org from the valuation.
      expect(summary.total_sku_count).toBe(2);
      expect(summary.out_of_stock_count).toBe(1);
      expect(summary.total_stock_value).toBe(500);
      expect(summary.total_quantity_on_hand).toBe(30);
    });
  });
});
