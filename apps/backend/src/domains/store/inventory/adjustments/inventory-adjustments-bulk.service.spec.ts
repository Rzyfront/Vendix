import * as XLSX from 'xlsx';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('InventoryAdjustmentsBulkService', () => {
  const mockPrisma: any = {
    products: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    product_variants: { findMany: jest.fn(), findFirst: jest.fn() },
    stock_levels: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockSku = { next: jest.fn() };
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
      mockSku as any,
    );
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 3,
    } as any);
    mockPrisma.products.findMany.mockResolvedValue([]);
    mockPrisma.product_variants.findMany.mockResolvedValue([]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (fn: any) =>
      fn(mockPrisma),
    );
    mockPrisma.products.findFirst.mockResolvedValue(null);
    mockPrisma.product_variants.findFirst.mockResolvedValue(null);
    mockPrisma.products.create.mockResolvedValue({ id: 900 });
    mockSku.next.mockResolvedValue('CI-3-000001');
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

  it('plantilla existing: incluye producto con stock 0 y SKU de variante', async () => {
    mockPrisma.products.findMany.mockResolvedValue([
      {
        id: 5,
        sku: 'CAM',
        name: 'Camisa',
        product_variants: [{ id: 22, sku: 'CAM-R', name: 'Rojo' }],
      },
      { id: 6, sku: 'CAFE', name: 'Cafe', product_variants: [] },
      { id: 7, sku: 'SIN-STOCK', name: 'Sin stock', product_variants: [] },
    ]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      { product_id: 5, product_variant_id: 22, quantity_on_hand: 5 },
      { product_id: 6, product_variant_id: null, quantity_on_hand: 8 },
    ]);

    const buf = await service.generateExcelTemplate(7, 'existing');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    expect(rows.map((r) => r['SKU'])).toEqual(['CAM-R', 'CAFE', 'SIN-STOCK']);
    expect(rows[0]['Nombre Producto']).toBe('Camisa - Rojo');
    expect(rows.map((r) => r['Cantidad Actual'])).toEqual(['5', '8', '0']);
    expect(Object.keys(rows[0])).toEqual(
      expect.arrayContaining(['Precio Venta', 'Precio Compra']),
    );
    expect(mockPrisma.products.findMany.mock.calls[0][0].where).toMatchObject({
      store_id: 3,
      product_type: 'physical',
      track_inventory: true,
    });
  });

  it('plantilla existing sin location_id: 400', async () => {
    await expect(
      service.generateExcelTemplate(undefined, 'existing'),
    ).rejects.toThrow('location_id');
  });

  describe('productos nuevos (carga inicial)', () => {
    const xlsxNew = (rows: any[][]): Buffer => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['SKU', 'Nombre Producto', 'Cantidad Nueva', 'Precio Venta', 'Precio Compra'],
        ...rows,
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'S');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    };

    it('analisis: SKU vacio + nombre cuenta new_products y auto_sku', async () => {
      const res = await service.analyzeFile(
        xlsxNew([
          ['', 'Galleta', 10, '$ 1.500', '900'],
          ['NUEVO-1', 'Chocolate', 4, '', ''],
        ]),
        dto,
      );

      expect(res.failed).toBe(0);
      expect(res.new_products).toBe(2);
      expect(res.auto_sku).toBe(1);
      expect(res.requires_initial_load_ack).toBe(true);
      expect(res.new_product_rows).toEqual([
        { row_number: 2, sku: null, name: 'Galleta', quantity: 10 },
        { row_number: 3, sku: 'NUEVO-1', name: 'Chocolate', quantity: 4 },
      ]);
    });

    it('fila sin SKU ni nombre es error; SKU desconocido sin nombre tambien', async () => {
      const res = await service.analyzeFile(
        xlsxNew([
          ['', '', 5, '', ''],
          ['NOPE', '', 5, '', ''],
        ]),
        dto,
      );
      // La fila 1 sin SKU ni nombre no tiene datos salvo la cantidad: es fila.
      expect(res.new_products).toBe(0);
      expect(res.failed).toBe(2);
      expect(res.errors[1].message).toContain('agrega el Nombre Producto');
    });

    it('SKU duplicado dentro del archivo: error en la segunda aparicion', async () => {
      const res = await service.analyzeFile(
        xlsxNew([
          ['DUP', 'Uno', 1, '', ''],
          ['DUP', 'Dos', 2, '', ''],
        ]),
        dto,
      );
      expect(res.new_products).toBe(1);
      expect(res.errors).toEqual([
        expect.objectContaining({ row_number: 3, sku: 'DUP' }),
      ]);
      expect(res.errors[0].message).toContain('duplicado');
    });

    it('commit sin ack lanza INV_ADJ_BULK_INITIAL_LOAD_ACK_001 y no escribe', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta', 10, '', '']]),
      );
      await expect(
        service.uploadFromSession('sid', dto, { offset: 0, limit: 100 }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'INV_ADJ_BULK_INITIAL_LOAD_ACK_001',
        }),
      });
      expect(mockPrisma.products.create).not.toHaveBeenCalled();
      expect(
        mockAdjustments.batchCreateAndCompleteSettled,
      ).not.toHaveBeenCalled();
    });

    it('commit con ack: crea producto con SKU automatico y ajusta initial_load', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta Maria', 10, '$ 1.500', '900']]),
      );

      const res: any = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );

      expect(mockSku.next).toHaveBeenCalledWith(3, mockPrisma);
      expect(mockPrisma.products.create.mock.calls[0][0].data).toMatchObject({
        store_id: 3,
        name: 'Galleta Maria',
        sku: 'CI-3-000001',
        base_price: 1500,
        cost_price: 900,
        product_type: 'physical',
        state: 'active',
        track_inventory: true,
      });
      const items =
        mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1];
      expect(items[0]).toMatchObject({
        product_id: 900,
        type: 'initial_load',
        quantity_after: 10,
        unit_cost: 900,
      });
      expect(res.successful).toBe(1);
      expect(res.results[0]).toMatchObject({
        action: 'created',
        sku: 'CI-3-000001',
      });
    });

    it('commit con ack: SKU que ya existe se ajusta, no se duplica', async () => {
      mockPrisma.products.findFirst.mockResolvedValue({
        id: 44,
        track_inventory: true,
        product_variants: [],
      });
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['YA-EXISTE', 'Algo', 3, '', '']]),
      );

      const res: any = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );

      expect(mockPrisma.products.create).not.toHaveBeenCalled();
      const items =
        mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1];
      expect(items[0]).toMatchObject({ product_id: 44, type: 'count_variance' });
      expect(res.results[0].action).toBe('adjusted');
    });
  });
});
