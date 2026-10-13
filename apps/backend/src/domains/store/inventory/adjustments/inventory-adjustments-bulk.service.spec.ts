import * as XLSX from 'xlsx';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('InventoryAdjustmentsBulkService — variantes', () => {
  const mockPrisma = {
    products: { findFirst: jest.fn() },
    product_variants: { findFirst: jest.fn() },
    stock_levels: { findFirst: jest.fn(), findMany: jest.fn() },
  };
  const mockAdjustments = { batchCreateAndCompleteSettled: jest.fn() };
  let service: InventoryAdjustmentsBulkService;

  const xlsx = (rows: any[][]): Buffer => {
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'Cantidad Nueva'], ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const dto: any = { location_id: 7 };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new InventoryAdjustmentsBulkService(
      mockPrisma as any,
      mockAdjustments as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 3,
    } as any);
    mockAdjustments.batchCreateAndCompleteSettled.mockImplementation(
      async (_l: number, items: any[]) =>
        items.map((_, index) => ({ index, ok: true })),
    );
  });

  it('SKU de producto simple: ajusta sin product_variant_id', async () => {
    mockPrisma.products.findFirst.mockResolvedValue({
      id: 1,
      name: 'Cafe',
      sku: 'CAFE',
      track_inventory: true,
      product_variants: [],
    });
    mockPrisma.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: 4 });

    const res = await service.uploadFromFile(xlsx([['CAFE', 10]]), dto);

    expect(mockPrisma.stock_levels.findFirst.mock.calls[0][0].where).toEqual({
      product_id: 1,
      product_variant_id: null,
      location_id: 7,
    });
    const items =
      mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1];
    expect(items[0].product_id).toBe(1);
    expect(items[0].product_variant_id).toBeUndefined();
    expect(res.successful).toBe(1);
    expect(res.results[0].quantity_before).toBe(4);
  });

  it('SKU de variante: manda product_variant_id y lee stock de la variante', async () => {
    mockPrisma.products.findFirst.mockResolvedValue(null);
    mockPrisma.product_variants.findFirst.mockResolvedValue({
      id: 22,
      product_id: 5,
      name: 'Rojo',
      track_inventory_override: null,
      products: { name: 'Camisa', track_inventory: true },
    });
    mockPrisma.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: 2 });

    const res = await service.uploadFromFile(xlsx([['CAM-R', 9]]), dto);

    expect(mockPrisma.stock_levels.findFirst.mock.calls[0][0].where).toEqual({
      product_id: 5,
      product_variant_id: 22,
      location_id: 7,
    });
    const items =
      mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1];
    expect(items[0]).toMatchObject({
      product_id: 5,
      product_variant_id: 22,
      quantity_after: 9,
    });
    expect(res.results[0]).toMatchObject({
      status: 'success',
      quantity_before: 2,
      quantity_change: 7,
      product_name: 'Camisa - Rojo',
    });
  });

  it('SKU padre con variantes: error de fila y no ajusta', async () => {
    mockPrisma.products.findFirst.mockResolvedValue({
      id: 5,
      name: 'Camisa',
      sku: 'CAM',
      track_inventory: true,
      product_variants: [{ sku: 'CAM-R' }, { sku: 'CAM-A' }],
    });

    const res = await service.uploadFromFile(xlsx([['CAM', 3]]), dto);

    expect(res.failed).toBe(1);
    expect(res.results[0].status).toBe('error');
    expect(res.results[0].message).toContain('maneja variantes');
    expect(res.results[0].message).toContain('CAM-R, CAM-A');
    expect(
      mockAdjustments.batchCreateAndCompleteSettled,
    ).not.toHaveBeenCalled();
  });

  it('SKU inexistente: error de fila', async () => {
    mockPrisma.products.findFirst.mockResolvedValue(null);
    mockPrisma.product_variants.findFirst.mockResolvedValue(null);

    const res = await service.uploadFromFile(xlsx([['NOPE', 3]]), dto);

    expect(res.failed).toBe(1);
    expect(res.results[0].message).toContain('no encontrado');
  });

  it('cantidad igual al stock de la variante: sin cambios (incluye 0 == 0)', async () => {
    mockPrisma.products.findFirst.mockResolvedValue(null);
    mockPrisma.product_variants.findFirst.mockResolvedValue({
      id: 22,
      product_id: 5,
      name: null,
      track_inventory_override: null,
      products: { name: 'Camisa', track_inventory: true },
    });
    mockPrisma.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: 6 });

    const res = await service.uploadFromFile(xlsx([['CAM-R', 6]]), dto);

    expect(res.results[0].message).toContain('Sin cambios');
    expect(res.results[0].quantity_before).toBe(6);
    expect(
      mockAdjustments.batchCreateAndCompleteSettled,
    ).not.toHaveBeenCalled();
  });

  it('plantilla prellenada: SKU de variante y omite base huérfana', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      {
        product_variant_id: 22,
        quantity_on_hand: 5,
        products: { sku: 'CAM', name: 'Camisa', _count: { product_variants: 2 } },
        product_variants: { sku: 'CAM-R', name: 'Rojo' },
      },
      {
        product_variant_id: null,
        quantity_on_hand: 3,
        products: { sku: 'CAM', name: 'Camisa', _count: { product_variants: 2 } },
        product_variants: null,
      },
      {
        product_variant_id: null,
        quantity_on_hand: 8,
        products: { sku: 'CAFE', name: 'Cafe', _count: { product_variants: 0 } },
        product_variants: null,
      },
    ]);

    const buf = await service.generateExcelTemplate(7);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    expect(rows.map((r) => r['SKU'])).toEqual(['CAM-R', 'CAFE']);
    expect(rows[0]['Nombre Producto']).toBe('Camisa - Rojo');
  });
});
