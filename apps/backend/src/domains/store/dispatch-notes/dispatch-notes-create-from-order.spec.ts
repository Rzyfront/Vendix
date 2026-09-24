import { DispatchNotesService } from './dispatch-notes.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Hallazgo 1a (CP-post-QUI-832) — `createFromOrder` persistía el impuesto POR
 * UNIDAD (`order_item.tax_amount_item`, ADR-10) como si fuera el impuesto de
 * la línea, y el `total_price` solo sumaba esa unidad. Con qty 5, base 50.000
 * e IVA 19 % persistía 9.500 / 259.500 en vez de 47.500 / 297.500.
 *
 * Estas pruebas fijan el contrato nuevo: el impuesto de la línea COMPLETA se
 * lee con `resolveOrderLineTaxTotal` y se prorratea por lo despachado frente
 * a lo ordenado (`roundMoney2(lineTax × dispatched / orderQty)`). El
 * descuento sigue en 0 y el encabezado (`Σ tax_amount`) hereda la coherencia
 * automáticamente.
 */
describe('DispatchNotesService — createFromOrder prorratea el impuesto de línea (hallazgo 1a)', () => {
  let service: DispatchNotesService;
  let prismaMock: any;
  let txCreate: jest.Mock;
  let dispatchFulfillmentMock: any;

  const STORE_ID = 100;
  const USER_ID = 1;
  const ORDER_ID = 590;
  const ORDER_ITEM_ID = 11;
  const PRODUCT_ID = 352;
  const LOCATION_ID = 50;

  const orderItem = (overrides: Record<string, unknown> = {}) => ({
    id: ORDER_ITEM_ID,
    product_id: PRODUCT_ID,
    product_variant_id: null,
    quantity: 5,
    unit_price: 50000,
    // Impuesto POR UNIDAD de precio (ADR-10): 50.000 × 19 % = 9.500.
    tax_amount_item: 9500,
    ...overrides,
  });

  const orderWith = (items: unknown[]) => ({
    id: ORDER_ID,
    state: 'processing',
    // Recogida en tienda: sin dirección de entrega obligatoria.
    delivery_type: 'pickup',
    shipping_address_snapshot: null,
    addresses_orders_shipping_address_idToaddresses: null,
    customer_id: 9,
    currency: 'COP',
    shipping_cost: 0,
    remaining_balance: 0,
    users: { first_name: 'Ana', last_name: 'Ríos', document_number: '123' },
    order_items: items,
  });

  /** Ejecuta `createFromOrder` con ítems explícitos y devuelve lo persistido. */
  const runCreate = async (items: unknown[], dispatched_quantity: number) => {
    prismaMock.orders.findFirst.mockResolvedValue(orderWith(items));
    const created = await service.createFromOrder(ORDER_ID, {
      items: [
        {
          order_item_id: ORDER_ITEM_ID,
          dispatched_quantity,
          location_id: LOCATION_ID,
        },
      ],
    } as any);
    const persisted = txCreate.mock.calls[0][0].data;
    return { created, persisted };
  };

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: STORE_ID, user_id: USER_ID } as any);

    txCreate = jest.fn().mockImplementation(async ({ data }: any) => ({
      id: 7,
      dispatch_number: 'REM-1',
      store_id: data.store_id,
      order_id: data.order_id,
      sales_order_id: null,
    }));
    const txMock = { dispatch_notes: { create: txCreate } };
    prismaMock = {
      orders: { findFirst: jest.fn() },
      stock_reservations: {
        findFirst: jest.fn().mockResolvedValue({ location_id: LOCATION_ID }),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(txMock)),
    };
    dispatchFulfillmentMock = { recomputeOrderFulfillment: jest.fn() };

    service = new DispatchNotesService(
      prismaMock,
      { generateNextNumber: jest.fn().mockResolvedValue('REM-1') } as any,
      {} as any, // routeNumberGenerator
      { emit: jest.fn() } as any,
      {} as any, // stockValidator (el gate se espía abajo)
      {} as any, // aiEngine
      {} as any, // receiptScanQueue
      dispatchFulfillmentMock, // dispatchFulfillment
      undefined as any, // purchaseOrdersService (optional)
    );
    jest
      .spyOn(service as any, 'validateDispatchItemsStock')
      .mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('despacho completo qty 5 base 50.000 IVA 19 % persiste tax 47.500 y total 297.500', async () => {
    const { persisted } = await runCreate([orderItem()], 5);

    const [line] = persisted.dispatch_note_items.create;
    expect(line.tax_amount).toBe(47500);
    expect(line.total_price).toBe(297500);
    expect(line.discount_amount).toBe(0);
    // El encabezado hereda la coherencia: Σ tax_amount y grand_total.
    expect(persisted.tax_amount).toBe(47500);
    expect(persisted.grand_total).toBe(297500);
  });

  it('copia alias y dirección de entrega sin crear cliente para una venta con nombre de referencia', async () => {
    const address = {
      address_line1: 'Cra 7 # 1-3',
      city: 'Bogotá',
      latitude: 4.61,
      longitude: -74.08,
    };
    prismaMock.orders.findFirst.mockResolvedValue({
      ...orderWith([orderItem()]),
      delivery_type: 'home_delivery',
      customer_id: null,
      customer_alias: 'Portería Torre Norte',
      users: null,
      shipping_address_snapshot: address,
    });

    await service.createFromOrder(ORDER_ID, {
      items: [{ order_item_id: ORDER_ITEM_ID, dispatched_quantity: 5, location_id: LOCATION_ID }],
    } as any);

    const persisted = txCreate.mock.calls[0][0].data;
    expect(persisted.customer_id).toBeNull();
    expect(persisted.customer_name).toBe('Portería Torre Norte');
    expect(persisted.customer_address).toEqual(address);
    expect(persisted.customer_tax_id).toBeNull();
  });

  it('conserva el gate de dirección para una venta con alias sin destino', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      ...orderWith([orderItem()]),
      delivery_type: 'home_delivery',
      customer_id: null,
      customer_alias: 'Portería Torre Norte',
      users: null,
    });

    await expect(service.createFromOrder(ORDER_ID, { items: [] } as any)).rejects.toThrow();
    expect(txCreate).not.toHaveBeenCalled();
  });

  it('re-snapshotear la dirección no modifica el nombre copiado', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 7, customer_name: 'Portería Torre Norte' } as any);
    const update = jest.fn().mockResolvedValue({ id: 7, customer_name: 'Portería Torre Norte' });
    prismaMock.dispatch_notes = { update };

    await expect(service.updateCustomerAddressSnapshot(7, {
      address_line_1: 'Cra 7 # 1-3',
      city: 'Bogotá',
    } as any)).resolves.toMatchObject({ customer_name: 'Portería Torre Norte' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customer_address: expect.objectContaining({ address_line1: 'Cra 7 # 1-3' }),
      }),
    }));
    expect(update.mock.calls[0][0].data).not.toHaveProperty('customer_name');
  });

  it('despacho parcial qty 10 → 4 persiste tax = lineTax × 0.4', async () => {
    // Impuesto de línea completa: 9.500 × 10 = 95.000; × 0.4 = 38.000.
    const { persisted } = await runCreate(
      [orderItem({ quantity: 10 })],
      4,
    );

    const [line] = persisted.dispatch_note_items.create;
    expect(line.tax_amount).toBe(38000);
    expect(line.total_price).toBe(200000 + 38000);
    expect(persisted.tax_amount).toBe(38000);
  });

  it('con cantidad ordenada 0 toma el impuesto de línea completo sin dividir por cero', async () => {
    // El snapshot por filas YA es el total de línea (47.500) aunque la
    // cantidad sea 0: la guarda debe persistirlo completo, no NaN/Infinity.
    const { persisted } = await runCreate(
      [
        orderItem({
          quantity: 0,
          order_item_taxes: [{ tax_amount: 47500 }],
        }),
      ],
      3,
    );

    const [line] = persisted.dispatch_note_items.create;
    expect(line.tax_amount).toBe(47500);
    expect(line.total_price).toBe(150000 + 47500);
  });
});
