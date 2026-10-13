import * as XLSX from 'xlsx';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('InventoryAdjustmentsBulkService', () => {
  const mockPrisma = {
    products: { findMany: jest.fn() },
    product_variants: { findMany: jest.fn() },
    stock_levels: { findMany: jest.fn() },
  };
  const mockAdjustments = { batchCreateAndCompleteSettled: jest.fn() };
  const mockS3 = {
    uploadFile: jest.fn(),
    downloadImage: jest.fn(),
    deleteFile: jest.fn(),
  };
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
      mockS3 as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 3,
    } as any);
    mockPrisma.products.findMany.mockResolvedValue([]);
    mockPrisma.product_variants.findMany.mockResolvedValue([]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([]);
    mockAdjustments.batchCreateAndCompleteSettled.mockImplementation(
      async (_l: number, items: any[]) =>
        items.map((_, index) => ({ index, ok: true })),
    );
  });

  /** N productos simples SKU-0..SKU-(n-1) con stock 0. */
  const simpleProducts = (n: number) => {
    mockPrisma.products.findMany.mockImplementation(async ({ where }: any) =>
      where.sku.in
        .filter((sku: string) => /^SKU-\d+$/.test(sku))
        .map((sku: string) => ({
          id: Number(sku.split('-')[1]) + 1,
          name: sku,
          sku,
          track_inventory: true,
          product_variants: [],
        })),
    );
  };
  const manyRows = (n: number) =>
    Array.from({ length: n }, (_, i) => [`SKU-${i}`, 5]);

  it('SKU de producto simple: ajusta sin product_variant_id', async () => {
    mockPrisma.products.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Cafe',
        sku: 'CAFE',
        track_inventory: true,
        product_variants: [],
      },
    ]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      { product_id: 1, product_variant_id: null, quantity_on_hand: 4 },
    ]);

    const res = await service.uploadFromFile(xlsx([['CAFE', 10]]), dto);

    expect(mockPrisma.stock_levels.findMany.mock.calls[0][0].where).toEqual({
      product_id: { in: [1] },
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
    mockPrisma.product_variants.findMany.mockResolvedValue([
      {
        id: 22,
        sku: 'CAM-R',
        product_id: 5,
        name: 'Rojo',
        track_inventory_override: null,
        products: { name: 'Camisa', track_inventory: true },
      },
    ]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      { product_id: 5, product_variant_id: 22, quantity_on_hand: 2 },
      { product_id: 5, product_variant_id: null, quantity_on_hand: 99 },
    ]);

    const res = await service.uploadFromFile(xlsx([['CAM-R', 9]]), dto);

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
    mockPrisma.products.findMany.mockResolvedValue([
      {
        id: 5,
        name: 'Camisa',
        sku: 'CAM',
        track_inventory: true,
        product_variants: [{ sku: 'CAM-R' }, { sku: 'CAM-A' }],
      },
    ]);

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
    const res = await service.uploadFromFile(xlsx([['NOPE', 3]]), dto);

    expect(res.failed).toBe(1);
    expect(res.results[0].message).toContain('no encontrado');
  });

  it('cantidad igual al stock de la variante: sin cambios (incluye 0 == 0)', async () => {
    mockPrisma.product_variants.findMany.mockResolvedValue([
      {
        id: 22,
        sku: 'CAM-R',
        product_id: 5,
        name: null,
        track_inventory_override: null,
        products: { name: 'Camisa', track_inventory: true },
      },
    ]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      { product_id: 5, product_variant_id: 22, quantity_on_hand: 6 },
    ]);

    const res = await service.uploadFromFile(xlsx([['CAM-R', 6]]), dto);

    expect(res.results[0].message).toContain('Sin cambios');
    expect(res.results[0].quantity_before).toBe(6);
    expect(
      mockAdjustments.batchCreateAndCompleteSettled,
    ).not.toHaveBeenCalled();
  });

  describe('tope de 10000 filas', () => {
    it('acepta 10000 filas', async () => {
      simpleProducts(10000);
      const res = await service.uploadFromFile(xlsx(manyRows(10000)), dto);
      expect(res.total_processed).toBe(10000);
    }, 60000);

    it('rechaza 10001 filas con INV_BULK_002', async () => {
      await expect(
        service.uploadFromFile(xlsx(manyRows(10001)), dto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'INV_BULK_002' }),
      });
    }, 60000);
  });

  describe('sesion y commit paginado', () => {
    it('analyzeFile: dry-run, guarda en S3 y no ajusta', async () => {
      simpleProducts(3);
      const res = await service.analyzeFile(
        xlsx([...manyRows(2), ['NOPE', 1]]),
        dto,
      );

      expect(res.total).toBe(3);
      expect(res.valid).toBe(2);
      expect(res.failed).toBe(1);
      expect(res.errors).toEqual([
        expect.objectContaining({ row_number: 4, sku: 'NOPE' }),
      ]);
      expect(mockS3.uploadFile).toHaveBeenCalledWith(
        expect.any(Buffer),
        `tmp/bulk-adjustments/3/${res.session_id}.xlsx`,
        'application/octet-stream',
      );
      expect(
        mockAdjustments.batchCreateAndCompleteSettled,
      ).not.toHaveBeenCalled();
    });

    it('pagina offset=100 limit=100 procesa solo filas 100..199', async () => {
      simpleProducts(250);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(250)));

      const res: any = await service.uploadFromSession('sid', dto, {
        offset: 100,
        limit: 100,
      });

      const items =
        mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1];
      expect(items).toHaveLength(100);
      expect(items[0].product_id).toBe(101); // SKU-100
      expect(items[99].product_id).toBe(200); // SKU-199
      expect(res).toMatchObject({
        total: 250,
        offset: 100,
        limit: 100,
        done: false,
        total_processed: 100,
      });
      expect(res.results[0].row_number).toBe(102);
      expect(mockS3.deleteFile).not.toHaveBeenCalled();
    });

    it('ultima pagina: done=true borra el archivo', async () => {
      simpleProducts(150);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(150)));

      const res: any = await service.uploadFromSession('sid', dto, {
        offset: 100,
        limit: 100,
      });

      expect(res.done).toBe(true);
      expect(mockS3.deleteFile).toHaveBeenCalledWith(
        'tmp/bulk-adjustments/3/sid.xlsx',
      );
    });

    it('si la pagina falla, el archivo NO se borra', async () => {
      simpleProducts(50);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(50)));
      mockAdjustments.batchCreateAndCompleteSettled.mockRejectedValue(
        new Error('boom'),
      );

      await expect(
        service.uploadFromSession('sid', dto, { offset: 0, limit: 100 }),
      ).rejects.toThrow('boom');
      expect(mockS3.deleteFile).not.toHaveBeenCalled();
    });

    it('sesion expirada: error claro', async () => {
      mockS3.downloadImage.mockRejectedValue(new Error('NoSuchKey'));
      await expect(
        service.uploadFromSession('sid', dto, { offset: 0, limit: 100 }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'BULK_PROD_SESSION_EXPIRED',
        }),
      });
    });

    it('sin offset/limit: modo legacy completo y borra el archivo', async () => {
      simpleProducts(5);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(5)));

      const res: any = await service.uploadFromSession('sid', dto);

      expect(res.total_processed).toBe(5);
      expect(res.done).toBeUndefined();
      expect(mockS3.deleteFile).toHaveBeenCalledTimes(1);
    });
  });

  it('plantilla prellenada: SKU de variante y omite base huérfana', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      {
        product_variant_id: 22,
        quantity_on_hand: 5,
        products: {
          sku: 'CAM',
          name: 'Camisa',
          _count: { product_variants: 2 },
        },
        product_variants: { sku: 'CAM-R', name: 'Rojo' },
      },
      {
        product_variant_id: null,
        quantity_on_hand: 3,
        products: {
          sku: 'CAM',
          name: 'Camisa',
          _count: { product_variants: 2 },
        },
        product_variants: null,
      },
      {
        product_variant_id: null,
        quantity_on_hand: 8,
        products: {
          sku: 'CAFE',
          name: 'Cafe',
          _count: { product_variants: 0 },
        },
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
