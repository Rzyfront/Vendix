import { Prisma } from '@prisma/client';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

/**
 * CP-PURCHASE-TRANSPARENCY K — el contrato de transporte de los 24 handlers.
 *
 * Esta suite NO prueba lógica de negocio (eso vive en
 * `purchase-orders.service.spec.ts`). Prueba UNA sola cosa, la que hacía que
 * un fallo de compras fuera indistinguible de un éxito para el cliente: que
 * la excepción SALGA del handler.
 *
 * Por qué importa que salga y no que se traduzca: `AllExceptionsFilter` es un
 * filtro global, y un filtro solo corre cuando la excepción abandona el
 * handler. `responseService.error(...)` RETORNA el sobre en vez de lanzarlo,
 * así que la respuesta viajaba con el status del decorador —200 en los
 * `@Get`/`@Patch`/`@Delete`, 201 en los `@Post`— con `success:false` y el
 * status real enterrado en el cuerpo. El `HttpClient` de Angular resuelve eso
 * por la rama de éxito.
 *
 * Cada handler se prueba con tres casos:
 *
 *   1. `VendixHttpException` desde abajo → se propaga tal cual (misma
 *      instancia, para que el filtro conserve `error_code` y status).
 *   2. `PrismaClientKnownRequestError` P2028 → se propaga. Éste es el caso que
 *      QUI-486 dejó sin cubrir: aquel arreglo re-lanzaba `HttpException` y un
 *      P2028 no lo es, así que la transacción caída seguía saliendo con 200.
 *   3. La ruta de éxito devuelve EXACTAMENTE el mismo sobre que antes —mensaje
 *      literal incluido—, porque el arreglo no debía tocarla.
 *
 * Y en los tres, `responseService.error` no puede haberse invocado NUNCA. Esa
 * aserción es el corazón de la suite: es la llamada cuya mera existencia en
 * esta ruta reintroduce el defecto.
 */
describe('PurchaseOrdersController — un fallo no puede responder 2xx', () => {
  let controller: PurchaseOrdersController;
  let purchaseOrdersService: jest.Mocked<Partial<PurchaseOrdersService>>;
  let invoiceScannerService: jest.Mocked<Partial<InvoiceScannerService>>;
  let responseService: ResponseService;
  let errorSpy: jest.SpyInstance;
  let queue: { add: jest.Mock; getJob: jest.Mock };

  /** Rechazo de negocio tipado: el filtro global le saca status + error_code. */
  const businessRejection = () =>
    new VendixHttpException(ErrorCodes.MEDIA_FILE_REQUIRED_001);

  /**
   * Transacción caída. Es la forma EXACTA del fallo que se colaba: no es una
   * `HttpException`, así que el `if (error instanceof HttpException) throw`
   * de QUI-486 no lo atajaba y acababa dentro del sobre con status 2xx.
   */
  const transactionCollapse = () =>
    new Prisma.PrismaClientKnownRequestError(
      'Transaction already closed: A query cannot be executed on an expired transaction.',
      { code: 'P2028', clientVersion: '7.0.0' },
    );

  const file = {
    originalname: 'factura.png',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from('x'),
  } as Express.Multer.File;

  beforeEach(() => {
    purchaseOrdersService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findByStatus: jest.fn(),
      findPending: jest.fn(),
      findBySupplier: jest.fn(),
      getCostPreview: jest.fn(),
      getReceptions: jest.fn(),
      getCostSummary: jest.fn(),
      getTimeline: jest.fn(),
      addAttachment: jest.fn(),
      getAttachments: jest.fn(),
      removeAttachment: jest.fn(),
      registerPayment: jest.fn(),
      getPayments: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      approve: jest.fn(),
      cancel: jest.fn(),
      receive: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<Partial<PurchaseOrdersService>>;

    invoiceScannerService = {
      scanInvoice: jest.fn(),
      matchProducts: jest.fn(),
      confirmAndCreatePO: jest.fn(),
    } as unknown as jest.Mocked<Partial<InvoiceScannerService>>;

    // El ResponseService REAL, no un doble: así la aserción de la ruta de
    // éxito compara contra el sobre que el cliente recibe de verdad.
    responseService = new ResponseService();
    errorSpy = jest.spyOn(responseService, 'error');

    queue = { add: jest.fn(), getJob: jest.fn() };

    controller = new PurchaseOrdersController(
      purchaseOrdersService as unknown as PurchaseOrdersService,
      invoiceScannerService as unknown as InvoiceScannerService,
      responseService,
      queue as any,
    );

    // El `catch` que sobrevive registra con `logger.error`. Silenciarlo evita
    // ensuciar la salida de jest con 14 stacks esperados.
    jest
      .spyOn((controller as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  /**
   * Un handler = una fila. `invoke` lo llama con argumentos realistas; `stub`
   * es el mock del método de servicio en el que se inyecta el fallo.
   */
  type Row = {
    /** Método + ruta, tal como la ve el cliente. */
    route: string;
    stub: () => jest.Mock;
    invoke: () => Promise<unknown>;
    /** Valor que devuelve el servicio en la ruta feliz. */
    payload: unknown;
    /** Sobre EXACTO que el handler debe seguir devolviendo. */
    expected: (payload: any) => unknown;
  };

  const ok = (message: string) => (data: any) => ({
    success: true,
    message,
    data,
  });

  const rows: Row[] = [
    {
      route: 'POST /store/orders/purchase-orders',
      stub: () => purchaseOrdersService.create as jest.Mock,
      invoke: () =>
        controller.create({ supplier_id: 3, items: [{}, {}] } as any),
      payload: { id: 7, order_number: 'OC-0007' },
      expected: ok('Orden de compra creada exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders',
      stub: () => purchaseOrdersService.findAll as jest.Mock,
      invoke: () => controller.findAll({} as any),
      // Sin `meta` el handler cae en la rama `success`, no en `paginated`.
      payload: { data: [{ id: 1 }] },
      expected: ok('Órdenes de compra obtenidas exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/draft',
      stub: () => purchaseOrdersService.findByStatus as jest.Mock,
      invoke: () => controller.findDrafts({} as any),
      payload: [{ id: 1 }],
      expected: ok('Borradores de órdenes de compra obtenidos exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/approved',
      stub: () => purchaseOrdersService.findByStatus as jest.Mock,
      invoke: () => controller.findApproved({} as any),
      payload: [{ id: 2 }],
      expected: ok('Órdenes de compra aprobadas obtenidas exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/pending',
      stub: () => purchaseOrdersService.findPending as jest.Mock,
      invoke: () => controller.findPending({} as any),
      payload: [{ id: 3 }],
      expected: ok('Órdenes de compra pendientes obtenidas exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/supplier/:supplierId',
      stub: () => purchaseOrdersService.findBySupplier as jest.Mock,
      invoke: () => controller.findBySupplier('9', {} as any),
      payload: [{ id: 4 }],
      expected: ok('Órdenes de compra del proveedor obtenidas exitosamente'),
    },
    {
      route: 'POST /store/orders/purchase-orders/scan',
      stub: () => invoiceScannerService.scanInvoice as jest.Mock,
      invoke: () => controller.scanInvoice(file, 'retail'),
      payload: { supplier: 'ACME', line_items: [] },
      expected: ok('Factura escaneada exitosamente'),
    },
    {
      route: 'POST /store/orders/purchase-orders/scan/match',
      stub: () => invoiceScannerService.matchProducts as jest.Mock,
      invoke: () => controller.matchProducts({ line_items: [] }),
      payload: { items: [] },
      expected: ok('Coincidencias de productos encontradas'),
    },
    {
      route: 'POST /store/orders/purchase-orders/scan/confirm',
      stub: () => invoiceScannerService.confirmAndCreatePO as jest.Mock,
      invoke: () =>
        controller.confirmScannedInvoice(file, {
          supplier_id: 3,
          items: [{}],
        } as any),
      payload: { id: 8 },
      expected: ok('Orden de compra creada desde factura escaneada'),
    },
    {
      route: 'POST /store/orders/purchase-orders/cost-preview',
      stub: () => purchaseOrdersService.getCostPreview as jest.Mock,
      invoke: () => controller.getCostPreview({ items: [] } as any),
      payload: { lines: [] },
      expected: ok('Preview de costos obtenido'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id/receptions',
      stub: () => purchaseOrdersService.getReceptions as jest.Mock,
      invoke: () => controller.getReceptions('5'),
      payload: [{ id: 1 }],
      expected: ok('Recepciones obtenidas exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id/cost-summary',
      stub: () => purchaseOrdersService.getCostSummary as jest.Mock,
      invoke: () => controller.getCostSummary('5'),
      payload: { total: 0 },
      expected: ok('Resumen de costos obtenido exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id/timeline',
      stub: () => purchaseOrdersService.getTimeline as jest.Mock,
      invoke: () => controller.getTimeline('5'),
      payload: [{ event: 'created' }],
      expected: ok('Timeline obtenido exitosamente'),
    },
    {
      route: 'POST /store/orders/purchase-orders/:id/attachments',
      stub: () => purchaseOrdersService.addAttachment as jest.Mock,
      invoke: () => controller.addAttachment('5', file, {} as any),
      payload: { id: 11 },
      expected: ok('Archivo adjunto agregado exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id/attachments',
      stub: () => purchaseOrdersService.getAttachments as jest.Mock,
      invoke: () => controller.getAttachments('5'),
      payload: [{ id: 11 }],
      expected: ok('Archivos adjuntos obtenidos exitosamente'),
    },
    {
      route:
        'DELETE /store/orders/purchase-orders/:id/attachments/:attachmentId',
      stub: () => purchaseOrdersService.removeAttachment as jest.Mock,
      invoke: () => controller.removeAttachment('5', '11'),
      payload: { deleted: true },
      expected: ok('Archivo adjunto eliminado exitosamente'),
    },
    {
      route: 'POST /store/orders/purchase-orders/:id/payments',
      stub: () => purchaseOrdersService.registerPayment as jest.Mock,
      invoke: () =>
        controller.registerPayment('5', {
          amount: 1000,
          payment_method: 'cash',
        } as any),
      payload: { id: 21 },
      expected: ok('Pago registrado exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id/payments',
      stub: () => purchaseOrdersService.getPayments as jest.Mock,
      invoke: () => controller.getPayments('5'),
      payload: [{ id: 21 }],
      expected: ok('Pagos obtenidos exitosamente'),
    },
    {
      route: 'GET /store/orders/purchase-orders/:id',
      stub: () => purchaseOrdersService.findOne as jest.Mock,
      invoke: () => controller.findOne('5'),
      payload: { id: 5 },
      expected: ok('Orden de compra obtenida exitosamente'),
    },
    {
      route: 'PATCH /store/orders/purchase-orders/:id',
      stub: () => purchaseOrdersService.update as jest.Mock,
      invoke: () => controller.update('5', { notes: 'x' } as any),
      payload: { id: 5 },
      expected: ok('Orden de compra actualizada exitosamente'),
    },
    {
      route: 'PATCH /store/orders/purchase-orders/:id/approve',
      stub: () => purchaseOrdersService.approve as jest.Mock,
      invoke: () => controller.approve('5'),
      payload: { id: 5, status: 'approved' },
      expected: ok('Orden de compra aprobada exitosamente'),
    },
    {
      route: 'PATCH /store/orders/purchase-orders/:id/cancel',
      stub: () => purchaseOrdersService.cancel as jest.Mock,
      invoke: () => controller.cancel('5'),
      payload: { id: 5, status: 'cancelled' },
      expected: ok('Orden de compra cancelada exitosamente'),
    },
    {
      route: 'PATCH /store/orders/purchase-orders/:id/receive',
      stub: () => purchaseOrdersService.receive as jest.Mock,
      invoke: () =>
        controller.receive('5', {
          items: [{ id: 1, quantity_received: 2 }],
        } as any),
      payload: { id: 5, status: 'received' },
      expected: ok('Orden de compra recibida exitosamente'),
    },
    {
      route: 'DELETE /store/orders/purchase-orders/:id',
      stub: () => purchaseOrdersService.remove as jest.Mock,
      // `deleted()` delega en `noContent()`: `data` es null y el mensaje viaja
      // igual. Se fija tal cual para que nadie lo cambie sin darse cuenta.
      invoke: () => controller.remove('5'),
      payload: undefined,
      expected: () => ({
        success: true,
        message: 'Orden de compra eliminada exitosamente',
        data: null,
      }),
    },
  ];

  it('cubre los 24 handlers que devolvían el sobre de error', () => {
    // Guarda contra el olvido: si alguien añade un handler con un `catch` que
    // retorna el sobre, esta tabla tiene que crecer con él.
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((r) => r.route)).size).toBe(24);
  });

  describe.each(rows)('$route', (row) => {
    it('propaga un rechazo de negocio en vez de envolverlo en un 2xx', async () => {
      const rejection = businessRejection();
      row.stub().mockRejectedValue(rejection);

      // `toBe`, no `toBeInstanceOf`: el filtro global lee `errorCode` y
      // `getResponse()` de ESTA instancia. Re-empaquetarla perdería el código.
      await expect(row.invoke()).rejects.toBe(rejection);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('propaga un P2028 (transacción caída) en vez de envolverlo en un 2xx', async () => {
      const collapse = transactionCollapse();
      row.stub().mockRejectedValue(collapse);

      await expect(row.invoke()).rejects.toBe(collapse);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('deja la ruta de éxito exactamente como estaba', async () => {
      row.stub().mockResolvedValue(row.payload);

      await expect(row.invoke()).resolves.toEqual(row.expected(row.payload));
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  /**
   * `GET /` tiene dos ramas de éxito y la de paginación es la que se sirve en
   * la práctica; la tabla de arriba solo ejercita la otra.
   */
  it('GET /store/orders/purchase-orders conserva la rama paginada', async () => {
    (purchaseOrdersService.findAll as jest.Mock).mockResolvedValue({
      data: [{ id: 1 }],
      meta: { total: 1, page: 1, limit: 20 },
    });

    const result: any = await controller.findAll({} as any);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Órdenes de compra obtenidas exitosamente');
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.meta).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * Esta guarda no estaba ni siquiera dentro de un `catch`: devolvía el sobre
   * directamente desde la ruta feliz, así que subir el formulario sin fichero
   * respondía HTTP 201 Created con `success:false`. Es el peor de los 25
   * casos, porque el status del decorador anunciaba un recurso CREADO.
   */
  describe('POST /:id/attachments — la guarda de fichero ausente', () => {
    it('lanza MEDIA_FILE_REQUIRED_001 en vez de devolver el sobre', async () => {
      await expect(
        controller.addAttachment('5', undefined as any, {} as any),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.MEDIA_FILE_REQUIRED_001.code,
      });

      expect(errorSpy).not.toHaveBeenCalled();
      expect(purchaseOrdersService.addAttachment).not.toHaveBeenCalled();
    });

    it('responde 400, no 201', async () => {
      const thrown = await controller
        .addAttachment('5', undefined as any, {} as any)
        .catch((e) => e);

      expect(thrown).toBeInstanceOf(VendixHttpException);
      expect(thrown.getStatus()).toBe(400);
    });
  });

  /**
   * `scanInvoice` filtraba por `VendixHttpException`, no por `HttpException`.
   * Una `BadRequestException` de Nest —la que levanta `FileInterceptor` con un
   * multipart mal formado— también acababa dentro del sobre. Se prueba con un
   * `Error` pelado porque es el peor caso posible: si algo así se colara, hoy
   * saldría 200 y después sale 500 con `SYS_INTERNAL_001`, que es correcto.
   */
  it('POST /scan propaga incluso un error que no es HttpException', async () => {
    const raw = new Error('sharp: unsupported image format');
    (invoiceScannerService.scanInvoice as jest.Mock).mockRejectedValue(raw);

    await expect(controller.scanInvoice(file, 'retail')).rejects.toBe(raw);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * Los guards de entrada de `scanInvoice` viven DENTRO del `try`. Al quitar
   * el envoltorio hay que comprobar que siguen saliendo como excepción y no
   * los absorbe el `catch` que quedó.
   */
  describe('POST /scan — guards de entrada', () => {
    it('sin fichero lanza INV_SCAN_NO_FILE', async () => {
      await expect(
        controller.scanInvoice(undefined as any),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_SCAN_NO_FILE.code,
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(invoiceScannerService.scanInvoice).not.toHaveBeenCalled();
    });

    it('con un mimetype no soportado lanza INV_SCAN_INVALID_FILE', async () => {
      await expect(
        controller.scanInvoice({
          ...file,
          mimetype: 'application/zip',
        } as Express.Multer.File),
      ).rejects.toMatchObject({
        errorCode: ErrorCodes.INV_SCAN_INVALID_FILE.code,
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(invoiceScannerService.scanInvoice).not.toHaveBeenCalled();
    });
  });

  /**
   * La razón por la que el `catch` sobrevive en 7 handlers es el log: los ids
   * del lote, el proveedor o el monto del pago no viajan en la excepción, y
   * sin ellos no se reconstruye qué se intentó hacer. Si alguien quita el log
   * "porque el catch no hace nada", este caso cae.
   */
  it('el catch que sobrevive registra el contexto que la excepción no lleva', async () => {
    const logger = jest.spyOn((controller as any).logger, 'error');
    const collapse = transactionCollapse();
    (purchaseOrdersService.receive as jest.Mock).mockRejectedValue(collapse);

    await expect(
      controller.receive('42', {
        items: [{ id: 1, quantity_received: 2 }],
        supplier_invoice_number: 'FV-900',
      } as any),
    ).rejects.toBe(collapse);

    expect(logger).toHaveBeenCalledTimes(1);
    const [line] = logger.mock.calls[0];
    expect(line).toContain('po=42');
    expect(line).toContain('lines=1');
    expect(line).toContain('FV-900');
  });
});
