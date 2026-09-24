import { InventoryAnalyticsService } from './inventory-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * InventoryAnalyticsService (in the paths exercised here) are declared;
 * everything else is `any` so the service constructor accepts it.
 */
type MockStorePrismaService = {
  products: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
  inventory_movements: { findMany: jest.Mock };
  supplier_products: { findMany: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

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

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      products: { findMany: jest.fn() },
      // resolveStoreTimezone / loadMergedSettings read store_settings.findFirst;
      // null -> DEFAULT_STORE_TIMEZONE ('America/Bogota') + default settings.
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      inventory_movements: { findMany: jest.fn() },
      supplier_products: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      withoutScope: jest.fn().mockReturnValue({
        $queryRaw: jest.fn().mockResolvedValue([]),
      }),
    } as MockStorePrismaService;

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 1,
      organization_id: 1,
      is_super_admin: false,
      is_owner: false,
    } as any);

    service = new InventoryAnalyticsService(prisma as any, {} as any);
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

  // ==================== QUI-545: STOCK BAJO / PUNTOS DE REORDEN ====================

  describe('getLowStockForExport (QUI-545)', () => {
    it('returns ONLY products where stock_quantity <= reorder_point, with stock_value_at_risk = qty * cost_price rounded to 2 decimals', async () => {
      prisma.products.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Coca-Cola 350ml',
          sku: 'CC350',
          product_images: [],
          stock_quantity: 2,
          cost_price: 1500,
          min_stock_level: 5,
          reorder_point: 10,
        },
        {
          id: 2,
          name: 'Galletas Festival',
          sku: 'GAL-FES',
          product_images: [{ image_url: 'https://cdn/festival.jpg' }],
          stock_quantity: 50, // > reorder_point, debe excluirse
          cost_price: 800,
          min_stock_level: 5,
          reorder_point: 10,
        },
        {
          id: 3,
          name: 'Chocorramo',
          sku: 'CHOCO',
          product_images: [],
          stock_quantity: 0, // out_of_stock
          cost_price: 2000,
          min_stock_level: 3,
          reorder_point: 5,
        },
      ] as any);

      const rows = await service.getLowStockForExport({} as any);

      // 2 de 3 productos (el segundo está sobre el reorder_point).
      expect(rows).toHaveLength(2);
      // Coca-Cola: stock 2 * cost 1500 = 3000.00
      const coca = rows.find((r) => r.product_id === 1);
      expect(coca).toBeDefined();
      expect(coca!.stock_quantity).toBe(2);
      expect(coca!.reorder_point).toBe(10);
      expect(coca!.min_stock_level).toBe(5);
      expect(coca!.status).toBe('low_stock');
      expect(coca!.stock_value_at_risk).toBe(3000);
      // Chocorramo: stock 0 → out_of_stock, value 0.
      const choco = rows.find((r) => r.product_id === 3);
      expect(choco).toBeDefined();
      expect(choco!.stock_quantity).toBe(0);
      expect(choco!.status).toBe('out_of_stock');
      expect(choco!.stock_value_at_risk).toBe(0);
      // Galletas Festival NO debe estar en el resultado.
      expect(rows.find((r) => r.product_id === 2)).toBeUndefined();
    });

    it('returns a flat array (not the {data,meta} envelope that getLowStockAlerts produces with page+limit)', async () => {
      prisma.products.findMany.mockResolvedValue([]);
      const rows = await service.getLowStockForExport({} as any);
      expect(Array.isArray(rows)).toBe(true);
      expect((rows as any).data).toBeUndefined();
      expect((rows as any).meta).toBeUndefined();
    });

    it('handles cost_price = 0 (free product) and null cost_price without throwing, returning stock_value_at_risk = 0', async () => {
      // Edge case: productos con costo 0 o sin costo registrado (por ejemplo,
      // muestras gratis o ítems sin precio de compra todavía). El cálculo
      // `qty * cost` debe tolerarlo sin NaN ni excepciones, y reportar
      // `stock_value_at_risk = 0` para que el reporte no muestre $NaN o rompa
      // la suma del footer.
      prisma.products.findMany.mockResolvedValue([
        {
          id: 4,
          name: 'Muestra Gratis',
          sku: 'SAMPLE-1',
          product_images: [],
          stock_quantity: 1,
          cost_price: 0, // costo cero explícito
          min_stock_level: 1,
          reorder_point: 2,
        },
        {
          id: 5,
          name: 'Sin Costo Registrado',
          sku: 'NULL-COST',
          product_images: [],
          stock_quantity: 1,
          cost_price: null, // sin costo
          min_stock_level: 1,
          reorder_point: 2,
        },
      ] as any);

      const rows = await service.getLowStockForExport({} as any);

      expect(rows).toHaveLength(2);
      const free = rows.find((r) => r.product_id === 4);
      expect(free).toBeDefined();
      expect(free!.stock_value_at_risk).toBe(0);
      expect(Number.isNaN(free!.stock_value_at_risk)).toBe(false);
      expect(free!.status).toBe('low_stock');
      const noCost = rows.find((r) => r.product_id === 5);
      expect(noCost).toBeDefined();
      expect(noCost!.stock_value_at_risk).toBe(0);
      expect(Number.isNaN(noCost!.stock_value_at_risk)).toBe(false);
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
    it('counts come from the scoped store products; value AND quantity come from the valuation (same universe), never the product loop', async () => {
      // Scoped product universe: 3 SKUs -> 1 out_of_stock (0), 1 low (<=5), 1 in.
      prisma.products.findMany.mockResolvedValue([
        { id: 1, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
        { id: 2, stock_quantity: 3, min_stock_level: 0, reorder_point: 5 },
        { id: 3, stock_quantity: 50, min_stock_level: 0, reorder_point: 5 },
      ]);

      // Valuation is authoritative for value + on-hand quantity (store universe).
      //
      // La forma es `{ rows, coverage, totals }`, no un arreglo suelto: el total
      // viaja junto a su cobertura de costo porque un valor calculado sobre
      // unidades sin costo registrado está SUBESTIMADO, y sin la cobertura al
      // lado "vale poco" y "no sabemos cuánto vale" se ven idénticos.
      const valuationSpy = jest
        .spyOn(service, 'getInventoryValuation')
        .mockResolvedValue({
          rows: [
            {
              location_id: 1,
              location_name: 'A',
              total_quantity: 200,
              total_value: 5000,
              average_cost: 25,
              percentage_of_total: 100,
            },
          ],
          coverage: {
            units_total: 200,
            units_without_cost: 0,
            coverage_ratio: 1,
            is_authoritative: true,
          },
          totals: {
            total_quantity: 200,
            total_value: 5000,
            average_cost: 25,
            total_locations: 1,
          },
        } as any);

      const summary = await service.getInventorySummary({} as any);

      expect(summary.total_sku_count).toBe(3);
      expect(summary.out_of_stock_count).toBe(1);
      expect(summary.low_stock_count).toBe(1);

      // The fix: value AND quantity are from the valuation (same universe), NOT
      // the product loop (which would total 53 units, not 200).
      expect(summary.total_stock_value).toBe(5000);
      expect(summary.total_quantity_on_hand).toBe(200);

      // The counts read the scoped client, never an org-wide withoutScope read.
      expect(prisma.products.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.withoutScope).not.toHaveBeenCalled();
      expect(valuationSpy).toHaveBeenCalledTimes(1);
    });

    // ==================== QUI-553 ====================

    it('QUI-553: the product universe stays the STORE even for an ORGANIZATION-scope org — never withoutScope + stores.organization_id', async () => {
      // Store products of the CURRENT store only: 2 SKUs -> 1 agotado, 1 sano.
      prisma.products.findMany.mockResolvedValue([
        { id: 1, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
        { id: 2, stock_quantity: 100, min_stock_level: 0, reorder_point: 5 },
      ]);

      // Any org-wide read would have to come through withoutScope(); if the
      // service ever widens the universe again, this spy catches it.
      const orgProductsFindMany = jest.fn().mockResolvedValue([
        { id: 1, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
        { id: 2, stock_quantity: 100, min_stock_level: 0, reorder_point: 5 },
        { id: 3, stock_quantity: 0, min_stock_level: 0, reorder_point: 5 },
      ]);
      prisma.withoutScope.mockReturnValue({
        products: { findMany: orgProductsFindMany },
      });

      jest.spyOn(service, 'getInventoryValuation').mockResolvedValue({
        rows: [
          {
            location_id: 1,
            location_name: 'A',
            total_quantity: 10,
            total_value: 100,
            average_cost: 10,
            percentage_of_total: 100,
          },
        ],
        coverage: {
          units_total: 10,
          units_without_cost: 0,
          coverage_ratio: 1,
          is_authoritative: true,
        },
        totals: {
          total_quantity: 10,
          total_value: 100,
          average_cost: 10,
          total_locations: 1,
        },
      } as any);

      const summary = await service.getInventorySummary({} as any);

      expect(orgProductsFindMany).not.toHaveBeenCalled();
      expect(prisma.products.findMany).toHaveBeenCalledTimes(1);
      const whereArg = prisma.products.findMany.mock.calls[0][0].where;
      expect(whereArg.stores).toBeUndefined();
      expect(whereArg.state).toBe('active');
      expect(whereArg.track_inventory).toBe(true);

      // Counts describe the store universe (2 SKUs), not the org one (3).
      expect(summary.total_sku_count).toBe(2);
      expect(summary.out_of_stock_count).toBe(1);
      expect(summary.total_stock_value).toBe(100);
      expect(summary.total_quantity_on_hand).toBe(10);
    });

    it('QUI-553: rejects with a typed store-context error when there is no store in context, instead of consolidating the organization', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        organization_id: 1,
        store_id: undefined,
        is_super_admin: false,
        is_owner: false,
      } as any);

      await expect(service.getInventorySummary({} as any)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(prisma.products.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getInventoryValuation (QUI-553: store-only locations)', () => {
    /** Wires withoutScope() with the two readers the valuation walks. */
    function mockValuationClient() {
      const stockLevelsFindMany = jest.fn().mockResolvedValue([]);
      const costLayersFindMany = jest.fn().mockResolvedValue([]);
      prisma.withoutScope.mockReturnValue({
        stock_levels: { findMany: stockLevelsFindMany },
        inventory_cost_layers: { findMany: costLayersFindMany },
      });
      return { stockLevelsFindMany, costLayersFindMany };
    }

    it('restricts stock_levels AND cost layers to the current store, so org-level locations (store_id NULL) are excluded', async () => {
      const { stockLevelsFindMany, costLayersFindMany } = mockValuationClient();

      await service.getInventoryValuation({} as any);

      expect(stockLevelsFindMany.mock.calls[0][0].where.inventory_locations).toEqual(
        { organization_id: 1, store_id: 1 },
      );
      expect(costLayersFindMany.mock.calls[0][0].where.inventory_locations).toEqual(
        { organization_id: 1, store_id: 1 },
      );
    });

    it('carries the store filter into the historical (as_of) snapshot read', async () => {
      const snapshotsFindMany = jest.fn().mockResolvedValue([]);
      prisma.withoutScope.mockReturnValue({
        inventory_valuation_snapshots: { findMany: snapshotsFindMany },
      });

      await service.getInventoryValuation({ as_of: '2026-07-01' } as any);

      expect(snapshotsFindMany.mock.calls[0][0].where.store_id).toBe(1);
      expect(snapshotsFindMany.mock.calls[0][0].where.organization_id).toBe(1);
    });

    it('rejects with a typed store-context error when there is no store in context', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        organization_id: 1,
        store_id: undefined,
        is_super_admin: false,
        is_owner: false,
      } as any);
      mockValuationClient();

      await expect(
        service.getInventoryValuation({} as any),
      ).rejects.toBeInstanceOf(VendixHttpException);
      expect(prisma.withoutScope).not.toHaveBeenCalled();
    });
  });

  // ==================== QUI-550: GET-INVENTORY-BY-SUPPLIER-FOR-EXPORT ====================

  // ==================== QUI-550: INVENTORY BY SUPPLIER REPORT ====================

  describe('Inventory by Supplier Report (QUI-550)', () => {
    const sampleLinks = [
      {
        supplier_id: 10,
        product_id: 1,
        cost_per_unit: 1500,
        is_preferred: true,
        suppliers: {
          id: 10,
          name: 'Distribuidora Andina',
          code: 'AND',
          tax_id: '900123456',
          verification_digit: '1',
        },
        products: {
          id: 1,
          name: 'Producto A',
          sku: 'SKU-A',
          stock_quantity: 100,
          cost_price: 1500,
        },
      },
      {
        supplier_id: 10,
        product_id: 2,
        cost_per_unit: 800,
        is_preferred: true,
        suppliers: {
          id: 10,
          name: 'Distribuidora Andina',
          code: 'AND',
          tax_id: '900123456',
          verification_digit: '1',
        },
        products: {
          id: 2,
          name: 'Producto B',
          sku: 'SKU-B',
          stock_quantity: 50,
          cost_price: 800,
        },
      },
      {
        supplier_id: 20,
        product_id: 3,
        cost_per_unit: 2000,
        is_preferred: true,
        suppliers: {
          id: 20,
          name: 'Post Colombiano SA',
          code: 'COL',
          tax_id: null,
          verification_digit: null,
        },
        products: {
          id: 3,
          name: 'Producto C',
          sku: 'SKU-C',
          stock_quantity: 200,
          cost_price: 2000,
        },
      },
    ];

    describe('getInventoryBySupplier (preview / pagination)', () => {
      it('returns paginated data with calculated fields, document formatting and aggregated totals', async () => {
        prisma.supplier_products.findMany.mockResolvedValue(sampleLinks as any);

        const result = await service.getInventoryBySupplier({
          page: 1,
          limit: 10,
        } as any);

        expect(result).toBeDefined();
        expect(result.data).toHaveLength(2);

        // First item sorted by total_stock_value descending: Post Colombiano (400000)
        const col = result.data.find((r) => r.supplier_id === 20);
        expect(col).toBeDefined();
        expect(col!.supplier_name).toBe('Post Colombiano SA');
        expect(col!.supplier_document).toBe('COL'); // Fallback to code when tax_id is null
        expect(col!.product_count).toBe(1);
        expect(col!.total_units_on_hand).toBe(200);
        expect(col!.total_units_reserved).toBe(0);
        expect(col!.total_units_available).toBe(200);
        expect(col!.total_stock_value).toBe(400000);
        expect(col!.avg_unit_cost).toBe(2000);
        expect(col!.top_product_name).toBe('Producto C');

        // Second item: Distribuidora Andina (190000)
        const andina = result.data.find((r) => r.supplier_id === 10);
        expect(andina).toBeDefined();
        expect(andina!.supplier_name).toBe('Distribuidora Andina');
        expect(andina!.supplier_document).toBe('900123456-1'); // Formatted tax_id + verification_digit
        expect(andina!.product_count).toBe(2);
        expect(andina!.total_units_on_hand).toBe(150);
        expect(andina!.total_units_reserved).toBe(0);
        expect(andina!.total_units_available).toBe(150);
        // total_stock_value = (100 * 1500) + (50 * 800) = 150000 + 40000 = 190000
        expect(andina!.total_stock_value).toBe(190000);
        // avg_unit_cost = 190000 / 150 = 1266.67
        expect(andina!.avg_unit_cost).toBe(1266.67);
        // Top product: Producto A (value 150000 vs 40000)
        expect(andina!.top_product_name).toBe('Producto A');

        // Metadata and global totals
        expect(result.meta.pagination.total).toBe(2);
        expect(result.meta.pagination.page).toBe(1);
        expect(result.meta.pagination.limit).toBe(10);
        expect(result.meta.totals.product_count).toBe(3);
        expect(result.meta.totals.total_units_on_hand).toBe(350);
        expect(result.meta.totals.total_units_available).toBe(350);
        expect(result.meta.totals.total_stock_value).toBe(590000);
      });

      it('filters rows by search term across supplier name and document', async () => {
        prisma.supplier_products.findMany.mockResolvedValue(sampleLinks as any);

        const result = await service.getInventoryBySupplier({
          search: 'Andina',
        } as any);

        expect(result.data).toHaveLength(1);
        expect(result.data[0].supplier_name).toBe('Distribuidora Andina');
        expect(result.meta.totals.total_stock_value).toBe(190000);
      });

      it('paginates correctly when limit is smaller than total rows', async () => {
        prisma.supplier_products.findMany.mockResolvedValue(sampleLinks as any);

        const result = await service.getInventoryBySupplier({
          page: 2,
          limit: 1,
        } as any);

        expect(result.data).toHaveLength(1);
        expect(result.meta.pagination.page).toBe(2);
        expect(result.meta.pagination.limit).toBe(1);
        expect(result.meta.pagination.total).toBe(2);
        expect(result.meta.pagination.totalPages).toBe(2);
        expect(result.meta.pagination.hasNextPage).toBe(false);
        expect(result.meta.pagination.hasPreviousPage).toBe(true);
      });

      it('returns empty dataset with zero totals when no products are found', async () => {
        prisma.supplier_products.findMany.mockResolvedValue([]);

        const result = await service.getInventoryBySupplier({} as any);

        expect(result.data).toEqual([]);
        expect(result.meta.pagination.total).toBe(0);
        expect(result.meta.totals).toEqual({
          product_count: 0,
          total_units_on_hand: 0,
          total_units_reserved: 0,
          total_units_available: 0,
          total_stock_value: 0,
        });
      });

      it('resolves supplier from purchase orders when supplier_products is empty', async () => {
        prisma.supplier_products.findMany.mockResolvedValue([]);

        const mockWithoutScope = {
          $queryRaw: jest.fn().mockImplementation((queryArg: any) => {
            const sql = queryArg?.strings?.join(' ') ?? '';
            if (sql.includes('purchase_order_items')) {
              return Promise.resolve([
                {
                  supplier_id: 30,
                  product_id: 5,
                  cost_per_unit: 25000,
                  s_id: 30,
                  s_name: 'Proveedor Directo POP',
                  s_code: 'PDP',
                  s_tax_id: '800555666',
                  s_verification_digit: '7',
                  p_id: 5,
                  p_name: 'Repuesto Moto X',
                  p_sku: 'RMX-001',
                  p_stock_quantity: 4,
                  p_cost_price: 25000,
                },
              ]);
            }
            if (sql.includes('stock_levels')) {
              return Promise.resolve([
                {
                  product_id: 5,
                  on_hand: 4,
                  reserved: 1,
                  available: 3,
                  cost_per_unit: 25000,
                },
              ]);
            }
            return Promise.resolve([]);
          }),
        };
        (prisma as any).withoutScope.mockReturnValue(mockWithoutScope);

        const result = await service.getInventoryBySupplier({} as any);

        expect(result.data).toHaveLength(1);
        const row = result.data[0];
        expect(row.supplier_id).toBe(30);
        expect(row.supplier_name).toBe('Proveedor Directo POP');
        expect(row.supplier_document).toBe('800555666-7');
        expect(row.product_count).toBe(1);
        expect(row.total_units_on_hand).toBe(4);
        expect(row.total_units_reserved).toBe(1);
        expect(row.total_units_available).toBe(3);
        expect(row.total_stock_value).toBe(100000);
        expect(row.avg_unit_cost).toBe(25000);
        expect(row.top_product_name).toBe('Repuesto Moto X');
      });
    });

    describe('getInventoryBySupplierForExport (complete dataset)', () => {
      it('returns unpaginated rows and totals for export', async () => {
        prisma.supplier_products.findMany.mockResolvedValue(sampleLinks as any);

        const result = await service.getInventoryBySupplierForExport({} as any);

        expect(result.rows).toHaveLength(2);
        expect(result.totals.total_stock_value).toBe(590000);
        expect(result.totals.total_units_on_hand).toBe(350);
      });

      it('incorporates stock_levels quantities and costs when available', async () => {
        prisma.supplier_products.findMany.mockResolvedValue([
          sampleLinks[0], // Product 1
        ] as any);

        // Mock stock_levels query via withoutScope().$queryRaw
        const mockWithoutScope = {
          $queryRaw: jest.fn().mockResolvedValue([
            {
              product_id: 1,
              on_hand: 80,
              reserved: 10,
              available: 70,
              cost_per_unit: 1400,
            },
          ]),
        };
        (prisma as any).withoutScope.mockReturnValue(mockWithoutScope);

        const result = await service.getInventoryBySupplierForExport({} as any);

        expect(result.rows).toHaveLength(1);
        const row = result.rows[0];
        expect(row.total_units_on_hand).toBe(80);
        expect(row.total_units_reserved).toBe(10);
        expect(row.total_units_available).toBe(70);
        expect(row.total_stock_value).toBe(80 * 1400); // 112000
        expect(row.avg_unit_cost).toBe(1400);
      });
    });
  });

  // ==================== INGREDIENT CONSUMPTION ====================

  describe('getIngredientConsumption & getIngredientConsumptionForExport', () => {
    const rawConsumptionRows = [
      {
        ingredient_id: 7,
        ingredient_name: 'Pechuga de Pollo',
        ingredient_sku: 'POLLO-01',
        ingredient_unit: 'kg',
        dish_id: 30,
        dish_name: 'Barril Pollo',
        transaction_count: 5,
        orders_count: 5,
        dish_quantity: '10',
        consumed_quantity: '5.5',
        avg_unit_cost: '18000',
        total_cost: '99000',
      },
      {
        ingredient_id: 7,
        ingredient_name: 'Pechuga de Pollo',
        ingredient_sku: 'POLLO-01',
        ingredient_unit: 'kg',
        dish_id: 31,
        dish_name: 'Barril Mixto',
        transaction_count: 3,
        orders_count: 3,
        dish_quantity: '5',
        consumed_quantity: '2.5',
        avg_unit_cost: '18000',
        total_cost: '45000',
      },
      {
        ingredient_id: 15,
        ingredient_name: 'Papas Francesas',
        ingredient_sku: 'PAPA-01',
        ingredient_unit: 'kg',
        dish_id: 30,
        dish_name: 'Barril Pollo',
        transaction_count: 5,
        orders_count: 5,
        dish_quantity: '10',
        consumed_quantity: '4',
        avg_unit_cost: '5000',
        total_cost: '20000',
      },
    ];

    it('returns ingredient consumption grouped by ingredient by default', async () => {
      const queryRawMock = jest.fn().mockResolvedValue(rawConsumptionRows);
      prisma.withoutScope.mockReturnValue({
        $queryRaw: queryRawMock,
      });

      const result = await service.getIngredientConsumption({
        date_from: '2026-09-01',
        date_to: '2026-09-14',
      } as any);

      expect(result.data).toHaveLength(3);
      expect(result.data[0].section).toBe('Pechuga de Pollo (kg)');
      expect(result.data[0].ingredient_name).toBe('Pechuga de Pollo');
      expect(result.data[0].dish_name).toBe('Barril Pollo');
      expect(result.data[0].consumed_quantity).toBe(5.5);
      expect(result.data[0].total_cost).toBe(99000);

      expect(result.data[2].section).toBe('Papas Francesas (kg)');
      expect(result.data[2].total_cost).toBe(20000);

      // Meta totals
      expect(result.meta.totals.total_cost).toBe(164000);
      expect(result.meta.totals.total_ingredients).toBe(2);
      expect(result.meta.totals.total_dishes).toBe(2);
      expect(result.meta.totals.total_movements).toBe(13);
      expect(result.meta.group_by).toBe('ingredient');
    });

    it('supports grouping by dish (group_by: "dish")', async () => {
      const queryRawMock = jest.fn().mockResolvedValue(rawConsumptionRows);
      prisma.withoutScope.mockReturnValue({
        $queryRaw: queryRawMock,
      });

      const result = await service.getIngredientConsumption({
        date_from: '2026-09-01',
        date_to: '2026-09-14',
        group_by: 'dish',
      } as any);

      expect(result.data).toHaveLength(3);
      expect(result.data[0].section).toBe('Barril Pollo (10 prep.)');
      expect(result.data[1].section).toBe('Barril Mixto (5 prep.)');
      expect(result.meta.group_by).toBe('dish');
    });

    it('rejects with STORE_CONTEXT_001 when store_id is missing', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        organization_id: 1,
        store_id: undefined,
      } as any);

      await expect(service.getIngredientConsumption({} as any)).rejects.toThrow(
        VendixHttpException,
      );
    });

    it('getIngredientConsumptionForExport returns two sheets (summaryRows and detailRows)', async () => {
      const queryRawMock = jest.fn().mockResolvedValue(rawConsumptionRows);
      prisma.withoutScope.mockReturnValue({
        $queryRaw: queryRawMock,
      });

      const result = await service.getIngredientConsumptionForExport({
        date_from: '2026-09-01',
        date_to: '2026-09-14',
      } as any);

      expect(result.summaryRows).toHaveLength(2);
      const polloSummary = result.summaryRows.find(
        (s) => s.ingredient_name === 'Pechuga de Pollo',
      );
      expect(polloSummary).toBeDefined();
      expect(polloSummary!.total_consumed).toBe(8);
      expect(polloSummary!.total_cost).toBe(144000);
      expect(polloSummary!.associated_dishes).toContain('Barril Pollo');
      expect(polloSummary!.associated_dishes).toContain('Barril Mixto');

      const papaSummary = result.summaryRows.find(
        (s) => s.ingredient_name === 'Papas Francesas',
      );
      expect(papaSummary).toBeDefined();
      expect(papaSummary!.total_consumed).toBe(4);
      expect(papaSummary!.total_cost).toBe(20000);

      expect(result.detailRows).toHaveLength(3);
    });
  });
});
