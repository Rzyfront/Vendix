import { DispatchNotesService } from './dispatch-notes.service';
import { RequestContextService } from '@common/context/request-context.service';

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
      dispatch_notes: { findMany: jest.fn(), findFirst: jest.fn() },
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
});
