import { firstValueFrom, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { PosPaymentService } from './pos-payment.service';
import { CartState } from '../models/cart.model';
import { PosShippingSaleData } from '../models/shipping.model';
import { PaymentMethod, PaymentRequest } from '../models/payment.model';

describe('PosPaymentService.processShippingSale — adopted order reference', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;

  const cart = (linkedOrderId: number | null): CartState => ({
    items: [],
    customer: { id: 9, first_name: 'Cliente', last_name: 'POS' },
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
    linkedOrderId,
  } as unknown as CartState);

  const shipping: PosShippingSaleData = {
    shippingMethodId: 3,
    shippingCost: 500,
    deliveryType: 'home_delivery',
    shippingAddress: {
      address_line1: 'Calle 1', city: 'Bogotá', state_province: 'Bogotá',
      country_code: 'CO', recipient_name: 'Cliente POS', recipient_phone: '3000000000',
    },
  };

  beforeEach(() => {
    post = jasmine.createSpy('post').and.returnValue(of({
      data: { success: true, order: { id: 41 }, message: 'OK' },
    }));
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('sends order_id for an adopted cart', async () => {
    await firstValueFrom(service.processShippingSale(cart(41), shipping, null, 'current_user'));
    expect(post.calls.mostRecent().args[1].order_id).toBe(41);
  });

  it('omits order_id for a fresh cart', async () => {
    await firstValueFrom(service.processShippingSale(cart(null), shipping, null, 'current_user'));
    expect(Object.prototype.hasOwnProperty.call(post.calls.mostRecent().args[1], 'order_id')).toBeFalse();
  });

  it('uses the shell editing id when the cart has not hydrated its link yet', async () => {
    await firstValueFrom(service.processShippingSale(
      cart(null), shipping, null, 'current_user', undefined, 57,
    ));
    expect(post.calls.mostRecent().args[1].order_id).toBe(57);
  });

  it('sends alias without customer or address FK, but with snapshot for home delivery', async () => {
    const aliasCart = { ...cart(null), customer: null };
    await firstValueFrom(service.processShippingSale(aliasCart, {
      ...shipping, customerAlias: 'Portería torre B', shippingAddressId: 123,
    }, null, 'current_user'));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.customer_alias).toBe('Portería torre B');
    expect(payload.customer_id).toBeUndefined();
    expect(payload.shipping_address_id).toBeUndefined();
    expect(payload.shipping_address_snapshot).toEqual(shipping.shippingAddress);
  });

  it('keeps registered-customer shipping identity unchanged', async () => {
    await firstValueFrom(service.processShippingSale(cart(null), shipping, null, 'current_user'));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.customer_id).toBe(9);
    expect(payload.customer_alias).toBeUndefined();
  });

  it('omits a stale address id for an adopted alias draft while keeping its snapshot', async () => {
    await firstValueFrom(service.saveDraft(
      { ...cart(41), customer: null }, 'current_user', 'Portería torre B',
      { ...shipping, shippingAddressId: 123 },
    ));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.customer_alias).toBe('Portería torre B');
    expect(payload.customer_id).toBeUndefined();
    expect(payload.shipping_address_id).toBeUndefined();
    expect(payload.shipping_address_snapshot).toEqual(shipping.shippingAddress);
  });

  it('routes a serialized adopted takeaway through POS tx with exact serial selection', async () => {
    const serializedCart = {
      ...cart(41),
      items: [{
        id: 'line-1', itemType: 'product',
        product: { id: '77', name: 'Teléfono', requires_serial_numbers: true },
        quantity: 2, unitPrice: 500, finalPrice: 500, totalPrice: 1000, taxAmount: 0,
        serial_ids: [10], serial_numbers: ['IMEI-2'],
      }],
    } as unknown as CartState;
    await firstValueFrom(service.processSaleWithPayment(
      serializedCart,
      { paymentMethod: { id: '1', type: 'cash' }, isAnonymousSale: false } as any,
      'current_user', null, null, true, true,
    ));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.order_id).toBe(41);
    expect(payload.delivery_type).toBe('direct_delivery');
    expect(payload.items[0]).toEqual(jasmine.objectContaining({
      serial_ids: [10], serial_numbers: ['IMEI-2'],
    }));
  });
});

describe('PosPaymentService.processSaleWithPayment — prior table status', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;
  const cart = {
    items: [],
    customer: null,
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
  } as unknown as CartState;
  const request = {
    paymentMethod: { id: '1', type: 'cash' },
    isAnonymousSale: true,
  } as any;

  beforeEach(() => {
    post = jasmine.createSpy('post');
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  for (const previousStatus of ['cleaning', 'available', 'occupied', undefined] as const) {
    it(`preserves ${previousStatus ?? 'absent'} status without a second request`, async () => {
      post.and.returnValue(of({
        data: {
          success: true,
          order: { id: 1124, payment_status: 'succeeded' },
          payment: { id: 820 },
          ...(previousStatus ? { previous_table_status: previousStatus } : {}),
        },
      }));

      const result = await firstValueFrom(
        service.processSaleWithPayment(cart, request, 'current_user', null, 4),
      );

      expect(post).toHaveBeenCalledTimes(1);
      expect(post.calls.mostRecent().args[1].table_id).toBe(4);
      expect(result.previous_table_status).toBe(previousStatus);
      expect(Object.prototype.hasOwnProperty.call(result, 'previous_table_status'))
        .toBe(previousStatus !== undefined);
      expect(result.order?.id).toBe(1124);
    });
  }
});

describe('PosPaymentService.processShippingSale — B7 nota de envío + B11 cobro multimétodo', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;

  const cart = (): CartState => ({
    items: [],
    customer: { id: 9, first_name: 'Cliente', last_name: 'POS' },
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
    linkedOrderId: null,
    notes: 'Nota del carrito',
  } as unknown as CartState);

  const shipping: PosShippingSaleData = {
    shippingMethodId: 3,
    shippingCost: 500,
    deliveryType: 'home_delivery',
    deliveryNotes: 'Dejar en portería, timbre 2',
    shippingAddress: {
      address_line1: 'Calle 1', city: 'Bogotá', state_province: 'Bogotá',
      country_code: 'CO', recipient_name: 'Cliente POS', recipient_phone: '3000000000',
    },
  } as unknown as PosShippingSaleData;

  beforeEach(() => {
    post = jasmine.createSpy('post').and.returnValue(of({
      data: { success: true, order: { id: 41 }, message: 'OK' },
    }));
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('B7 — envía la nota de envío por el canal `notes` (no solo `internal_notes`)', async () => {
    await firstValueFrom(service.processShippingSale(cart(), shipping, null, 'current_user'));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.notes).toContain('Nota del carrito');
    expect(payload.notes).toContain('Nota de envío: Dejar en portería, timbre 2');
    // `internal_notes` sigue existiendo (lo reescribe order-flow más tarde);
    // B7 no lo toca, solo añade el canal que sí sobrevive al ticket.
    expect(payload.internal_notes).toBe('Dejar en portería, timbre 2');
  });

  it('B11 — con 2+ tramos envía `payments[]` y omite las claves escalares de método', async () => {
    const paymentRequest = {
      paymentMethod: { id: '1', type: 'cash' },
      payments: [
        { store_payment_method_id: 1, amount: 1000, amount_received: 1000 },
        { store_payment_method_id: 2, amount: 500 },
      ],
    } as any;

    await firstValueFrom(
      service.processShippingSale(cart(), shipping, paymentRequest, 'current_user'),
    );
    const payload = post.calls.mostRecent().args[1];
    expect(payload.payments).toEqual(paymentRequest.payments);
    expect(payload.store_payment_method_id).toBeUndefined();
    expect(payload.amount_received).toBeUndefined();
  });

  it('B11 — con 1 tramo conserva el camino escalar de siempre', async () => {
    const paymentRequest = {
      paymentMethod: { id: '1', type: 'cash' },
      cashReceived: 2000,
    } as any;

    await firstValueFrom(
      service.processShippingSale(cart(), shipping, paymentRequest, 'current_user'),
    );
    const payload = post.calls.mostRecent().args[1];
    expect(payload.payments).toBeUndefined();
    expect(payload.store_payment_method_id).toBe(1);
    expect(payload.amount_received).toBe(2000);
  });
});

describe('PosPaymentService.processSaleWithPayment — B15(2) orden adoptada multimétodo enruta a flow/pay', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;
  let flowPayOrder: jasmine.Spy;
  let processPaymentForExistingOrder: jasmine.Spy;

  const cart = {
    items: [],
    customer: null,
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
    linkedOrderId: 41,
    linkedOrderNumber: 'ORD-41',
  } as unknown as CartState;

  beforeEach(() => {
    post = jasmine.createSpy('post');
    processPaymentForExistingOrder = jasmine
      .createSpy('processPaymentForExistingOrder')
      .and.returnValue(of({ data: { payment: { id: 820 } } }));
    flowPayOrder = jasmine.createSpy('flowPayOrder').and.returnValue(of({
      order: { state: 'paid' },
      payment: { id: 900, change: 0 },
      payments: [
        { id: 900, amount: 1000, payment_method: 'Efectivo', status: 'succeeded' },
        { id: 901, amount: 500, payment_method: 'Tarjeta', status: 'succeeded' },
      ],
    }));
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1, getStoreId: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      { processPaymentForExistingOrder } as any,
      { flowPayOrder } as any,
    );
  });

  it('2 tramos en una orden adoptada llaman a `flow/pay`, no al POST escalar de pagos', async () => {
    const paymentRequest = {
      paymentMethod: { id: '1', type: 'cash' },
      payments: [
        { store_payment_method_id: 1, amount: 1000, amount_received: 1000 },
        { store_payment_method_id: 2, amount: 500 },
      ],
    } as any;

    const result = await firstValueFrom(
      service.processSaleWithPayment(cart, paymentRequest, 'current_user'),
    );

    expect(post).not.toHaveBeenCalled();
    expect(flowPayOrder).toHaveBeenCalledTimes(1);
    const [orderIdArg, dtoArg] = flowPayOrder.calls.mostRecent().args;
    expect(orderIdArg).toBe('41');
    expect(dtoArg.payments).toEqual(paymentRequest.payments);
    expect(dtoArg.payment_type).toBe('direct');
    expect(result.success).toBe(true);
    expect(result.order?.id).toBe(41);
    expect(result.payments).toEqual(jasmine.any(Array));
  });

  it('1 tramo en una orden adoptada conserva el camino escalar existente (sin flow/pay)', async () => {
    post.and.returnValue(of({
      data: { success: true, order: { id: 1124 }, payment: { id: 820 } },
    }));
    const paymentRequest = {
      paymentMethod: { id: '1', type: 'cash' },
      cashReceived: 1000,
    } as any;

    await firstValueFrom(service.processSaleWithPayment(cart, paymentRequest, 'current_user'));

    expect(flowPayOrder).not.toHaveBeenCalled();
    expect(processPaymentForExistingOrder).toHaveBeenCalledTimes(1);
  });
});

/**
 * Sin sobreventa — `rethrowApiError` (usado por `processPayment` y el resto
 * de métodos de cobro) preserva `stockShortages` normalizado además de
 * `errorCode`/`details`, para que el POS pueda listar cada producto o insumo
 * faltante en vez de sólo el string de `userMessage`.
 */
describe('PosPaymentService.processPayment — sin sobreventa (INV_STOCK_INSUFFICIENT_LINES)', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;

  const request: PaymentRequest = {
    orderId: 'ORD-1',
    amount: 20000,
    paymentMethod: { id: '1', type: 'cash' } as PaymentMethod,
    cashReceived: 20000,
  };

  beforeEach(() => {
    post = jasmine.createSpy('post');
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1, getStoreId: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('adjunta stockShortages normalizado desde details.items[] del 409', async () => {
    post.and.returnValue(
      throwError(() => new HttpErrorResponse({
        status: 409,
        statusText: 'Conflict',
        url: 'https://api.vendix.com/api/store/payments/pos',
        error: {
          statusCode: 409,
          error_code: 'INV_STOCK_INSUFFICIENT_LINES',
          message:
            'Sin stock suficiente: MODELO (pedido 1, disponible 0). Quítalo de la orden o desactiva «Maneja inventario» en el producto.',
          details: {
            items: [
              {
                product_id: 501,
                product_variant_id: null,
                product_name: 'MODELO',
                kind: 'product',
                requested: 1,
                available: 0,
              },
            ],
          },
        },
      })),
    );

    let caught: any;
    try {
      await firstValueFrom(service.processPayment(request));
      fail('expected processPayment to reject');
    } catch (err) {
      caught = err;
    }

    expect(caught.errorCode).toBe('INV_STOCK_INSUFFICIENT_LINES');
    expect(caught.stockShortages).toEqual([
      {
        product_id: 501,
        product_variant_id: null,
        product_name: 'MODELO',
        kind: 'product',
        requested: 1,
        available: 0,
      },
    ]);
    expect(caught.message).toContain('MODELO');
  });

  it('no adjunta stockShortages cuando el error no trae faltantes', async () => {
    post.and.returnValue(
      throwError(() => new HttpErrorResponse({
        status: 400,
        statusText: 'Bad Request',
        url: 'https://api.vendix.com/api/store/payments/pos',
        error: { statusCode: 400, error_code: 'POS_CUSTOMER_REQUIRED_001', message: 'Customer required' },
      })),
    );

    let caught: any;
    try {
      await firstValueFrom(service.processPayment(request));
      fail('expected processPayment to reject');
    } catch (err) {
      caught = err;
    }

    expect(caught.errorCode).toBe('POS_CUSTOMER_REQUIRED_001');
    expect(caught.stockShortages).toBeUndefined();
  });
});
