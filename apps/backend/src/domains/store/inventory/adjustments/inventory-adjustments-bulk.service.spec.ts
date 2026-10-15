import * as XLSX from 'xlsx';
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('InventoryAdjustmentsBulkService', () => {
  const mockPrisma: any = {
    products: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    product_variants: { findMany: jest.fn(), findFirst: jest.fn() },
    stock_levels: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    audit_logs: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const mockSku = { next: jest.fn() };
  const mockAdjustments = {
    batchCreateAndCompleteSettled: jest.fn(),
    createAdjustmentInTransaction: jest.fn(),
    emitInventoryAdjusted: jest.fn(),
  };
  const mockS3 = {
    uploadFile: jest.fn(),
    downloadImage: jest.fn(),
    deleteFile: jest.fn(),
  };
  let service: InventoryAdjustmentsBulkService;
  let receipts: Map<string, any>;
  let lockTail: Promise<void>;

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
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3 } as any);
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9);
    receipts = new Map();
    lockTail = Promise.resolve();
    mockPrisma.audit_logs.findMany.mockImplementation(async ({ where }: any) =>
      [...receipts.values()].filter((r) =>
        where.request_id.in.includes(r.request_id),
      ),
    );
    mockPrisma.audit_logs.findFirst.mockImplementation(
      async ({ where }: any) => receipts.get(where.request_id) ?? null,
    );
    mockPrisma.audit_logs.create.mockImplementation(async ({ data }: any) => {
      receipts.set(data.request_id, data);
      return data;
    });

    mockPrisma.products.findMany.mockResolvedValue([]);
    mockPrisma.product_variants.findMany.mockResolvedValue([]);
    mockPrisma.stock_levels.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      let release: (() => void) | undefined;
      const tx = {
        ...mockPrisma,
        $executeRawUnsafe: jest.fn(async () => {
          if (release) return;
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
        }),
      };
      try {
        return await fn(tx);
      } finally {
        release?.();
      }
    });
    mockPrisma.products.findFirst.mockResolvedValue(null);
    mockPrisma.product_variants.findFirst.mockResolvedValue(null);
    mockPrisma.products.create.mockResolvedValue({ id: 900 });
    mockSku.next.mockResolvedValue('CI-3-000001');
    mockAdjustments.createAdjustmentInTransaction.mockImplementation(
      async (_tx: any, data: any) => ({
        adjustment: { id: 700, ...data },
        quantity_change: data.quantity_after,
        cost_amount: data.quantity_after * (data.unit_cost ?? 0),
        adjustment_type: data.type,
      }),
    );
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

  describe('contrato de carga inicial para productos existentes', () => {
    beforeEach(() => {
      mockPrisma.products.findMany.mockResolvedValue([
        {
          id: 1,
          sku: 'CAFE',
          name: 'Café',
          track_inventory: true,
          product_variants: [],
          cost_price: null,
        },
      ]);
    });

    it('sin stock_level: análisis y commit usan initial_load y advierten valoración cero', async () => {
      const file = xlsx([['CAFE', 10]]);
      const analysis = await service.analyzeFile(file, dto);
      expect(analysis.valid).toBe(1);
      expect(analysis.initial_load_rows).toBe(1);
      expect(analysis.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row_number: 2,
            message: expect.stringContaining('valorado en 0'),
          }),
        ]),
      );
      mockS3.downloadImage.mockResolvedValue(file);
      const result = await service.uploadFromSession(analysis.session_id, dto, {
        offset: 0,
        limit: 100,
      });
      expect(result.failed).toBe(0);
      expect(
        mockAdjustments.createAdjustmentInTransaction.mock.calls[0][1],
      ).toMatchObject({ type: 'initial_load', quantity_after: 10 });
      expect(result.results[0]).toMatchObject({
        quantity_before: 0,
        quantity_change: 10,
      });
    });

    it.each([
      [8, 12],
      [8, 2],
      [0, 0],
    ])(
      'initial_load global con saldo %i y destino %i degrada/omite con warning',
      async (before, after) => {
        mockPrisma.stock_levels.findMany.mockResolvedValue([
          { product_id: 1, product_variant_id: null, quantity_on_hand: before },
        ]);
        const file = xlsx([['CAFE', after]]);
        const options = { ...dto, adjustment_type: 'initial_load' };
        const analysis = await service.analyzeFile(file, options);
        expect(analysis.initial_load_rows).toBe(0);
        expect(analysis.warnings[0].message).toContain('diferencia de conteo');
        await service.uploadFromFile(file, options);
        if (before !== after) {
          expect(
            mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1][0]
              .type,
          ).toBe('count_variance');
        } else {
          expect(
            mockAdjustments.batchCreateAndCompleteSettled,
          ).not.toHaveBeenCalled();
        }
      },
    );

    it('initial_load en columna se degrada igual que el global', async () => {
      mockPrisma.stock_levels.findMany.mockResolvedValue([
        { product_id: 1, product_variant_id: null, quantity_on_hand: 8 },
      ]);
      const ws = XLSX.utils.aoa_to_sheet([
        ['SKU', 'Cantidad Nueva', 'Tipo Ajuste'],
        ['CAFE', 2, 'initial_load'],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'S');
      const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const result = await service.uploadFromFile(file, dto);
      expect(result.results[0].warnings?.[0]).toContain('diferencia de conteo');
      expect(
        mockAdjustments.batchCreateAndCompleteSettled.mock.calls[0][1][0].type,
      ).toBe('count_variance');
    });

    it('initial_load existente respeta Precio Compra y no advierte cero con costo de ficha', async () => {
      mockPrisma.products.findMany.mockResolvedValue([
        {
          id: 1,
          sku: 'CAFE',
          name: 'Café',
          track_inventory: true,
          product_variants: [],
          cost_price: 500,
        },
      ]);
      const analysis = await service.analyzeFile(xlsx([['CAFE', 10]]), dto);
      expect(
        analysis.warnings.some((warning) =>
          warning.message.includes('valorado en 0'),
        ),
      ).toBe(false);
    });

    it('reintento de fila existente no crea ajuste ni revierte movimientos posteriores', async () => {
      const file = xlsx([['CAFE', 10]]);
      mockS3.downloadImage.mockResolvedValue(file);
      const first = await service.uploadFromSession('sid', dto, {
        offset: 0,
        limit: 100,
      });
      mockPrisma.stock_levels.findMany.mockResolvedValue([
        { product_id: 1, product_variant_id: null, quantity_on_hand: 3 },
      ]);
      const retried = await service.uploadFromSession('sid', dto, {
        offset: 0,
        limit: 100,
      });
      expect(retried).toEqual(first);
      expect(
        mockAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenCalledTimes(1);
      expect(mockAdjustments.emitInventoryAdjusted).toHaveBeenCalledTimes(1);
      expect(
        mockPrisma.audit_logs.findFirst.mock.calls[0][0].where,
      ).toMatchObject({ store_id: 3, organization_id: 1 });
    });
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
        mockAdjustments.createAdjustmentInTransaction.mock.calls.map(
          (call) => call[1],
        );
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

    it('ultima pagina: done=true conserva archivo para reintentar respuesta perdida', async () => {
      simpleProducts(150);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(150)));

      const res: any = await service.uploadFromSession('sid', dto, {
        offset: 100,
        limit: 100,
      });

      expect(res.done).toBe(true);
      expect(mockS3.deleteFile).not.toHaveBeenCalled();
    });

    it('si la pagina falla, el archivo NO se borra', async () => {
      simpleProducts(50);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(50)));
      mockAdjustments.createAdjustmentInTransaction.mockRejectedValue(
        new Error('boom'),
      );
      const result = await service.uploadFromSession('sid', dto, {
        offset: 0,
        limit: 100,
      });
      expect(result.failed).toBe(50);
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

    it('sin offset/limit: archivo completo conserva recibos y archivo para retry', async () => {
      simpleProducts(5);
      mockS3.downloadImage.mockResolvedValue(xlsx(manyRows(5)));

      const res: any = await service.uploadFromSession('sid', dto);

      expect(res.total_processed).toBe(5);
      expect(res.done).toBeUndefined();
      expect(mockS3.deleteFile).not.toHaveBeenCalled();
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
        [
          'SKU',
          'Nombre Producto',
          'Cantidad Nueva',
          'Precio Venta',
          'Precio Compra',
        ],
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

      expect(res.failed).toBe(1);
      expect(res.new_products).toBe(1);
      expect(res.auto_sku).toBe(1);
      expect(res.requires_initial_load_ack).toBe(true);
      expect(res.new_product_rows).toEqual([
        { row_number: 2, sku: null, name: 'Galleta', quantity: 10 },
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
      expect(res.new_products).toBe(0);
      expect(res.errors).toHaveLength(2);
      expect(res.errors[1]).toMatchObject({ row_number: 3, sku: 'DUP' });
      expect(res.errors[1].message).toContain('duplicado');
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

      expect(mockSku.next).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ products: mockPrisma.products }),
      );
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
      expect(
        mockAdjustments.createAdjustmentInTransaction.mock.calls[0][1],
      ).toMatchObject({
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
      mockPrisma.products.findMany.mockResolvedValue([
        {
          id: 44,
          sku: 'YA-EXISTE',
          name: 'Algo',
          track_inventory: true,
          product_variants: [],
        },
      ]);
      mockPrisma.stock_levels.findMany.mockResolvedValue([
        { product_id: 44, product_variant_id: null, quantity_on_hand: 1 },
      ]);
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['YA-EXISTE', 'Algo', 3, '', '']]),
      );

      const res: any = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );

      expect(mockPrisma.products.create).not.toHaveBeenCalled();
      expect(
        mockAdjustments.createAdjustmentInTransaction.mock.calls[0][1],
      ).toMatchObject({ product_id: 44, type: 'count_variance' });
      expect(res.results[0].action).toBe('adjusted');
    });

    it('SKU desconocido aunque tenga nombre nunca da de alta producto', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['ERRATA', 'Galleta', 2, '', '']]),
      );
      const result = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      expect(result.failed).toBe(1);
      expect(result.results[0].message).toContain('verifica el SKU');
      expect(mockPrisma.products.create).not.toHaveBeenCalled();
    });

    it('análisis advierte nombre existente y costo ausente por cada fila nueva', async () => {
      mockPrisma.products.findMany.mockResolvedValue([{ name: 'Galleta' }]);
      const result = await service.analyzeFile(
        xlsxNew([['', 'galleta', 3, '', '']]),
        dto,
      );
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row_number: 2,
            message: expect.stringContaining('este nombre'),
          }),
          expect.objectContaining({
            row_number: 2,
            message: expect.stringContaining('valorado en 0'),
          }),
        ]),
      );
    });

    it('reintento última página devuelve mismo SKU y no crea producto ni ajuste adicional', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta', 3, '', '900']]),
      );
      const first = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      const retried = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      expect(retried).toEqual(first);
      expect(mockPrisma.products.create).toHaveBeenCalledTimes(1);
      expect(
        mockAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenCalledTimes(1);
      expect(mockAdjustments.emitInventoryAdjusted).toHaveBeenCalledTimes(1);
      expect(mockS3.deleteFile).not.toHaveBeenCalled();
    });

    it('dos reintentos concurrentes se serializan por sesión/fila y crean una sola vez', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta', 3, '', '900']]),
      );
      const [first, concurrent] = await Promise.all([
        service.uploadFromSession(
          'sid',
          { ...dto, initial_load_ack: true },
          { offset: 0, limit: 100 },
        ),
        service.uploadFromSession(
          'sid',
          { ...dto, initial_load_ack: true },
          { offset: 0, limit: 100 },
        ),
      ]);
      expect(first).toEqual(concurrent);
      expect(mockPrisma.products.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.audit_logs.create).toHaveBeenCalledTimes(1);
      expect(
        mockAdjustments.createAdjustmentInTransaction,
      ).toHaveBeenCalledTimes(1);
    });

    it('producto de cantidad cero también tiene recibo durable y no se duplica', async () => {
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta', 0, '', '']]),
      );
      await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      expect(mockPrisma.products.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.audit_logs.create).toHaveBeenCalledTimes(1);
      expect(
        mockAdjustments.createAdjustmentInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('fallo del ajuste revierte producto y recibo: reintento crea una sola alta confirmada', async () => {
      let products: any[] = [];
      mockPrisma.products.create.mockImplementation(async ({ data }: any) => {
        products.push(data);
        return { id: 900 };
      });
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        const before = [...products];
        const priorReceipts = new Map(receipts);
        try {
          return await fn(mockPrisma);
        } catch (error) {
          products = before;
          receipts = priorReceipts;
          throw error;
        }
      });
      mockAdjustments.createAdjustmentInTransaction.mockRejectedValueOnce(
        new Error('fallo costeo'),
      );
      mockS3.downloadImage.mockResolvedValue(
        xlsxNew([['', 'Galleta', 3, '', '900']]),
      );
      const failed = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      expect(failed.failed).toBe(1);
      expect(products).toHaveLength(0);
      expect(receipts.size).toBe(0);
      expect(mockAdjustments.emitInventoryAdjusted).not.toHaveBeenCalled();
      const retried = await service.uploadFromSession(
        'sid',
        { ...dto, initial_load_ack: true },
        { offset: 0, limit: 100 },
      );
      expect(retried.successful).toBe(1);
      expect(products).toHaveLength(1);
      expect(receipts.size).toBe(1);
      expect(
        mockAdjustments.createAdjustmentInTransaction.mock.calls[0][0],
      ).toBe(mockPrisma);
    });
  });
});
