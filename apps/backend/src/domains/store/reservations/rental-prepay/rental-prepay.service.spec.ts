import { RequestContextService } from '@common/context/request-context.service';
import {
  RentalPrepayService,
  bookingIdFromRentalPurpose,
  rentalPrepayCents,
  rentalPrepayPurpose,
} from './rental-prepay.service';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';
import { PaymentLinksService } from '../../payment-links/payment-links.service';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../cash-registers/movements/movements.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';

(RequestContextService.getStoreId as jest.Mock) = jest.fn().mockReturnValue(1);
(RequestContextService.getUserId as jest.Mock) = jest.fn().mockReturnValue(9);
(RequestContextService.getContext as jest.Mock) = jest
  .fn()
  .mockReturnValue({ store_id: 1, user_id: 9, organization_id: 3 });

describe('cobro para reservar — cálculo (S1, T15)', () => {
  const station = (over: Record<string, unknown> = {}) => ({
    booking_prepay_mode: 'full',
    booking_prepay_percent: null,
    booking_prepay_amount: null,
    ...over,
  });

  it('pago total cobra el valor cotizado completo', () => {
    expect(rentalPrepayCents(station(), 150000)).toBe(15000000);
  });

  it('abono por porcentaje redondea a centavos enteros', () => {
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'partial', booking_prepay_percent: '33.33' }), 100.01)).toBe(3333);
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'partial', booking_prepay_percent: '50' }), 150000)).toBe(7500000);
  });

  it('abono por monto fijo se limita al valor cotizado', () => {
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'partial', booking_prepay_amount: '40000' }), 150000)).toBe(4000000);
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'partial', booking_prepay_amount: '400000' }), 150000)).toBe(15000000);
  });

  it('sin cobro (none) o sin valor cotizado no cobra nada', () => {
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'none' }), 150000)).toBe(0);
    expect(rentalPrepayCents(station(), 0)).toBe(0);
    expect(rentalPrepayCents(station({ booking_prepay_mode: 'partial' }), 150000)).toBe(0);
  });

  it('el propósito de la solicitud lleva el id de la reserva y se lee de vuelta', () => {
    expect(rentalPrepayPurpose(77)).toBe('service_rental:77');
    expect(bookingIdFromRentalPurpose('service_rental:77')).toBe(77);
    expect(bookingIdFromRentalPurpose('service_deposit')).toBeNull();
    expect(bookingIdFromRentalPurpose('service_rental:abc')).toBeNull();
  });
});

describe('RentalPrepayService', () => {
  const stationRow = {
    id: 5,
    name: 'Cava 3',
    hold_minutes: 30,
    booking_prepay_mode: 'partial',
    booking_prepay_percent: '50',
    booking_prepay_amount: null,
  };

  function build(options: { booking?: any; station?: any; order?: any; existing?: any; method?: any; settings?: any; session?: any; sessionError?: any } = {}) {
    const booking: any = {
      id: 77,
      store_id: 1,
      status: 'pending',
      customer_id: 4,
      order_id: 555,
      booking_number: 'BKG-1',
      channel: 'pos',
      product_id: 100,
      product_variant_id: null,
      quoted_amount: '150000',
      ...options.booking,
    };
    const order: any = {
      id: 555,
      store_id: 1,
      order_number: 'ORD-1',
      customer_id: 4,
      currency: 'COP',
      grand_total: '150000',
      subtotal_amount: '150000',
      tip_amount: 0,
      tax_amount: 0,
      payments: [],
      ...options.order,
    };
    const tx: any = {
      bookings: {
        findFirst: jest.fn().mockResolvedValue(booking),
        update: jest.fn().mockResolvedValue(booking),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      service_allocations: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, state: 'held', station: options.station ?? stationRow }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment_requests: {
        findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orders: {
        findUnique: jest.fn().mockResolvedValue(order),
        findFirst: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue(order),
      },
      store_payment_methods: { findFirst: jest.fn().mockResolvedValue(options.method ?? null) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(options.settings ?? null) },
      stores: { findFirst: jest.fn().mockResolvedValue({ organization_id: 3 }) },
      bank_accounts: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
      payments: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
      products: { findFirst: jest.fn().mockResolvedValue({ name: 'Alquiler cava' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 555 }]),
    };
    const prisma: any = {
      ...tx,
      payment_requests: {
        ...tx.payment_requests,
        findFirst: tx.payment_requests.findFirst,
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const paymentRequests: any = {
      createInTx: jest.fn().mockResolvedValue({ request: { id: 31 }, publicToken: 'tok-1' }),
      rotateTokenInTx: jest.fn().mockResolvedValue({ publicToken: 'tok-2' }),
    };
    const paymentLinks = { deactivate: jest.fn().mockResolvedValue(undefined) };
    const emits: Array<{ name: string; payload: any }> = [];
    const eventEmitter: any = { emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })) };
    const ordersService: any = { create: jest.fn().mockResolvedValue({ id: 556 }) };
    const orderHistory: any = { record: jest.fn().mockResolvedValue(null) };
    const orderFlow = { invoicePaidBookingRentalOrder: jest.fn().mockResolvedValue(undefined) };
    const sessions = {
      assertSessionForSales: options.sessionError
        ? jest.fn().mockRejectedValue(options.sessionError)
        : jest.fn().mockResolvedValue(undefined),
      getActiveSession: jest.fn().mockResolvedValue(options.session ?? null),
    };
    const movements = { recordSaleMovement: jest.fn().mockResolvedValue({ id: 1 }) };
    const moduleRef: any = {
      get: jest.fn((token: unknown) =>
        token === OrderFlowService
          ? orderFlow
          : token === PaymentLinksService
            ? paymentLinks
            : token === SessionsService
              ? sessions
              : token === MovementsService
                ? movements
                : undefined,
      ),
    };
    const service = new RentalPrepayService(prisma, paymentRequests, eventEmitter, ordersService, orderHistory, moduleRef);
    return { service, prisma, tx, booking, order, paymentRequests, paymentLinks, emits, ordersService, orderHistory, orderFlow, sessions, movements };
  }

  const paidEvent = (purpose = 'service_rental:77', amount = 75000) =>
    ({ store_id: 1, payment_request_id: 31, purpose, amount, method: 'wompi', paid_at: new Date() }) as any;

  describe('openLink (POST :id/prepay-link)', () => {
    it('abre una solicitud service_rental por el abono y devuelve la ruta de pago', async () => {
      const { service, paymentRequests, tx } = build();
      const result = await service.openLink(77);
      expect(paymentRequests.createInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ purpose: 'service_rental:77', amount: 75000, created_by_user_id: 9 }),
      );
      expect(result).toEqual(expect.objectContaining({ payment_path: '/pagar/tok-1', payment_request_id: 31, amount: 75000 }));
    });

    it('devuelve el enlace absoluto en el dominio público de la tienda', async () => {
      const { service, prisma } = build();
      prisma.domain_settings = {
        findMany: jest.fn().mockResolvedValue([{ hostname: 'tienda.co', app_type: 'STORE_ECOMMERCE' }]),
      };
      const result = await service.openLink(77);
      expect(result.payment_url).toBe('https://tienda.co/pagar/tok-1');
    });

    it('una reserva pendiente se aparta como payment_pending hasta que se pague', async () => {
      const { service, tx } = build();
      await service.openLink(77);
      expect(tx.service_allocations.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'payment_pending' }) }),
      );
    });

    it('una reserva ya confirmada recibe el enlace sin tocar su apartado', async () => {
      const { service, tx, paymentRequests } = build({ booking: { status: 'confirmed' } });
      await service.openLink(77);
      expect(paymentRequests.createInTx).toHaveBeenCalled();
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
    });

    it('una estación sin cobro para reservar rechaza con RENTAL_PREPAY_001', async () => {
      const { service, paymentRequests } = build({ station: { ...stationRow, booking_prepay_mode: 'none' } });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'RENTAL_PREPAY_001' }),
      });
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
    });

    it('una reserva sin valor cotizado rechaza con RENTAL_PREPAY_002', async () => {
      const { service } = build({ booking: { quoted_amount: null } });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'RENTAL_PREPAY_002' }),
      });
    });

    it('si el cobro ya está pagado rechaza con RENTAL_PREPAY_003', async () => {
      const { service, tx } = build();
      tx.payment_requests.findFirst.mockResolvedValueOnce({ id: 30, status: 'paid' });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'RENTAL_PREPAY_003' }),
      });
    });

    it('si ya hay una solicitud pendiente genera un enlace nuevo en lugar de duplicarla', async () => {
      const { service, tx, paymentRequests } = build();
      tx.payment_requests.findFirst
        .mockResolvedValueOnce(null) // paid
        .mockResolvedValueOnce({ id: 31, status: 'pending', amount: '75000.00', payment_link_id: null }); // open
      const result = await service.openLink(77);
      expect(paymentRequests.rotateTokenInTx).toHaveBeenCalledWith(tx, 31);
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
      expect(result.payment_path).toBe('/pagar/tok-2');
    });

    it('M-3: an open request for a different amount is replaced by one for the capped amount (the old link stops charging)', async () => {
      const expiresAt = new Date('2026-11-05T15:00:00Z');
      const { service, tx, paymentRequests, paymentLinks } = build({
        order: { payments: [{ amount: '100000', state: 'succeeded' }] },
      });
      tx.payment_requests.findFirst
        .mockResolvedValueOnce(null) // paid
        .mockResolvedValueOnce({ id: 31, status: 'pending', amount: '75000.00', payment_link_id: 812, expires_at: expiresAt });
      paymentRequests.createInTx.mockResolvedValueOnce({ request: { id: 32 }, publicToken: 'tok-1' });
      const result = await service.openLink(77);
      expect(tx.payment_requests.updateMany).toHaveBeenCalledWith({
        where: { id: 31, status: 'pending' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(paymentRequests.createInTx).toHaveBeenCalledWith(tx, expect.objectContaining({
        purpose: 'service_rental:77', amount: 50000, expires_at: expiresAt, description: 'Cobro para reservar en Cava 3',
      }));
      expect(paymentRequests.rotateTokenInTx).not.toHaveBeenCalled();
      // The hold is already in place: replacing the request does not move it.
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
      expect(paymentLinks.deactivate).toHaveBeenCalledWith(812);
      expect(result).toMatchObject({ payment_request_id: 32, amount: 50000, payment_path: '/pagar/tok-1', expires_at: expiresAt });
    });

    it('M-3: an order paid in full cancels the still-open request and its Wompi link, then rejects with RENTAL_PREPAY_003', async () => {
      const { service, tx, paymentRequests, paymentLinks } = build({
        order: { payments: [{ amount: '150000', state: 'succeeded' }] },
      });
      tx.payment_requests.findFirst
        .mockResolvedValueOnce(null) // paid
        .mockResolvedValueOnce({ id: 31, status: 'pending', amount: '75000.00', payment_link_id: 812, expires_at: null });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'RENTAL_PREPAY_003' }),
      });
      expect(tx.payment_requests.updateMany).toHaveBeenCalledWith({
        where: { id: 31, status: 'pending' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(paymentLinks.deactivate).toHaveBeenCalledWith(812);
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
    });

    it('a request paid meanwhile (cancel claims nothing) is not replaced', async () => {
      const { service, tx, paymentRequests, paymentLinks } = build({ order: { payments: [{ amount: '100000', state: 'succeeded' }] } });
      tx.payment_requests.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.payment_requests.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 31, status: 'pending', amount: '75000.00', payment_link_id: 812, expires_at: null });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'PAYMENT_REQUEST_INVALID_STATE' }),
      });
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
      expect(paymentLinks.deactivate).not.toHaveBeenCalled();
    });

    it('a failed Wompi deactivation does not undo the replacement', async () => {
      const { service, tx, paymentLinks } = build({ order: { payments: [{ amount: '100000', state: 'succeeded' }] } });
      paymentLinks.deactivate.mockRejectedValueOnce(new Error('wompi down'));
      tx.payment_requests.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 31, status: 'pending', amount: '75000.00', payment_link_id: 812, expires_at: null });
      await expect(service.openLink(77)).resolves.toMatchObject({ amount: 50000 });
    });

    it('M-3: with an order already partly paid the link is capped at the order remaining balance', async () => {
      // 50% of 150000 = 75000, but 100000 are already paid: only 50000 remain.
      const { service, paymentRequests } = build({
        order: { payments: [{ amount: '100000', state: 'succeeded' }] },
      });
      const result = await service.openLink(77);
      expect(paymentRequests.createInTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ amount: 50000 }),
      );
      expect(result.amount).toBe(50000);
    });

    it('M-3: an order already paid in full rejects a new link with RENTAL_PREPAY_003 and no write', async () => {
      const { service, paymentRequests, tx } = build({
        order: { payments: [{ amount: '150000', state: 'succeeded' }] },
      });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'RENTAL_PREPAY_003',
          message: 'La orden de esta reserva ya está pagada: no hay saldo por cobrar.',
        }),
      });
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
      expect(paymentRequests.rotateTokenInTx).not.toHaveBeenCalled();
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
    });

    it('M-3: an order with nothing paid yet keeps the link amount of the station rule', async () => {
      const { service } = build({ order: { payments: [] } });
      const result = await service.openLink(77);
      expect(result.amount).toBe(75000);
    });

    it('M-3: a booking without an order yet is not capped', async () => {
      const { service, tx } = build({ booking: { order_id: null } });
      const result = await service.openLink(77);
      expect(result.amount).toBe(75000);
      expect(tx.orders.findUnique).not.toHaveBeenCalled();
    });

    it('una reserva cancelada rechaza con RENTAL_PREPAY_004', async () => {
      const { service } = build({ booking: { status: 'cancelled' } });
      await expect(service.openLink(77)).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'RENTAL_PREPAY_004' }),
      });
    });
  });

  describe('startHoldInTx (reserva en línea, A17)', () => {
    const args = (tx: any) => ({ storeId: 1, bookingId: 77, stationId: 5, userId: null, tx });

    it('una estación sin cobro para reservar devuelve null (rige el anticipo o el apartado simple)', async () => {
      const { service, tx } = build({ station: { ...stationRow, booking_prepay_mode: 'none' } });
      tx.service_stations = { findFirst: jest.fn().mockResolvedValue({ ...stationRow, booking_prepay_mode: 'none' }) };
      await expect(service.startHoldInTx(tx, args(tx))).resolves.toBeNull();
    });

    it('con cobro abre la solicitud y aparta el cupo como payment_pending', async () => {
      const { service, tx, paymentRequests } = build();
      tx.service_stations = { findFirst: jest.fn().mockResolvedValue(stationRow) };
      const hold = await service.startHoldInTx(tx, args(tx));
      expect(paymentRequests.createInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ purpose: 'service_rental:77', amount: 75000 }),
      );
      expect(hold).toEqual(expect.objectContaining({ publicToken: 'tok-1', amount: 75000 }));
      expect(tx.service_allocations.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'payment_pending' }) }),
      );
    });
  });

  describe('settlePaidRequest (payment_request.paid)', () => {
    it('registra un pago normal en la orden de la reserva (no billetera) y confirma la reserva', async () => {
      const { service, tx, emits } = build({ booking: { status: 'pending' } });
      tx.service_allocations.findFirst.mockResolvedValue({ id: 1, state: 'payment_pending', station: stationRow });
      await service.settlePaidRequest(paidEvent());
      const data = tx.payments.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ order_id: 555, state: 'succeeded', transaction_id: 'SVC-RENTAL-PR-31' }));
      expect(Number(data.amount)).toBe(75000);
      expect(JSON.stringify(data.gateway_response)).not.toContain('wallet');
      const update = tx.orders.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 555 });
      expect(Number(update.data.total_paid.increment)).toBe(75000);
      expect(tx.service_allocations.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: 'confirmed' }) }),
      );
      expect(tx.bookings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'confirmed' }) }),
      );
      const received = emits.find((e) => e.name === 'payment.received');
      expect(received?.payload).toEqual(expect.objectContaining({ order_id: 555, payment_method: 'wompi' }));
    });

    it('H-1: a partial payment emits payment.received with ITS share of the sale, not the whole order', async () => {
      // 119000 = 100000 net + 19000 VAT; a 59500 payment recognises half of each component.
      const { service, emits } = build({
        order: { subtotal_amount: '100000', tax_amount: '19000', grand_total: '119000' },
      });
      await service.settlePaidRequest(paidEvent('service_rental:77', 59500));
      const received = emits.find((e) => e.name === 'payment.received')!.payload;
      expect(Number(received.amount)).toBe(59500);
      expect(received.subtotal_amount).toBe(50000);
      expect(received.tax_amount).toBe(9500);
    });

    it('H-1: the payment that completes the order takes the exact remainder of the sale', async () => {
      const { service, emits, tx } = build({
        order: { subtotal_amount: '100000', tax_amount: '19000', grand_total: '119000' },
      });
      tx.payments.findMany.mockResolvedValue([{ amount: 59500 }]);
      await service.settlePaidRequest(paidEvent('service_rental:77', 59500));
      const received = emits.find((e) => e.name === 'payment.received')!.payload;
      expect(received.subtotal_amount).toBe(50000);
      expect(received.tax_amount).toBe(9500);
    });

    it('H-1: a payment for the full order keeps the order totals untouched', async () => {
      const { service, emits } = build({
        order: { subtotal_amount: '100000', tax_amount: '19000', grand_total: '119000' },
      });
      await service.settlePaidRequest(paidEvent('service_rental:77', 119000));
      const received = emits.find((e) => e.name === 'payment.received')!.payload;
      expect(received.subtotal_amount).toBe(100000);
      expect(received.tax_amount).toBe(19000);
    });

    it('queda el saldo pendiente en la orden cuando el pago es un abono', async () => {
      const { service, tx } = build();
      await service.settlePaidRequest(paidEvent());
      const data = tx.orders.update.mock.calls[0][0].data;
      expect(Number(data.remaining_balance)).toBe(75000);
    });

    it('anuncia booking.rental_prepay_paid con la orden y si quedó pagada del todo', async () => {
      const { service, emits } = build({ order: { grand_total: '75000' } });
      await service.settlePaidRequest(paidEvent());
      const hook = emits.find((e) => e.name === 'booking.rental_prepay_paid');
      expect(hook?.payload).toEqual({ store_id: 1, booking_id: 77, order_id: 555, fully_paid: true });
    });

    it('la orden pagada del todo pasa al emisor de facturas', async () => {
      const { service, orderFlow } = build({ order: { grand_total: '75000' } });
      await service.settlePaidRequest(paidEvent());
      expect(orderFlow.invoicePaidBookingRentalOrder).toHaveBeenCalledWith(555);
    });

    it('un abono no factura todavía', async () => {
      const { service, orderFlow } = build();
      await service.settlePaidRequest(paidEvent());
      expect(orderFlow.invoicePaidBookingRentalOrder).not.toHaveBeenCalled();
    });

    it('un fallo del emisor no deshace el pago registrado', async () => {
      const { service, tx, orderFlow } = build({ order: { grand_total: '75000' } });
      orderFlow.invoicePaidBookingRentalOrder.mockRejectedValueOnce(new Error('dian down'));
      await expect(service.settlePaidRequest(paidEvent())).resolves.toBeUndefined();
      expect(tx.payments.create).toHaveBeenCalled();
    });

    it('un evento repetido no registra el pago dos veces', async () => {
      const { service, tx } = build();
      tx.payments.findFirst.mockResolvedValue({ id: 900 });
      await service.settlePaidRequest(paidEvent());
      expect(tx.payments.create).not.toHaveBeenCalled();
    });

    it('si la reserva no tiene orden la crea con el valor cotizado y registra el pago ahí', async () => {
      const { service, tx, ordersService, booking } = build({ booking: { order_id: null } });
      tx.bookings.findFirst
        .mockResolvedValueOnce({ ...booking, order_id: null })
        .mockResolvedValue({ ...booking, order_id: 556 });
      await service.settlePaidRequest(paidEvent());
      expect(ordersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [expect.objectContaining({ booking_id: 77, unit_price: 150000, quantity: 1 })],
          channel: 'pos',
        }),
        9,
      );
      expect(tx.payments.create).toHaveBeenCalledWith({ data: expect.objectContaining({ order_id: 556 }) });
    });

    it('ignora solicitudes de otros propósitos (el anticipo sigue su camino)', async () => {
      const { service, prisma } = build();
      await service.settlePaidRequest(paidEvent('service_deposit'));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('N3: una reserva en no asistencia no recibe pago ni se factura: se avisa al admin', async () => {
      const { service, tx, orderFlow } = build({ booking: { status: 'no_show' }, order: { grand_total: '75000' } });
      await service.settlePaidRequest(paidEvent());
      expect(tx.payments.create).not.toHaveBeenCalled();
      expect(orderFlow.invoicePaidBookingRentalOrder).not.toHaveBeenCalled();
    });

    it('N3: una orden de alquiler cancelada no recibe pago ni se factura', async () => {
      const { service, tx, orderFlow } = build({ booking: { status: 'confirmed' }, order: { grand_total: '75000', state: 'cancelled' } });
      await service.settlePaidRequest(paidEvent());
      expect(tx.payments.create).not.toHaveBeenCalled();
      expect(tx.orders.update).not.toHaveBeenCalled();
      expect(orderFlow.invoicePaidBookingRentalOrder).not.toHaveBeenCalled();
    });

    it('una reserva cancelada no recibe pago: se avisa y no se toca la orden', async () => {
      const { service, tx } = build({ booking: { status: 'cancelled' } });
      await service.settlePaidRequest(paidEvent());
      expect(tx.payments.create).not.toHaveBeenCalled();
    });
  });

  describe('S1: el pago por enlace deja método, cuenta y comprobante', () => {
    const transferEvent = () =>
      ({ store_id: 1, payment_request_id: 31, purpose: 'service_rental:77', amount: 75000, method: 'transfer', paid_at: new Date() }) as any;

    it('transferencia: el pago lleva el método de la tienda, la única cuenta del método y el comprobante', async () => {
      const { service, tx, prisma } = build();
      prisma.payment_requests.findFirst.mockResolvedValue({
        transfer_store_payment_method_id: 8,
        transfer_receipt_s3_key: 'receipts/r1.jpg',
        transfer_submitted_at: new Date('2026-11-05T10:00:00Z'),
        transfer_reference: 'ABC',
      });
      prisma.store_payment_methods.findFirst.mockResolvedValue({ custom_config: { accounts: [{ id: 21, bank_name: 'B', account_number: '1' }] } });
      await service.settlePaidRequest(transferEvent());
      const data = tx.payments.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          store_payment_method_id: 8,
          bank_account_id: 21,
          receipt_s3_key: 'receipts/r1.jpg',
          receipt_uploaded_at: new Date('2026-11-05T10:00:00Z'),
        }),
      );
    });

    it('transferencia con varias cuentas en el método: el método y el comprobante se guardan, la cuenta queda sin asignar', async () => {
      const { service, tx, prisma } = build();
      prisma.payment_requests.findFirst.mockResolvedValue({
        transfer_store_payment_method_id: 8,
        transfer_receipt_s3_key: 'receipts/r1.jpg',
        transfer_submitted_at: new Date(),
        transfer_reference: null,
      });
      prisma.store_payment_methods.findFirst.mockResolvedValue({ custom_config: { accounts: [{ id: 21 }, { id: 22 }] } });
      await service.settlePaidRequest(transferEvent());
      const data = tx.payments.create.mock.calls[0][0].data;
      expect(data.store_payment_method_id).toBe(8);
      expect(data.bank_account_id).toBeNull();
      expect(data.receipt_s3_key).toBe('receipts/r1.jpg');
    });

    it('Wompi conserva su propio método y no lleva comprobante', async () => {
      const { service, tx, prisma } = build();
      prisma.store_payment_methods.findFirst.mockResolvedValue({ id: 3 });
      await service.settlePaidRequest(paidEvent());
      const data = tx.payments.create.mock.calls[0][0].data;
      expect(data.store_payment_method_id).toBe(3);
      expect(data.bank_account_id).toBeNull();
      expect(data.receipt_s3_key).toBeNull();
    });
  });

  describe('S14: transferencia confirmada por staff', () => {
    const confirmed = (extra: object = {}) =>
      ({ store_id: 1, payment_request_id: 31, purpose: 'service_rental:77', amount: 75000, method: 'transfer', paid_at: new Date(), ...extra }) as any;
    const registerOn = { settings: { settings: { pos: { cash_register: { enabled: true } } } } };

    it('con confirmador y sesión abierta el pago entra a la caja de quien confirmó', async () => {
      const { service, movements } = build({ ...registerOn, session: { id: 40 } });
      await service.settlePaidRequest(confirmed({ confirmed_by_user_id: 12 }));
      expect(movements.recordSaleMovement).toHaveBeenCalledWith(
        40,
        expect.objectContaining({ store_id: 1, user_id: 12, amount: 75000, payment_method: 'bank_transfer', order_id: 555, payment_id: 900 }),
        expect.anything(),
      );
    });

    it('Wompi (sin staff) no registra movimiento de caja', async () => {
      const { service, movements } = build({ ...registerOn, session: { id: 40 } });
      await service.settlePaidRequest(paidEvent());
      expect(movements.recordSaleMovement).not.toHaveBeenCalled();
    });

    it('transferencia sin confirmador (página del cliente) no registra movimiento', async () => {
      const { service, movements } = build({ ...registerOn, session: { id: 40 } });
      await service.settlePaidRequest(confirmed());
      expect(movements.recordSaleMovement).not.toHaveBeenCalled();
    });
  });

  describe('summary (bloque prepay del detalle)', () => {
    it('una reserva pagada muestra lo pagado y nada pendiente por cobrar', async () => {
      const { service } = build({ order: { payments: [{ amount: '75000', state: 'succeeded' }] }, booking: { status: 'confirmed' } });
      const block = await service.summary(77);
      expect(block).toEqual({ paid_amount: 75000, order_total: 150000, remaining: 0, pending_request: null });
    });

    it('sin pagos y con la regla de la estación muestra el saldo por cobrar', async () => {
      const { service } = build();
      expect(await service.summary(77)).toEqual(expect.objectContaining({ paid_amount: 0, remaining: 75000 }));
    });
  });

  describe('receivedCharge (S3: cancelar con cobro recibido)', () => {
    const pay = (id: number, amount: string, state: string, type: string, paid = true) => ({
      id,
      amount,
      state,
      paid_at: paid ? new Date() : null,
      store_payment_method_id: id + 10,
      store_payment_method: { system_payment_method: { type } },
    });

    it('orden viva: una pierna por pago recibido, con su medio y su monto', async () => {
      const { service, tx } = build();
      tx.orders.findFirst.mockResolvedValue({
        id: 555,
        state: 'processing',
        internal_notes: null,
        payments: [pay(1, '50000', 'succeeded', 'cash'), pay(2, '25000', 'succeeded', 'bank_transfer'), pay(3, '10000', 'pending', 'cash', false)],
      });
      expect(await service.receivedCharge(1, 77)).toEqual({
        orderId: 555,
        orderState: 'processing',
        receivedCents: 7500000,
        methodType: 'cash',
        legs: [
          { paymentId: 1, cents: 5000000, methodType: 'cash', storePaymentMethodId: 11 },
          { paymentId: 2, cents: 2500000, methodType: 'bank_transfer', storePaymentMethodId: 12 },
        ],
        cancelledAction: null,
      });
    });

    it('orden cancelada a mano (sin el marcador de la reserva): no hay nada que decidir', async () => {
      const { service, tx } = build();
      tx.orders.findFirst.mockResolvedValue({
        id: 555,
        state: 'cancelled',
        internal_notes: JSON.stringify({ _flow_metadata: { cancellation_reason: 'Cliente desistió' } }),
        payments: [pay(1, '75000', 'cancelled', 'cash')],
      });
      expect(await service.receivedCharge(1, 77)).toBeNull();
    });

    it('orden cancelada por la cancelación de la reserva: cuenta las piernas cobradas y devuelve la acción registrada', async () => {
      const { service, tx } = build();
      tx.orders.findFirst.mockResolvedValue({
        id: 555,
        state: 'cancelled',
        internal_notes: JSON.stringify({ _flow_metadata: { cancellation_reason: 'Reserva BKG-1 cancelada (saldo a favor)' } }),
        payments: [pay(1, '75000', 'cancelled', 'cash'), pay(2, '5000', 'cancelled', 'cash', false)],
      });
      expect(await service.receivedCharge(1, 77)).toEqual(
        expect.objectContaining({
          orderState: 'cancelled',
          receivedCents: 7500000,
          legs: [{ paymentId: 1, cents: 7500000, methodType: 'cash', storePaymentMethodId: 11 }],
          cancelledAction: 'credit',
        }),
      );
    });
  });

  describe('registerInPerson (POST :id/prepay-payment)', () => {
    const cashMethod = { id: 4, system_payment_method: { type: 'cash', processing_mode: 'DIRECT' } };
    const registerOn = { settings: { settings: { pos: { cash_register: { enabled: true } } } } };

    it('sin caja obligatoria registra el pago con el método, confirma la reserva y cancela la solicitud abierta', async () => {
      const { service, tx, paymentLinks, movements } = build({ method: cashMethod });
      tx.payment_requests.findMany.mockResolvedValue([{ id: 31, payment_link_id: 812 }]);
      tx.service_allocations.findFirst.mockResolvedValue({ id: 1, state: 'held', station: stationRow });
      const result = await service.registerInPerson(77, { store_payment_method_id: 4 });
      const data = tx.payments.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ store_payment_method_id: 4, state: 'succeeded', order_id: 555 }));
      expect(Number(data.amount)).toBe(75000);
      expect(tx.bookings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'confirmed' }) }));
      expect(tx.payment_requests.updateMany).toHaveBeenCalledWith({ where: { id: 31, status: 'pending' }, data: expect.objectContaining({ status: 'cancelled' }) });
      expect(paymentLinks.deactivate).toHaveBeenCalledWith(812);
      expect(movements.recordSaleMovement).not.toHaveBeenCalled();
      expect(result.fully_paid).toBe(false);
    });

    it('caja obligatoria y sin sesión abierta: rechaza con CASH_SESSION_REQUIRED_001 y no registra nada', async () => {
      const { service, tx } = build({
        method: cashMethod,
        ...registerOn,
        sessionError: new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
      });
      await expect(service.registerInPerson(77, { store_payment_method_id: 4 })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'CASH_SESSION_REQUIRED_001' }),
      });
      expect(tx.payments.create).not.toHaveBeenCalled();
    });

    it('la compuerta de caja corre para cualquier método, no solo efectivo', async () => {
      const { service, sessions } = build({
        method: { id: 6, system_payment_method: { type: 'card', processing_mode: 'DIRECT' } },
        ...registerOn,
        session: { id: 40 },
      });
      await service.registerInPerson(77, { store_payment_method_id: 6 });
      expect(sessions.assertSessionForSales).toHaveBeenCalledWith(9);
    });

    it('con sesión abierta el pago entra a la caja de quien cobra como movimiento de venta', async () => {
      const { service, movements } = build({ method: cashMethod, ...registerOn, session: { id: 40 } });
      await service.registerInPerson(77, { store_payment_method_id: 4 });
      expect(movements.recordSaleMovement).toHaveBeenCalledWith(
        40,
        expect.objectContaining({ store_id: 1, user_id: 9, amount: 75000, payment_method: 'cash', order_id: 555, payment_id: 900 }),
        expect.anything(),
      );
    });

    it('sin cobro pendiente responde STATION_BOOKING_015', async () => {
      const { service, tx } = build({ method: cashMethod, order: { payments: [{ amount: '75000', state: 'succeeded' }] } });
      await expect(service.registerInPerson(77, { store_payment_method_id: 4 })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_BOOKING_015' }),
      });
      expect(tx.payments.create).not.toHaveBeenCalled();
    });

    it('B1: dos cobros simultáneos en modo parcial: bajo el bloqueo lo cobrado más el monto supera la meta y responde STATION_BOOKING_015 sin crear el pago', async () => {
      const { service, tx } = build({ method: cashMethod });
      // The summary read (outside the lock) saw nothing paid; the other request committed before this lock.
      tx.orders.findUnique.mockResolvedValue({ id: 555, store_id: 1, customer_id: 4, currency: 'COP', grand_total: '150000', payments: [{ amount: '75000', state: 'succeeded' }] });
      await expect(service.registerInPerson(77, { store_payment_method_id: 4 })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_BOOKING_015' }),
      });
      expect(tx.payments.create).not.toHaveBeenCalled();
    });

    it('B1: el request_id del diálogo es la llave del pago: el transaction_id la lleva', async () => {
      const { service, tx } = build({ method: cashMethod });
      await service.registerInPerson(77, { store_payment_method_id: 4, request_id: 'dlg-1234abcd' });
      expect(tx.payments.create.mock.calls[0][0].data.transaction_id).toBe('SVC-RENTAL-IP-77-dlg-1234abcd');
    });

    it('B1: un reintento con la misma llave devuelve el estado actual y no registra otro pago', async () => {
      const { service, tx, sessions } = build({ method: cashMethod, order: { payments: [{ amount: '75000', state: 'succeeded' }] } });
      tx.payments.findFirst.mockResolvedValue({ id: 900 });
      await expect(
        service.registerInPerson(77, { store_payment_method_id: 4, request_id: 'dlg-1234abcd' }),
      ).resolves.toEqual({ paid_amount: 75000, fully_paid: false });
      expect(tx.payments.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { transaction_id: 'SVC-RENTAL-IP-77-dlg-1234abcd' } }));
      expect(tx.payments.create).not.toHaveBeenCalled();
      expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    });

    it('un método inválido (pasarela) responde STATION_BOOKING_016', async () => {
      const { service } = build({ method: { id: 5, system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } } });
      await expect(service.registerInPerson(77, { store_payment_method_id: 5 })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_BOOKING_016' }),
      });
    });

    it('un valor mayor al pendiente responde STATION_BOOKING_016', async () => {
      const { service } = build({ method: cashMethod });
      await expect(service.registerInPerson(77, { store_payment_method_id: 4, amount: 80000 })).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STATION_BOOKING_016' }),
      });
    });
  });
});
