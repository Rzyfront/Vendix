import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { DispatchNotesService } from './dispatch-notes.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CreatePurchaseReceiptDispatchDto } from './dto/create-purchase-receipt-dispatch.dto';

/**
 * Bug de dinero — flete perdido en la remisión.
 *
 * Cuando se crea una `dispatch_note` a partir de una orden de cliente el flete
 * (`orders.shipping_cost`) debe persistirse en la remisión y sumarse a
 * `grand_total`. La ruta de despacho recauda `dispatch_notes.grand_total` para
 * el COD; sin el flete el repartidor recaudaba `orden - flete`.
 *
 * Estas pruebas fijan el contrato monetario:
 *   - `createFromOrder`: grand_total = subtotal - discount + tax + order.shipping_cost
 *     y persiste `shipping_cost`.
 *   - `update` (borrador con items): PRESERVA el flete ya persistido en la
 *     remisión (no lo recalcula ni lo bota).
 */
describe('DispatchNotesService — flete (shipping_cost) en la remisión', () => {
  let service: DispatchNotesService;
  let prismaMock: any;
  let dispatchNumberGeneratorMock: any;
  let dispatchFulfillmentMock: any;
  let eventEmitterMock: any;

  const STORE_ID = 100;
  const USER_ID = 1;

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);

    prismaMock = {
      orders: { findFirst: jest.fn() },
      // `create` lo usa createPurchaseReceipt, que escribe la remisión FUERA de
      // $transaction (a diferencia de createFromOrder / update).
      dispatch_notes: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      // createPurchaseReceipt (order-first) valida la OC y sus líneas antes de crear.
      purchase_orders: { findFirst: jest.fn() },
      // QUI-557 — createFromOrder resuelve la bodega POR LÍNEA vía
      // `resolveItemDispatchLocation`, que consulta estos dos modelos. Se agregó
      // después de escribir este spec y nunca se mockearon: los dos casos de flete
      // estallaban con "Cannot read properties of undefined (reading 'findFirst')"
      // (invisible mientras el archivo no compilaba). `null` en ambos ⇒ cae a la
      // bodega por defecto de la orden, que es lo que esos casos ya asumían.
      stock_reservations: { findFirst: jest.fn().mockResolvedValue(null) },
      stock_levels: { findFirst: jest.fn().mockResolvedValue(null) },
      // $transaction ejecuta el callback con un `tx` que captura los datos.
      $transaction: jest.fn(),
    };

    dispatchNumberGeneratorMock = {
      generateNextNumber: jest.fn().mockResolvedValue('REM-1'),
    };
    dispatchFulfillmentMock = {
      recomputeOrderFulfillment: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitterMock = { emit: jest.fn() };

    service = new DispatchNotesService(
      prismaMock,
      dispatchNumberGeneratorMock,
      {} as any, // routeNumberGenerator
      eventEmitterMock,
      {} as any, // stockValidator
      {} as any, // aiEngine
      // receiptScanQueue (BullMQ, @InjectQueue('receipt-scan')). Se agregó al
      // constructor en 6a037a09c y este spec no se actualizó: sin este argumento
      // `dispatchFulfillmentMock` caía en la cola y `undefined` en el parámetro
      // REQUERIDO `dispatchFulfillment`, así que el archivo no compilaba
      // (TS2345) y la suite entera fallaba con "Test suite failed to run".
      // Ningún caso de este spec toca la cola.
      {} as any,
      dispatchFulfillmentMock,
      undefined, // purchaseOrdersService (optional)
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createFromOrder', () => {
    it('suma el flete de la orden al grand_total y persiste shipping_cost', async () => {
      const SHIPPING = 500;
      const order = {
        id: 7777,
        customer_id: 42,
        state: 'processing',
        delivery_type: 'home_delivery',
        currency: 'COP',
        shipping_cost: SHIPPING,
        remaining_balance: 2690,
        shipping_address_snapshot: { address_line1: 'Calle 1' },
        users: {
          id: 42,
          first_name: 'Ada',
          last_name: 'Lovelace',
          document_number: '123',
        },
        order_items: [
          {
            id: 10,
            product_id: 1,
            product_variant_id: null,
            quantity: 2,
            unit_price: 1000,
            tax_amount_item: 190,
          },
        ],
      };
      prismaMock.orders.findFirst.mockResolvedValue(order);

      // Stub de helpers internos: aislamos el contrato monetario.
      jest
        .spyOn(service as any, 'buildCustomerAddressSnapshot')
        .mockReturnValue({ address_line1: 'Calle 1' });
      jest.spyOn(service as any, 'snapshotHasAddress').mockReturnValue(true);
      jest
        .spyOn(service as any, 'resolveDefaultDispatchLocation')
        .mockResolvedValue(10);
      jest
        .spyOn(service as any, 'validateDispatchItemsStock')
        .mockResolvedValue(undefined);

      let capturedCreateData: any;
      const txMock = {
        dispatch_notes: {
          create: jest.fn(async ({ data }: any) => {
            capturedCreateData = data;
            return { id: 900, ...data };
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

      const result = await service.createFromOrder(order.id, {
        target_status: 'draft',
        items: [{ order_item_id: 10, dispatched_quantity: 2 }],
      } as any);

      // subtotal = 1000 * 2 = 2000 ; discount = 0 ; tax = 190 ; flete = 500
      // grand_total = 2000 - 0 + 190 + 500 = 2690
      expect(capturedCreateData.subtotal_amount).toBe(2000);
      expect(capturedCreateData.tax_amount).toBe(190);
      expect(capturedCreateData.shipping_cost).toBe(SHIPPING);
      expect(capturedCreateData.grand_total).toBe(2690);

      // grand_total devuelto también incluye el flete.
      expect(result.grand_total).toBe(2690);
      expect(result.shipping_cost).toBe(SHIPPING);
    });

    it('con flete 0 no altera el grand_total (subtotal - discount + tax)', async () => {
      const order = {
        id: 7778,
        customer_id: 42,
        state: 'processing',
        delivery_type: 'home_delivery',
        currency: 'COP',
        shipping_cost: 0,
        remaining_balance: 0,
        shipping_address_snapshot: { address_line1: 'Calle 1' },
        users: { id: 42, first_name: 'Ada', last_name: 'L', document_number: '1' },
        order_items: [
          {
            id: 11,
            product_id: 1,
            product_variant_id: null,
            quantity: 1,
            unit_price: 1000,
            tax_amount_item: 0,
          },
        ],
      };
      prismaMock.orders.findFirst.mockResolvedValue(order);
      jest
        .spyOn(service as any, 'buildCustomerAddressSnapshot')
        .mockReturnValue({ address_line1: 'Calle 1' });
      jest.spyOn(service as any, 'snapshotHasAddress').mockReturnValue(true);
      jest
        .spyOn(service as any, 'resolveDefaultDispatchLocation')
        .mockResolvedValue(10);
      jest
        .spyOn(service as any, 'validateDispatchItemsStock')
        .mockResolvedValue(undefined);

      let capturedCreateData: any;
      const txMock = {
        dispatch_notes: {
          create: jest.fn(async ({ data }: any) => {
            capturedCreateData = data;
            return { id: 901, ...data };
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

      await service.createFromOrder(order.id, {
        target_status: 'draft',
        items: [{ order_item_id: 11, dispatched_quantity: 1 }],
      } as any);

      expect(capturedCreateData.shipping_cost).toBe(0);
      expect(capturedCreateData.grand_total).toBe(1000);
    });
  });

  describe('update', () => {
    it('preserva el flete ya persistido al recomponer un borrador con items', async () => {
      const PERSISTED_SHIPPING = 500;
      const persistedNote = {
        id: 900,
        status: 'draft',
        customer_id: 42,
        sales_order_id: null,
        dispatch_location_id: 10,
        emission_date: new Date('2026-07-20T00:00:00Z'),
        agreed_delivery_date: null,
        notes: null,
        internal_notes: null,
        currency: 'COP',
        shipping_cost: PERSISTED_SHIPPING,
      };
      // findOne() se resuelve con la remisión persistida (trae shipping_cost).
      jest.spyOn(service, 'findOne').mockResolvedValue(persistedNote as any);

      let capturedUpdateData: any;
      const txMock = {
        dispatch_note_items: { deleteMany: jest.fn().mockResolvedValue({}) },
        dispatch_notes: {
          update: jest.fn(async ({ data }: any) => {
            capturedUpdateData = data;
            return { id: 900, ...data };
          }),
        },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

      await service.update(900, {
        items: [
          {
            product_id: 1,
            product_variant_id: null,
            location_id: 10,
            ordered_quantity: 1,
            dispatched_quantity: 1,
            unit_price: 2000,
            discount_amount: 0,
            tax_amount: 380,
          },
        ],
      } as any);

      // subtotal = 2000 ; discount = 0 ; tax = 380 ; flete preservado = 500
      // grand_total = 2000 - 0 + 380 + 500 = 2880
      expect(capturedUpdateData.subtotal_amount).toBe(2000);
      expect(capturedUpdateData.tax_amount).toBe(380);
      expect(capturedUpdateData.shipping_cost).toBe(PERSISTED_SHIPPING);
      expect(capturedUpdateData.grand_total).toBe(2880);
    });
  });

  /**
   * Recepción de OC por remisión — BORDE DE PERSISTENCIA.
   *
   * `purchase_order_items.unit_cost` es `Decimal(12,4)` y guarda el neto sin
   * redondear (`gross / (1 + rate)`): una línea de 1000 con IVA 19% incluido vale
   * 840.3361. Las columnas destino de la remisión son `Decimal(12,2)`, así que el
   * redondeo pasa AQUÍ, en el servicio, no en el DTO de entrada.
   *
   * Las pruebas de flete de arriba usaban precios de 2 decimales (1000, 2000), así
   * que ni el desajuste de precisión ni la deriva de la cabecera podían aparecer.
   */
  describe('createPurchaseReceipt — precisión monetaria y línea de OC fijada', () => {
    const PO_ID = 4242;
    const SUPPLIER_ID = 55;
    /** 1000 con IVA 19% incluido ⇒ neto 840.3361 + IVA 159.6639. */
    const NET_4DEC = 840.3361;
    const TAX_4DEC = 159.6639;

    const poItem = (id: number, product_id: number) => ({
      id,
      product_id,
      product_variant_id: null,
    });

    const buildItem = (over: Record<string, any> = {}) => ({
      product_id: 1,
      product_variant_id: null,
      location_id: 10,
      ordered_quantity: 1,
      dispatched_quantity: 1,
      unit_price: NET_4DEC,
      discount_amount: 0,
      tax_amount: TAX_4DEC,
      purchase_order_item_id: 501,
      ...over,
    });

    const buildDto = (items: any[], over: Record<string, any> = {}) =>
      ({
        direction: 'inbound',
        subtype: 'purchase_receipt',
        reason: 'normal_purchase',
        supplier_id: SUPPLIER_ID,
        purchase_order_id: PO_ID,
        to_location_id: 10,
        currency: 'COP',
        items,
        ...over,
      }) as any;

    /** Captura el argumento REAL con el que se llamó a dispatch_notes.create. */
    const captureCreate = () => {
      let captured: any;
      prismaMock.dispatch_notes.create.mockImplementation(
        async ({ data }: any) => {
          captured = data;
          return { id: 900, ...data };
        },
      );
      return () => captured;
    };

    beforeEach(() => {
      prismaMock.purchase_orders.findFirst.mockResolvedValue({
        id: PO_ID,
        supplier_id: SUPPLIER_ID,
        location_id: 10,
        purchase_order_items: [poItem(501, 1), poItem(502, 1)],
      });
    });

    it('acepta un unit_price de 4 decimales y lo persiste REDONDEADO a 2 (columna Decimal(12,2))', async () => {
      const read = captureCreate();

      await service.createPurchaseReceipt(buildDto([buildItem()]));

      const [line] = read().dispatch_note_items.create;
      expect(line.unit_price).toBe(840.34);
      expect(line.tax_amount).toBe(159.66);
      expect(line.discount_amount).toBe(0);
      // total_price se deriva del unit_price YA redondeado (840.34 - 0 + 159.66),
      // no del crudo de 4 decimales: así el total de la línea coincide con lo que
      // realmente queda almacenado.
      expect(line.total_price).toBe(1000);
    });

    it('persiste purchase_order_item_id en la línea creada (y null cuando la remisión no lo fija)', async () => {
      const read = captureCreate();

      await service.createPurchaseReceipt(
        buildDto([
          buildItem({ purchase_order_item_id: 502 }),
          // Sin id fijado: la validación cae al emparejamiento por producto y la
          // columna queda null (camino legado del listener).
          buildItem({ purchase_order_item_id: undefined }),
        ]),
      );

      const lines = read().dispatch_note_items.create;
      // Es la ÚNICA forma de desambiguar dos líneas de OC del mismo producto en
      // la recepción: sin esta columna el listener colapsa ambas en la primera.
      expect(lines[0].purchase_order_item_id).toBe(502);
      expect(lines[1].purchase_order_item_id).toBeNull();
    });

    it('redondea los agregados de cabecera para que no se despeguen de la suma de las líneas redondeadas', async () => {
      const read = captureCreate();

      await service.createPurchaseReceipt(
        buildDto([
          buildItem({ purchase_order_item_id: 501 }),
          buildItem({ purchase_order_item_id: 502 }),
        ]),
      );

      const data = read();
      const lines: any[] = data.dispatch_note_items.create;

      // 840.34 × 2 = 1680.68 (NO 1680.6722) y 159.66 × 2 = 319.32 (NO 319.3278).
      expect(data.subtotal_amount).toBe(1680.68);
      expect(data.tax_amount).toBe(319.32);
      expect(data.discount_amount).toBe(0);
      expect(data.grand_total).toBe(2000);

      // Invariante duro: la cabecera ES la suma de sus propias líneas redondeadas.
      const sumSubtotal = lines.reduce(
        (s: number, l: any) => s + l.unit_price * l.dispatched_quantity,
        0,
      );
      const sumTotals = lines.reduce((s: number, l: any) => s + l.total_price, 0);
      expect(data.subtotal_amount).toBe(Math.round(sumSubtotal * 100) / 100);
      expect(data.grand_total).toBe(Math.round(sumTotals * 100) / 100);
    });
  });
});

/**
 * Contrato de VALIDACIÓN (borde de ENTRADA) de la remisión de compra.
 *
 * Se valida con el mismo par de opciones que el `ValidationPipe` global de
 * `main.ts` (`transform` + `whitelist` + `forbidNonWhitelisted` +
 * `enableImplicitConversion`), porque el bug vivía justo en esa combinación: el
 * transform corría ANTES de `@IsOptional()`, así que un `null` explícito se
 * volvía `NaN` — que no es null ni undefined — y `@IsNumber` lo rechazaba con un
 * 400 duro. Y el tope de 2 decimales rechazaba exactamente las líneas cuyo neto
 * no cae en 2 decimales (`840.3361`), produciendo un 400 intermitente por índice
 * de item.
 */
describe('CreatePurchaseReceiptDispatchDto — contrato de validación de entrada', () => {
  /** Aplana constraints de errores anidados (items.N.campo). */
  const flatten = (errors: ValidationError[]): string[] =>
    errors.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...flatten(e.children ?? []),
    ]);

  const buildAndValidate = async (payload: any) => {
    const dto = plainToInstance(CreatePurchaseReceiptDispatchDto, payload, {
      enableImplicitConversion: true,
    });
    const messages = flatten(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    );
    return { dto, messages };
  };

  const baseItem = (over: Record<string, unknown> = {}) => ({
    product_id: 1,
    ordered_quantity: 1,
    dispatched_quantity: 1,
    purchase_order_item_id: 501,
    ...over,
  });

  const basePayload = (items: any[]) => ({
    direction: 'inbound',
    subtype: 'purchase_receipt',
    reason: 'normal_purchase',
    supplier_id: 55,
    purchase_order_id: 4242,
    items,
  });

  it('acepta los campos monetarios con 4 decimales (el neto de una OC con IVA incluido)', async () => {
    const { messages } = await buildAndValidate(
      basePayload([
        baseItem({
          unit_price: 840.3361,
          discount_amount: 0,
          tax_amount: 159.6639,
          new_base_price: 1234.5678,
          new_profit_margin: 33.3333,
        }),
      ]),
    );

    expect(messages).toEqual([]);
  });

  it('un null explícito en un campo monetario opcional NO produce error de validación', async () => {
    const { dto, messages } = await buildAndValidate(
      basePayload([
        baseItem({
          unit_price: null,
          discount_amount: null,
          tax_amount: null,
          new_base_price: null,
          new_profit_margin: null,
        }),
      ]),
    );

    expect(messages).toEqual([]);
    // El transform devuelve `undefined` (jamás NaN) para que @IsOptional salte
    // el campo; el servicio decide después qué significa "ausente".
    expect(dto.items[0].unit_price).toBeUndefined();
    expect(dto.items[0].new_base_price).toBeUndefined();
  });

  it('rechaza una remisión de compra sin líneas', async () => {
    const { messages } = await buildAndValidate(basePayload([]));

    // Con items vacío la remisión llegaba a la delegación, resolvía cero líneas
    // y devolvía éxito con la orden de compra intacta.
    expect(messages).toContain('items should not be empty');
  });

  it('GUARDA DE BORDE: el tope subió a 4 decimales, no a "sin tope" — 5 decimales siguen rechazados', async () => {
    const { messages } = await buildAndValidate(
      basePayload([baseItem({ unit_price: 840.33612 })]),
    );

    expect(messages.length).toBeGreaterThan(0);
  });

  it('GUARDA DE BORDE: un valor no numérico sigue rechazado (el transform no debilitó la validación)', async () => {
    const { messages } = await buildAndValidate(
      basePayload([baseItem({ unit_price: 'no-es-un-numero' })]),
    );

    expect(messages.length).toBeGreaterThan(0);
  });
});
