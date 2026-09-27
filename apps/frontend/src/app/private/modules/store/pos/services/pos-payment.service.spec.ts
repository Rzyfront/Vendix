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

  it('persists a fresh restaurant tip separately from product totals', async () => {
    post.and.returnValue(of({ data: { success: true, order: { id: 1124 } } }));
    await firstValueFrom(service.processSaleWithPayment(cart, {
      ...request, tip_amount: 100, tip_type: 'percentage', tip_value: 100,
      tip_waiter_id: 7, cashReceived: 1100,
    }, 'current_user'));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.total_amount).toBe(1000);
    expect(payload.tip_amount).toBe(100);
    expect(payload.tip_type).toBe('percentage');
    expect(payload.tip_value).toBe(100);
    expect(payload.tip_waiter_id).toBe(7);
    expect(payload.amount_received).toBe(1100);
  });

  it('defaults cash received to payable total including the tip', async () => {
    post.and.returnValue(of({ data: { success: true, order: { id: 1124 } } }));
    await firstValueFrom(service.processSaleWithPayment(cart, {
      ...request, tip_amount: 100,
    }, 'current_user'));
    expect(post.calls.mostRecent().args[1].amount_received).toBe(1100);
  });
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

  it('adds tip fields to a delivery multi-tender sale without adding tip to shipping', async () => {
    await firstValueFrom(service.processShippingSale(cart(), shipping, {
      paymentMethod: { id: '1', type: 'cash' },
      tip_amount: 100, tip_type: 'fixed', tip_value: 100,
      tip_waiter_id: 7,
      payments: [
        { store_payment_method_id: 1, amount: 1000, amount_received: 1000 },
        { store_payment_method_id: 2, amount: 600 },
      ],
    } as any, 'current_user'));
    const payload = post.calls.mostRecent().args[1];
    expect(payload.total_amount).toBe(1500);
    expect(payload.shipping_cost).toBe(500);
    expect(payload.tip_amount).toBe(100);
    expect(payload.tip_waiter_id).toBe(7);
    expect(payload.payments[1].amount).toBe(600);
  });

  it('defaults delivery cash received to shipping plus tip', async () => {
    await firstValueFrom(service.processShippingSale(cart(), shipping, {
      paymentMethod: { id: '1', type: 'cash' }, tip_amount: 100,
    } as any, 'current_user'));
    expect(post.calls.mostRecent().args[1].amount_received).toBe(1600);
  });
});

describe('PosPaymentService.processSaleWithPayment — B15(2) orden adoptada multimétodo enruta a flow/pay', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;
  let flowPayOrder: jasmine.Spy;
  let processPaymentForExistingOrder: jasmine.Spy;
  let processReservedPosPayment: jasmine.Spy;
  let getOrderById: jasmine.Spy;

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
    processReservedPosPayment = jasmine
      .createSpy('processReservedPosPayment')
      .and.returnValue(of({ data: { payment: { id: 902, state: 'succeeded' } } }));
    getOrderById = jasmine.createSpy('getOrderById').and.returnValue(of({
      tip_amount: 0, payments: [],
    }));
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
      { processPaymentForExistingOrder, processReservedPosPayment } as any,
      { flowPayOrder, getOrderById } as any,
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

  it('routes a tipped adopted cash order through flow/pay so the tip is persisted', async () => {
    await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '1', type: 'cash' }, cashReceived: 1100,
      tip_amount: 100, tip_type: 'fixed', tip_value: 100,
    } as any, 'current_user'));
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      store_payment_method_id: 1, amount_received: 1100, tip_amount: 100,
    }));
  });

  it('routes tipped adopted bank transfer through flow/pay with its validated bank account', async () => {
    await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '3', type: 'bank_transfer' },
      bank_account_id: 44, tip_amount: 100,
    } as any, 'current_user'));
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      store_payment_method_id: 3, bank_account_id: 44, tip_amount: 100,
    }));
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
  });

  it('clears a persisted adopted-order tip through flow/pay, not the untipped legacy payment API', async () => {
    getOrderById.and.returnValue(of({ tip_amount: 100, payments: [] }));
    await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '1', type: 'cash' }, cashReceived: 1000,
    } as any, 'current_user'));
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      tip_amount: 0, tip_type: 'fixed', tip_value: 0,
    }));
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
  });

  it('does not start a new tender while an adopted digital reservation is unresolved', async () => {
    getOrderById.and.returnValue(of({ tip_amount: 100, payments: [{
      id: 907, state: 'pending',
      store_payment_method: { system_payment_method: { type: 'wompi' } },
    }] }));
    await expectAsync(firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '1', type: 'cash' }, cashReceived: 1000,
    } as any, 'current_user'))).toBeRejectedWithError(/cobro digital #907 sigue pendiente/);
    expect(flowPayOrder).not.toHaveBeenCalled();
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
  });

  it('reserva una sola fila y procesa propina de wallet sobre orden adoptada', async () => {
    flowPayOrder.and.returnValue(of({
      order: { state: 'pending_payment' }, payment: { id: 902 },
    }));
    const result = await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '4', type: 'wallet' },
      metadata: { walletId: 88 }, tip_amount: 100,
    } as any, 'current_user'));
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      payment_type: 'online', tip_amount: 100,
    }));
    expect(processReservedPosPayment).toHaveBeenCalledOnceWith(902, { wallet_id: 88 });
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
    expect(result.success).toBeTrue();
  });

  it('mantiene Wompi pendiente en espera sin anunciar venta pagada', async () => {
    flowPayOrder.and.returnValue(of({
      order: { state: 'pending_payment' }, payment: { id: 903 },
    }));
    processReservedPosPayment.and.returnValue(of({
      data: { payment: { id: 903, state: 'pending', transaction_id: null } },
    }));
    const result = await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '5', type: 'wompi' },
      metadata: { wompiPaymentMethod: { type: 'NEQUI', phone: '3001234567' } },
      tip_amount: 100,
    } as any, 'current_user'));
    expect(processReservedPosPayment.calls.mostRecent().args[0]).toBe(903);
    expect(result.nextAction?.type).toBe('await');
    expect(result.payment?.id).toBe(903);
  });

  it('no presenta un wallet pendiente de conciliación como pago exitoso', async () => {
    flowPayOrder.and.returnValue(of({
      order: { state: 'pending_payment' }, payment: { id: 904 },
    }));
    processReservedPosPayment.and.returnValue(of({
      data: { payment: { id: 904, state: 'pending' } },
    }));
    const result = await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '4', type: 'wallet' },
      metadata: { walletId: 88 }, tip_amount: 100,
    } as any, 'current_user'));
    expect(result.success).toBeFalse();
    expect(result.message).toContain('pendiente de conciliación');
  });

  it('retoma la misma reserva digital al reintentar tras un resultado ambiguo', async () => {
    flowPayOrder.and.returnValue(throwError(() => ({
      details: { stage: 'digital_payment_pending', payment_id: 905 },
    })));
    getOrderById.and.returnValue(of({ tip_amount: 100, payments: [{
      id: 905, state: 'pending', store_payment_method_id: 4,
    }] }));
    processReservedPosPayment.and.returnValue(of({ data: {
      payment: { id: 905, state: 'succeeded' },
    } }));
    const result = await firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '4', type: 'wallet' },
      metadata: { walletId: 88 }, tip_amount: 100,
    } as any, 'current_user'));
    expect(processReservedPosPayment).toHaveBeenCalledOnceWith(905, { wallet_id: 88 });
    expect(result.payment?.id).toBe(905);
    expect(processPaymentForExistingOrder).not.toHaveBeenCalled();
  });

  it('never resumes a pending reservation with a changed tip or method', async () => {
    flowPayOrder.and.returnValue(throwError(() => ({
      details: { stage: 'digital_payment_pending', payment_id: 905 },
    })));
    getOrderById.and.returnValue(of({ tip_amount: 200, payments: [{
      id: 905, state: 'pending', store_payment_method_id: 4,
    }] }));
    await expectAsync(firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '4', type: 'wallet' },
      metadata: { walletId: 88 }, tip_amount: 100,
    } as any, 'current_user'))).toBeRejectedWithError(/otro medio o importe/);
    expect(processReservedPosPayment).not.toHaveBeenCalled();
  });

  it('explica la reserva y el reintento seguro si falla el procesamiento posterior', async () => {
    flowPayOrder.and.returnValue(of({
      order: { state: 'pending_payment' }, payment: { id: 906 },
    }));
    processReservedPosPayment.and.returnValue(throwError(() => new Error('network timeout')));
    await expectAsync(firstValueFrom(service.processSaleWithPayment(cart, {
      paymentMethod: { id: '4', type: 'wallet' },
      metadata: { walletId: 88 }, tip_amount: 100,
    } as any, 'current_user'))).toBeRejectedWithError(/cobro digital #906 reservado/);
  });

  it('envía tip cero al reintentar sin propina para limpiar un intento anterior', async () => {
    await firstValueFrom(service.processExistingDigitalTip(cart, {
      paymentMethod: { id: '4', type: 'wallet' }, metadata: { walletId: 88 },
    } as any, 41));
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      tip_amount: 0, tip_type: 'fixed', tip_value: 0,
    }));
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
