import { RequestContextService } from '@common/context/request-context.service';
import { ReservationDepositsService } from './reservation-deposits.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { ShippingTaxService } from '../shipping/services/shipping-tax.service';
import { SettingsService } from '../settings/settings.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { RentalPrepayService } from './rental-prepay/rental-prepay.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';

jest.mock('../service-sessions/utils/session-order-lines.util', () => ({
  ...jest.requireActual('../service-sessions/utils/session-order-lines.util'),
  writeSessionOrderTotals: jest.fn().mockResolvedValue({}),
}));

const code = (errorCode: string) => ({
  response: expect.objectContaining({ error_code: errorCode }),
});

describe('ReservationDepositsService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9);
  });
  afterEach(() => jest.restoreAllMocks());

  const station = (over: Record<string, unknown> = {}) => ({
    id: 5,
    deposit_policy: 'required',
    deposit_amount: 400000,
    hold_minutes: 30,
    cancel_refund_hours: 24,
    leftover_policy: 'refund_or_credit',
    reservation_fee_tax_category_id: null,
    name: 'Cava 3',
    ...over,
  });

  function build(opts: { policy?: string; balance?: number; booking?: any; allocation?: any; gateError?: any; received?: any } = {}) {
    const tx: any = {
      service_stations: { findFirst: jest.fn().mockResolvedValue(station({ deposit_policy: opts.policy ?? 'required' })) },
      service_allocations: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(
          opts.allocation === undefined
            ? { id: 1, state: 'payment_pending', start_at: new Date(Date.now() + 48 * 3_600_000), expires_at: null, station: station() }
            : opts.allocation,
        ),
      },
      bookings: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(
          opts.booking === undefined
            ? { id: 77, status: 'pending', customer_id: 1, booking_number: 'BKG-1' }
            : opts.booking,
        ),
      },
      service_deposits: {
        findFirst: jest.fn().mockResolvedValue({ id: 3, status: 'pending', booking_id: 77, customer_id: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      payment_requests: {
        findFirst: jest.fn().mockResolvedValue({ id: 9, status: 'pending', payment_link_id: null, expires_at: null }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orders: {
        create: jest.fn().mockResolvedValue({ id: 900 }),
        findFirst: jest.fn().mockResolvedValue({ id: 900, subtotal_amount: 400000, tax_amount: 0, grand_total: 400000, shipping_cost: 0, discount_amount: 0 }),
      },
      order_items: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ total_price: 400000, order_item_taxes: [] }]),
      },
    };
    tx.service_deposits.findMany.mockResolvedValue([]);
    const prisma: any = { ...tx, $transaction: jest.fn(async (cb: any) => cb(tx)), stores: {} };
    const received = { deposit_id: 1, amount: 400000 };
    const deposits: any = {
      balanceOf: jest.fn().mockResolvedValue({ received: opts.balance ?? 400000, balance: opts.balance ?? 400000 }),
      receiveInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 1 }, event: received }),
      assertRequestFreeInTx: jest.fn().mockResolvedValue(undefined),
      createPendingInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 3 } }),
      completePendingInTx: jest.fn().mockResolvedValue({ claimed: true, event: received }),
      refundInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 4 }, amount: 400000, event: { deposit_id: 4 } }),
      releaseInTx: jest.fn().mockResolvedValue({ created: true, deposit: { id: 5 }, amount: 400000 }),
      applyToOrderInTx: jest.fn().mockResolvedValue({
        applied: true,
        amount: 400000,
        payment_id: 55,
        deposit_id: 6,
        payment_received: {
          payment_id: 55,
          amount: 400000,
          currency: 'COP',
          accounting_method: 'wallet',
          order: { id: 900, order_number: 'RSV-77', store_id: 1, customer_id: 1, subtotal_amount: 400000, tip_amount: 0 },
          payment: { id: 55, amount: 400000, currency: 'COP', accounting_method: 'wallet' },
        },
      }),
      announceReceived: jest.fn(),
      announceRefunded: jest.fn(),
    };
    const paymentRequests: any = {
      createInTx: jest.fn().mockResolvedValue({ request: { id: 9 }, publicToken: 'tok-1' }),
      rotateTokenInTx: jest.fn().mockResolvedValue({ publicToken: 'tok-2' }),
    };
    const emits: any[] = [];
    const eventEmitter: any = { emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })) };
    const links = { deactivate: jest.fn().mockResolvedValue(undefined) };
    const notifications = { createAndBroadcast: jest.fn().mockResolvedValue(undefined) };
    const taxes = { taxRowsForCategory: jest.fn().mockResolvedValue([]) };
    const settings = { getStoreCurrency: jest.fn().mockResolvedValue('COP') };
    const orderFlow = { invoicePaidReservationFeeOrder: jest.fn().mockResolvedValue(undefined) };
    const sessions = {
      assertSessionForSales: opts.gateError ? jest.fn().mockRejectedValue(opts.gateError) : jest.fn().mockResolvedValue(undefined),
    };
    const prepay = {
      receivedCharge: jest.fn().mockResolvedValue(opts.received ?? null),
      cancelOpenRequestsInTx: jest.fn().mockResolvedValue([]),
      deactivateLinks: jest.fn().mockResolvedValue(undefined),
    };
    const lookups = new Map<unknown, unknown>([
      [SessionsService, sessions],
      [RentalPrepayService, prepay],
      [PaymentLinksService, links],
      [NotificationsService, notifications],
      [ShippingTaxService, taxes],
      [SettingsService, settings],
      [OrderFlowService, orderFlow],
    ]);
    const moduleRef: any = { get: jest.fn((token: unknown) => lookups.get(token)) };
    const coordinator: any = {
      allocateBooking: jest.fn().mockResolvedValue({ id: 2 }),
      releaseBooking: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ReservationDepositsService(prisma, deposits, paymentRequests, eventEmitter, moduleRef, coordinator);
    return { service, tx, prisma, deposits, paymentRequests, emits, links, notifications, taxes, coordinator, orderFlow, sessions, prepay };
  }

  const link = { amount: 400000, mode: 'link' as const, request_id: 'req-1' };
  const startArgs = { storeId: 1, bookingId: 77, customerId: 1, stationId: 5, userId: 9 };

  describe('startInTx', () => {
    it('S1/S15: a station that requires a deposit rejects a booking without one', async () => {
      const { service, tx } = build();
      await expect(service.startInTx(tx, { ...startArgs, deposit: null })).rejects.toMatchObject(code('STATION_BOOKING_001'));
    });

    it('a booking without a deposit on an optional or free station takes nothing (as before)', async () => {
      for (const policy of ['optional', 'none']) {
        const { service, tx, deposits, paymentRequests } = build({ policy });
        await expect(service.startInTx(tx, { ...startArgs, deposit: undefined })).resolves.toBeNull();
        expect(deposits.receiveInTx).not.toHaveBeenCalled();
        expect(paymentRequests.createInTx).not.toHaveBeenCalled();
      }
    });

    it('rejects a deposit on a station that takes none, without customer, or below the minimum', async () => {
      const none = build({ policy: 'none' });
      await expect(none.service.startInTx(none.tx, { ...startArgs, deposit: link })).rejects.toMatchObject(code('STATION_BOOKING_002'));
      const anon = build();
      await expect(anon.service.startInTx(anon.tx, { ...startArgs, customerId: null, deposit: link })).rejects.toMatchObject(code('STATION_BOOKING_008'));
      const low = build();
      await expect(low.service.startInTx(low.tx, { ...startArgs, deposit: { ...link, amount: 399999.99 } })).rejects.toMatchObject(code('STATION_BOOKING_003'));
    });

    it('S15 desk: receives the money with the idempotency key, defaults to cash and confirms the booking', async () => {
      const { service, tx, deposits } = build();
      const result = await service.startInTx(tx, { ...startArgs, deposit: { ...link, mode: 'desk' } });
      expect(deposits.receiveInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ booking_id: 77, customer_id: 1, amount: 400000, method: 'cash', request_id: 'req-1', user_id: 9 }),
      );
      expect(tx.bookings.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'confirmed' }),
      });
      expect(result).toMatchObject({ mode: 'desk', publicToken: null });
      expect(result?.event).toEqual({ deposit_id: 1, amount: 400000 });
    });

    it('S15 link (D11): holds the slot payment_pending for hold_minutes and opens the request and the pending row', async () => {
      const { service, tx, deposits, paymentRequests } = build();
      const before = Date.now();
      const result = await service.startInTx(tx, { ...startArgs, deposit: link });
      const update = tx.service_allocations.updateMany.mock.calls[0][0];
      expect(update.data.state).toBe('payment_pending');
      const held = update.data.expires_at.getTime() - before;
      expect(held).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
      expect(held).toBeLessThanOrEqual(30 * 60_000 + 5000);
      expect(paymentRequests.createInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ purpose: 'service_deposit', amount: 400000, created_by_user_id: 9 }),
      );
      expect(deposits.createPendingInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ booking_id: 77, payment_request_id: 9, request_id: 'req-1', amount: 400000 }),
      );
      expect(deposits.receiveInTx).not.toHaveBeenCalled();
      expect(result).toMatchObject({ mode: 'link', publicToken: 'tok-1', event: null });
    });
  });

  describe('M-2a: the deposit key is tied to the booking', () => {
    it('link mode: a key used by another booking is rejected before the slot, the request or the row are touched', async () => {
      const { service, tx, deposits, paymentRequests } = build();
      deposits.assertRequestFreeInTx.mockRejectedValueOnce({ errorCode: 'SERVICE_DEPOSIT_004' });
      await expect(service.startInTx(tx, { ...startArgs, deposit: link })).rejects.toMatchObject({ errorCode: 'SERVICE_DEPOSIT_004' });
      expect(deposits.assertRequestFreeInTx).toHaveBeenCalledWith(tx, { store_id: 1, request_id: 'req-1', booking_id: 77 });
      expect(paymentRequests.createInTx).not.toHaveBeenCalled();
      expect(deposits.createPendingInTx).not.toHaveBeenCalled();
      expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
      expect(tx.bookings.update).not.toHaveBeenCalled();
    });

    it('desk mode: a key used by another booking never confirms the booking', async () => {
      const { service, tx, deposits } = build();
      deposits.receiveInTx.mockRejectedValueOnce({ errorCode: 'SERVICE_DEPOSIT_004' });
      await expect(service.startInTx(tx, { ...startArgs, deposit: { ...link, mode: 'desk' } })).rejects.toMatchObject({ errorCode: 'SERVICE_DEPOSIT_004' });
      expect(tx.bookings.update).not.toHaveBeenCalled();
    });

    it('a retry of the same booking (key free for it) still opens the link as before', async () => {
      const { service, tx, paymentRequests } = build();
      await expect(service.startInTx(tx, { ...startArgs, deposit: link })).resolves.toMatchObject({ mode: 'link', publicToken: 'tok-1' });
      expect(paymentRequests.createInTx).toHaveBeenCalledTimes(1);
    });
  });

  describe('startHoldInTx (S3, A12)', () => {
    const args = { storeId: 1, bookingId: 77, customerId: 1, stationId: 5, userId: 9 };

    it('only a station that requires a deposit holds behind a payment page', async () => {
      const optional = build({ policy: 'optional' });
      await expect(optional.service.startHoldInTx(optional.tx, args)).resolves.toBeNull();
      expect(optional.paymentRequests.createInTx).not.toHaveBeenCalled();

      const required = build();
      const hold = await required.service.startHoldInTx(required.tx, args);
      expect(hold).toMatchObject({ publicToken: 'tok-1', amount: 400000 });
      expect(required.deposits.createPendingInTx).toHaveBeenCalledWith(
        required.tx,
        expect.objectContaining({ request_id: 'hold:77', method: 'wompi' }),
      );
    });
  });

  describe('rotateLink (S15)', () => {
    it('answers a new payment_path for the pending request', async () => {
      const { service, tx, paymentRequests } = build();
      tx.service_deposits.findFirst.mockResolvedValue({ payment_request_id: 9 });
      await expect(service.rotateLink(77)).resolves.toEqual({ payment_path: '/pagar/tok-2', payment_url: null, payment_request_id: 9 });
      expect(paymentRequests.rotateTokenInTx).toHaveBeenCalledWith(tx, 9);
    });

    it('answers the absolute payment_url on the store public domain, never the admin host', async () => {
      const { service, tx, prisma } = build();
      tx.service_deposits.findFirst.mockResolvedValue({ payment_request_id: 9 });
      prisma.domain_settings = {
        findMany: jest.fn().mockResolvedValue([
          { hostname: 'admin.tienda.co', app_type: 'STORE_ADMIN' },
          { hostname: 'tienda.co', app_type: 'STORE_ECOMMERCE' },
        ]),
      };
      await expect(service.rotateLink(77)).resolves.toMatchObject({ payment_url: 'https://tienda.co/pagar/tok-2' });
    });

    it('without a pending request answers STATION_BOOKING_007', async () => {
      const { service, tx } = build();
      tx.service_deposits.findFirst.mockResolvedValue(null);
      await expect(service.rotateLink(77)).rejects.toMatchObject(code('STATION_BOOKING_007'));
    });
  });

  describe('settlePaidRequest (payment_request.paid)', () => {
    const event = (over: Record<string, unknown> = {}) => ({
      store_id: 1,
      payment_request_id: 9,
      purpose: 'service_deposit',
      amount: 400000,
      method: 'wompi' as const,
      paid_at: new Date(),
      ...over,
    });

    it('S14: the user who confirmed the transfer is passed to the ledger so the cash is attributed to them', async () => {
      const { service, tx, deposits } = build();
      await service.settlePaidRequest(event({ method: 'transfer', confirmed_by_user_id: 12 }));
      expect(deposits.completePendingInTx).toHaveBeenCalledWith(tx, { deposit_id: 3, store_id: 1, user_id: 12 });
    });

    it('confirms the booking and the allocation, completes the ledger row and announces after commit', async () => {
      const { service, tx, deposits, emits } = build();
      await service.settlePaidRequest(event());
      expect(deposits.completePendingInTx).toHaveBeenCalledWith(tx, { deposit_id: 3, store_id: 1, user_id: null });
      expect(tx.service_allocations.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ state: 'payment_pending' }),
        data: expect.objectContaining({ state: 'confirmed', expires_at: null }),
      });
      expect(tx.bookings.updateMany).toHaveBeenCalledWith({
        where: { id: 77, status: 'pending' },
        data: expect.objectContaining({ status: 'confirmed', expires_at: null }),
      });
      expect(deposits.announceReceived).toHaveBeenCalledWith({ deposit_id: 1, amount: 400000 });
      expect(emits.map((e) => e.name)).toContain('booking.deposit_paid');
    });

    it('records the way the money arrived on the pending row before completing it', async () => {
      const { service, tx } = build();
      await service.settlePaidRequest(event({ method: 'transfer' }));
      expect(tx.service_deposits.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: 'pending' },
        data: expect.objectContaining({ method: 'bank_transfer' }),
      });
    });

    it('ignores a request that is not a booking deposit', async () => {
      const { service, tx, deposits } = build();
      tx.service_deposits.findFirst.mockResolvedValue(null);
      await service.settlePaidRequest(event());
      expect(deposits.completePendingInTx).not.toHaveBeenCalled();
      expect(tx.bookings.updateMany).not.toHaveBeenCalled();
    });

    it('a repeated event settles nothing twice and announces nothing', async () => {
      const { service, tx, deposits } = build();
      deposits.completePendingInTx.mockResolvedValue({ claimed: false, reason: 'already_completed', event: null });
      await service.settlePaidRequest(event());
      expect(tx.bookings.updateMany).not.toHaveBeenCalled();
      expect(deposits.announceReceived).not.toHaveBeenCalled();
    });

    it('A9 late payment: revives the cancelled row, takes the same slot back and confirms the booking', async () => {
      const { service, tx, deposits, coordinator, notifications } = build({
        booking: { id: 77, status: 'cancelled', customer_id: 1 },
        allocation: { id: 1, state: 'expired', start_at: new Date(), expires_at: null, station: station() },
      });
      tx.service_deposits.findFirst.mockResolvedValue({ id: 3, status: 'cancelled', booking_id: 77, customer_id: 1 });
      // second lookup (the booking read of the retake) returns the schedule fields
      tx.bookings.findFirst
        .mockResolvedValueOnce({ id: 77, status: 'cancelled' })
        .mockResolvedValueOnce({
          id: 77,
          booking_number: 'BKG-1',
          product_id: 100,
          product_variant_id: null,
          provider_id: null,
          date: new Date('2099-09-01T00:00:00Z'),
          end_date: null,
          start_time: '10:00',
          end_time: '11:00',
          is_open_ended: false,
        });
      await service.settlePaidRequest(event());
      expect(tx.service_deposits.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: 'cancelled' },
        data: expect.objectContaining({ status: 'pending' }),
      });
      expect(deposits.completePendingInTx).toHaveBeenCalled();
      expect(coordinator.allocateBooking).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ bookingId: 77, stationId: 5, date: '2099-09-01', state: 'confirmed' }),
      );
      expect(tx.bookings.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'confirmed' }),
      });
      expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
        1,
        'payment_received',
        expect.stringContaining('fuera de plazo'),
        expect.any(String),
        expect.objectContaining({ retaken: true }),
      );
    });

    it('A9 late payment, slot taken meanwhile: the money stays as credit and the administrator is told', async () => {
      const { service, tx, deposits, coordinator, notifications } = build({
        booking: { id: 77, status: 'cancelled', customer_id: 1 },
        allocation: { id: 1, state: 'expired', start_at: new Date(), expires_at: null, station: station() },
      });
      tx.service_deposits.findFirst.mockResolvedValue({ id: 3, status: 'cancelled', booking_id: 77, customer_id: 1 });
      tx.bookings.findFirst
        .mockResolvedValueOnce({ id: 77, status: 'cancelled' })
        .mockResolvedValueOnce({
          id: 77,
          booking_number: 'BKG-1',
          product_id: 100,
          product_variant_id: null,
          provider_id: null,
          date: new Date('2099-09-01T00:00:00Z'),
          end_date: null,
          start_time: '10:00',
          end_time: '11:00',
          is_open_ended: false,
        });
      coordinator.allocateBooking.mockRejectedValue(new Error('exclusion violation'));
      await expect(service.settlePaidRequest(event())).resolves.toBeUndefined();
      expect(deposits.completePendingInTx).toHaveBeenCalled(); // credited to the wallet first
      expect(tx.bookings.update).not.toHaveBeenCalled(); // booking stays cancelled
      expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
        1,
        'payment_received',
        expect.stringContaining('el horario ya no está libre'),
        expect.stringContaining('saldo a favor'),
        expect.objectContaining({ retaken: false }),
      );
    });
  });

  describe('expireOverdueHolds (D11, A9)', () => {
    const overdue = [{ id: 3, booking_id: 77, payment_request_id: 9 }];

    it('cancels the booking, releases the slot as expired, cancels the row and expires the request', async () => {
      const { service, tx, coordinator, emits, links } = build();
      tx.service_deposits.findMany.mockResolvedValue(overdue);
      tx.payment_requests.findFirst.mockResolvedValue({ id: 9, status: 'pending', payment_link_id: 4 });
      await expect(service.expireOverdueHolds()).resolves.toBe(1);
      expect(tx.bookings.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 77, status: 'pending' }),
        data: expect.objectContaining({ status: 'cancelled', expires_at: null }),
      });
      expect(coordinator.releaseBooking).toHaveBeenCalledWith(tx, 1, 77, 'expired');
      expect(tx.service_deposits.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: 'pending' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(tx.payment_requests.updateMany).toHaveBeenCalledWith({
        where: { id: 9, status: 'pending' },
        data: expect.objectContaining({ status: 'expired' }),
      });
      expect(links.deactivate).toHaveBeenCalledWith(4);
      expect(emits.map((e) => e.name)).toContain('booking.hold_expired');
    });

    it('A9: a receipt under review does not let the hold expire', async () => {
      const { service, tx, coordinator } = build();
      tx.service_deposits.findMany.mockResolvedValue(overdue);
      tx.payment_requests.findFirst.mockResolvedValue({ id: 9, status: 'awaiting_confirmation', payment_link_id: null });
      await expect(service.expireOverdueHolds()).resolves.toBe(0);
      expect(coordinator.releaseBooking).not.toHaveBeenCalled();
    });

    it('A9: a paid request whose settlement failed is settled again, never expired', async () => {
      const { service, tx, coordinator, deposits } = build();
      tx.service_deposits.findMany.mockResolvedValue(overdue);
      tx.payment_requests.findFirst.mockResolvedValue({
        id: 9,
        status: 'paid',
        payment_link_id: 4,
        purpose: 'service_deposit',
        amount: 400000,
        paid_at: new Date(),
        transfer_submitted_at: new Date(),
      });
      await expect(service.expireOverdueHolds()).resolves.toBe(0);
      expect(coordinator.releaseBooking).not.toHaveBeenCalled();
      expect(tx.bookings.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      );
      expect(tx.service_deposits.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
      );
      expect(tx.service_deposits.updateMany).toHaveBeenCalledWith({
        where: { id: 3, status: 'pending' },
        data: expect.objectContaining({ method: 'bank_transfer' }),
      });
      expect(deposits.completePendingInTx).toHaveBeenCalledWith(tx, { deposit_id: 3, store_id: 1, user_id: null });
    });

    it('is idempotent: a booking already claimed by another tick is not released twice', async () => {
      const { service, tx, coordinator, links } = build();
      tx.service_deposits.findMany.mockResolvedValue(overdue);
      tx.bookings.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.expireOverdueHolds()).resolves.toBe(0);
      expect(coordinator.releaseBooking).not.toHaveBeenCalled();
      expect(links.deactivate).not.toHaveBeenCalled();
    });

    it('nothing overdue means nothing released', async () => {
      const { service, coordinator } = build();
      await expect(service.expireOverdueHolds()).resolves.toBe(0);
      expect(coordinator.releaseBooking).not.toHaveBeenCalled();
    });
  });

  describe('deferNoShowIfDeposit (S17)', () => {
    it('with a balance it sets deposit_decision_due_at once, tells the admin and defers', async () => {
      const { service, tx, notifications } = build();
      await expect(service.deferNoShowIfDeposit(77)).resolves.toBe(true);
      expect(tx.bookings.updateMany).toHaveBeenCalledWith({
        where: { id: 77, store_id: 1, deposit_decision_due_at: null },
        data: expect.objectContaining({ deposit_decision_due_at: expect.any(Date) }),
      });
      expect(notifications.createAndBroadcast).toHaveBeenCalledTimes(1);
    });

    it('a second tick defers again without notifying again', async () => {
      const { service, tx, notifications } = build();
      tx.bookings.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.deferNoShowIfDeposit(77)).resolves.toBe(true);
      expect(notifications.createAndBroadcast).not.toHaveBeenCalled();
    });

    it('without a balance it does nothing (the booking is archived as before)', async () => {
      const { service, tx } = build({ balance: 0 });
      await expect(service.deferNoShowIfDeposit(77)).resolves.toBe(false);
      expect(tx.bookings.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelWithDeposit (A1)', () => {
    it('without deposit rows it returns null and touches nothing (the plain cancel runs)', async () => {
      const { service, deposits } = build({ balance: 0 });
      await expect(service.cancelWithDeposit(77, {})).resolves.toBeNull();
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(deposits.releaseInTx).not.toHaveBeenCalled();
    });

    it('only an unpaid request: cancels it and lets the plain cancel run', async () => {
      const { service, tx, deposits } = build({ balance: 0 });
      tx.service_deposits.count.mockResolvedValue(1);
      tx.service_deposits.findMany.mockResolvedValue([{ id: 3, payment_request_id: 9 }]);
      await expect(service.cancelWithDeposit(77, {})).resolves.toBeNull();
      expect(tx.payment_requests.updateMany).toHaveBeenCalledWith({
        where: { id: 9, status: 'pending' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(deposits.refundInTx).not.toHaveBeenCalled();
    });

    it('M-5: a transfer receipt awaiting confirmation blocks the cancel with 409 and nothing is cancelled', async () => {
      const { service, tx, deposits } = build({ balance: 0 });
      tx.service_deposits.count.mockResolvedValue(1);
      tx.service_deposits.findMany.mockResolvedValue([{ id: 3, payment_request_id: 9 }]);
      tx.payment_requests.findMany.mockResolvedValue([{ id: 9 }]);
      const error: any = await service.cancelWithDeposit(77, {}).catch((e) => e);
      expect(error.errorCode).toBe('SERVICE_DEPOSIT_010');
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse().message).toBe(
        'El cliente envió un comprobante que está por confirmar. Confírmalo o recházalo en Reservas → Cobros antes de cancelar.',
      );
      expect(tx.payment_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: [9] }, status: 'awaiting_confirmation' }) }),
      );
      expect(tx.payment_requests.updateMany).not.toHaveBeenCalled();
      expect(tx.service_deposits.updateMany).not.toHaveBeenCalled();
      expect(deposits.refundInTx).not.toHaveBeenCalled();
    });

    it('M-5: with a balance too, a receipt awaiting confirmation blocks the cancel before the booking is closed', async () => {
      const { service, tx, coordinator } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1 } });
      tx.service_deposits.count.mockResolvedValue(1);
      tx.service_deposits.findMany.mockResolvedValue([{ id: 3, payment_request_id: 9 }]);
      tx.payment_requests.findMany.mockResolvedValue([{ id: 9 }]);
      await expect(service.cancelWithDeposit(77, {})).rejects.toMatchObject({ errorCode: 'SERVICE_DEPOSIT_010' });
      expect(tx.payment_requests.updateMany).not.toHaveBeenCalled();
      expect(coordinator.releaseBooking).not.toHaveBeenCalled();
      expect(tx.bookings.update).not.toHaveBeenCalled();
    });

    it('M-5: an invalid booking status leaves the unpaid requests untouched (the state machine answers)', async () => {
      const { service, tx } = build({ balance: 0, booking: { id: 77, status: 'completed', customer_id: 1 } });
      tx.service_deposits.count.mockResolvedValue(1);
      tx.service_deposits.findMany.mockResolvedValue([{ id: 3, payment_request_id: 9 }]);
      await expect(service.cancelWithDeposit(77, {})).resolves.toBeNull();
      expect(tx.payment_requests.updateMany).not.toHaveBeenCalled();
      expect(tx.service_deposits.updateMany).not.toHaveBeenCalled();
    });

    it('before the window the leftover is credited by default and the booking is closed in the same transaction', async () => {
      const { service, tx, deposits, coordinator } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1 } });
      await expect(service.cancelWithDeposit(77, {})).resolves.toEqual({ closed: true });
      expect(deposits.releaseInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ booking_id: 77, customer_id: 1, request_id: 'cancel:77' }),
      );
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(coordinator.releaseBooking).toHaveBeenCalledWith(tx, 1, 77, 'cancelled');
      expect(tx.bookings.update).toHaveBeenCalledWith({
        where: { id: 77 },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
    });

    it('leftover_action refund returns the money by the chosen method and announces it after commit', async () => {
      const { service, tx, deposits } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1 } });
      await service.cancelWithDeposit(77, { leftover_action: 'refund', refund_method: 'bank_transfer', request_id: 'c-1' });
      expect(deposits.refundInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ method: 'bank_transfer', request_id: 'c-1', booking_id: 77 }),
      );
      expect(deposits.announceRefunded).toHaveBeenCalledWith({ deposit_id: 4 });
    });

    it('inside the refund window (or with no window) the administrator decides: 409 STATION_BOOKING_004', async () => {
      const soon = build({
        booking: { id: 77, status: 'confirmed', customer_id: 1 },
        allocation: { id: 1, state: 'confirmed', start_at: new Date(Date.now() + 3_600_000), expires_at: null, station: station() },
      });
      await expect(soon.service.cancelWithDeposit(77, {})).rejects.toMatchObject(code('STATION_BOOKING_004'));
      expect(soon.deposits.releaseInTx).not.toHaveBeenCalled();

      const noWindow = build({
        booking: { id: 77, status: 'confirmed', customer_id: 1 },
        allocation: { id: 1, state: 'confirmed', start_at: new Date(Date.now() + 99 * 3_600_000), expires_at: null, station: station({ cancel_refund_hours: null }) },
      });
      await expect(noWindow.service.cancelWithDeposit(77, {})).rejects.toMatchObject(code('STATION_BOOKING_004'));
    });
  });

  describe('S14: caja al devolver dinero', () => {
    const confirmedBooking = { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' };

    it('refund del anticipo corre la compuerta de caja; sin sesión responde CASH_SESSION_REQUIRED_001 y no devuelve nada', async () => {
      const { service, deposits, sessions } = build({
        booking: confirmedBooking,
        gateError: new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
      });
      await expect(service.decide(77, { request_id: 'g-1', action: 'refund', refund_method: 'cash' })).rejects.toMatchObject(
        code('CASH_SESSION_REQUIRED_001'),
      );
      expect(sessions.assertSessionForSales).toHaveBeenCalledWith(9);
      expect(deposits.refundInTx).not.toHaveBeenCalled();
    });

    it('credit y retain no tocan la compuerta de caja', async () => {
      const credit = build({ booking: confirmedBooking });
      await credit.service.decide(77, { request_id: 'g-2', action: 'credit' });
      expect(credit.sessions.assertSessionForSales).not.toHaveBeenCalled();
      const retain = build({ booking: confirmedBooking });
      await retain.service.decide(77, { request_id: 'g-3', action: 'retain' });
      expect(retain.sessions.assertSessionForSales).not.toHaveBeenCalled();
    });
  });

  describe('S3: cancelar con cobro para reservar (cancelWithPrepay)', () => {
    const confirmedBooking = { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' };
    const paid = { orderId: 900, orderState: 'finished', receivedCents: 7500000, methodType: 'cash' };

    it('sin decisión responde 409 STATION_BOOKING_012 y no cancela nada', async () => {
      const { service, tx, deposits } = build({ booking: confirmedBooking, received: paid });
      await expect(service.cancelWithDeposit(77, {})).rejects.toMatchObject(code('STATION_BOOKING_012'));
      expect(tx.bookings.update).not.toHaveBeenCalled();
      expect(deposits.receiveInTx).not.toHaveBeenCalled();
    });

    it('ventana tardía solo admite retain: refund responde STATION_BOOKING_017', async () => {
      const { service } = build({
        booking: confirmedBooking,
        received: paid,
        allocation: { id: 1, state: 'confirmed', start_at: new Date(Date.now() + 3_600_000), expires_at: null, station: station() },
      });
      await expect(service.cancelWithDeposit(77, { leftover_action: 'refund' })).rejects.toMatchObject(code('STATION_BOOKING_017'));
    });

    it('ventana temprana no admite retain: STATION_BOOKING_017', async () => {
      const { service } = build({ booking: confirmedBooking, received: paid });
      await expect(service.cancelWithDeposit(77, { leftover_action: 'retain' })).rejects.toMatchObject(code('STATION_BOOKING_017'));
    });

    it('refund con caja obligatoria y sin sesión: CASH_SESSION_REQUIRED_001 antes de cancelar la orden', async () => {
      const { service, orderFlow } = build({
        booking: confirmedBooking,
        received: paid,
        gateError: new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001),
      });
      const cancelOrder = jest.fn();
      (orderFlow as any).cancelOrder = cancelOrder;
      await expect(service.cancelWithDeposit(77, { leftover_action: 'refund' })).rejects.toMatchObject(code('CASH_SESSION_REQUIRED_001'));
      expect(cancelOrder).not.toHaveBeenCalled();
    });

    it('refund cancela la orden (reversa de pagos) y cierra la reserva; el dinero no vuelve a entrar a caja', async () => {
      const { service, orderFlow, deposits, tx, prepay } = build({ booking: confirmedBooking, received: paid, balance: 0 });
      const cancelOrder = jest.fn().mockResolvedValue({});
      (orderFlow as any).cancelOrder = cancelOrder;
      const result = await service.cancelWithDeposit(77, { leftover_action: 'refund', request_id: 'c-9' });
      expect(cancelOrder).toHaveBeenCalledWith(900, expect.objectContaining({ reason: expect.any(String) }));
      expect(tx.bookings.update).toHaveBeenCalledWith({ where: { id: 77 }, data: expect.objectContaining({ status: 'cancelled' }) });
      expect(prepay.cancelOpenRequestsInTx).toHaveBeenCalled();
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(result).toMatchObject({ closed: true });
    });

    it('credit: la reversa de la orden saca el efectivo y receiveInTx lo vuelve a entrar con quien cancela (neto: una sola entrada de la venta original)', async () => {
      const { service, orderFlow, deposits, sessions } = build({ booking: confirmedBooking, received: paid });
      (orderFlow as any).cancelOrder = jest.fn().mockResolvedValue({});
      await service.cancelWithDeposit(77, { leftover_action: 'credit', request_id: 'c-10' });
      expect(deposits.receiveInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ booking_id: 77, user_id: 9, amount: 75000 }));
      expect(deposits.releaseInTx).toHaveBeenCalled();
      // Only the order cancel (the cash egress) passes the gate; the ledger move adds no second gate.
      expect(sessions.assertSessionForSales).toHaveBeenCalledTimes(1);
    });

    it('doble envío: con la orden ya cancelada no se vuelve a cancelar ni a pasar por la compuerta', async () => {
      const { service, orderFlow, sessions } = build({ booking: confirmedBooking, received: { ...paid, orderState: 'cancelled' }, balance: 0 });
      const cancelOrder = jest.fn();
      (orderFlow as any).cancelOrder = cancelOrder;
      await service.cancelWithDeposit(77, { leftover_action: 'refund', request_id: 'c-9' });
      expect(cancelOrder).not.toHaveBeenCalled();
      expect(sessions.assertSessionForSales).not.toHaveBeenCalled();
    });
  });

  describe('decide (S17)', () => {
    const base = { request_id: 'd-1' };

    it('refund returns the money, cancels the booking and announces the refund after commit', async () => {
      const { service, tx, deposits, emits } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await expect(service.decide(77, { ...base, action: 'refund', refund_method: 'cash' })).resolves.toEqual({ action: 'refund' });
      expect(deposits.refundInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ request_id: 'd-1', method: 'cash' }));
      expect(tx.bookings.update).toHaveBeenCalledWith({ where: { id: 77 }, data: expect.objectContaining({ status: 'cancelled' }) });
      expect(deposits.announceRefunded).toHaveBeenCalled();
      expect(emits.map((e) => e.name)).toContain('booking.cancelled');
    });

    it('the booking.cancelled and booking.no_show events carry what the notification listener prints', async () => {
      const booking = {
        id: 77,
        status: 'confirmed',
        customer_id: 1,
        booking_number: 'BKG-1',
        customer: { first_name: 'Ana', last_name: 'Pérez' },
        product: { name: 'Cava 3' },
        date: new Date('2026-11-20T00:00:00.000Z'),
        start_time: '14:00',
      };
      const expected = {
        store_id: 1,
        booking_id: 77,
        booking_number: 'BKG-1',
        customer_name: 'Ana Pérez',
        service_name: 'Cava 3',
        date: '2026-11-20',
        start_time: '14:00',
      };
      const refund = build({ booking });
      await refund.service.decide(77, { ...base, action: 'refund', refund_method: 'cash' });
      expect(refund.emits.find((e) => e.name === 'booking.cancelled')?.payload).toEqual(expected);

      const retain = build({ booking });
      await retain.service.decide(77, { ...base, action: 'retain' });
      expect(retain.emits.find((e) => e.name === 'booking.no_show')?.payload).toEqual(expected);

      const bare = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await bare.service.decide(77, { ...base, action: 'credit' });
      expect(bare.emits.find((e) => e.name === 'booking.cancelled')?.payload).toMatchObject({
        customer_name: 'Cliente',
        service_name: 'Servicio',
      });
    });

    it('H-1: the retained fee payment.received uses the sale share of the applied payment, not the order totals', async () => {
      const { service, deposits, emits } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      const applied = await deposits.applyToOrderInTx();
      applied.payment_received.payment.sale_share = { subtotal_amount: 336000, tax_amount: 64000, discount_amount: 0, tip_amount: 0 };
      deposits.applyToOrderInTx.mockResolvedValueOnce(applied);
      await service.decide(77, { ...base, action: 'retain' });
      expect(emits.find((e) => e.name === 'payment.received')?.payload).toMatchObject({ subtotal_amount: 336000, tax_amount: 64000 });
    });

    it('credit leaves the leftover as wallet credit and cancels the booking', async () => {
      const { service, tx, deposits } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await service.decide(77, { ...base, action: 'credit' });
      expect(deposits.releaseInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ request_id: 'd-1' }));
      expect(deposits.refundInTx).not.toHaveBeenCalled();
      expect(tx.bookings.update).toHaveBeenCalledWith({ where: { id: 77 }, data: expect.objectContaining({ status: 'cancelled' }) });
    });

    it('retain bills the deposit as the fixed "Gastos de reserva" line on a pos order, applies it and marks no_show', async () => {
      const { service, tx, deposits, emits, coordinator } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await expect(service.decide(77, { ...base, action: 'retain' })).resolves.toEqual({ action: 'retain' });
      expect(tx.orders.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'pos', customer_id: 1, order_number: 'RSV-77', store_id: 1 }),
        select: { id: true },
      });
      const line = tx.order_items.create.mock.calls[0][0].data;
      expect(line).toMatchObject({
        order_id: 900,
        product_id: null,
        product_name: 'Gastos de reserva',
        service_line_kind: 'reservation_fee',
        item_type: 'service',
        quantity: 1,
      });
      expect(Number(line.total_price)).toBe(400000);
      expect(deposits.applyToOrderInTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ order_id: 900, booking_id: 77, strict: true }),
      );
      expect(coordinator.releaseBooking).toHaveBeenCalledWith(tx, 1, 77, 'released');
      expect(tx.bookings.update).toHaveBeenCalledWith({ where: { id: 77 }, data: expect.objectContaining({ status: 'no_show', deposit_decision_due_at: null }) });
      const paid = emits.find((e) => e.name === 'payment.received');
      expect(paid?.payload).toMatchObject({ payment_id: 55, order_id: 900, amount: 400000, payment_method: 'wallet' });
      expect(emits.map((e) => e.name)).toContain('booking.no_show');
    });

    it('retain sends the paid fee order to the invoice emitter after commit', async () => {
      const { service, tx, orderFlow } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await service.decide(77, { ...base, action: 'retain' });
      expect(orderFlow.invoicePaidReservationFeeOrder).toHaveBeenCalledWith(900);
      expect(orderFlow.invoicePaidReservationFeeOrder.mock.invocationCallOrder[0])
        .toBeGreaterThan(tx.bookings.update.mock.invocationCallOrder[0]);
    });

    it('a failing invoice emitter does not undo the retained decision', async () => {
      const { service, orderFlow } = build({ booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      orderFlow.invoicePaidReservationFeeOrder.mockRejectedValueOnce(new Error('dian down'));
      await expect(service.decide(77, { ...base, action: 'retain' })).resolves.toEqual({ action: 'retain' });
    });

    it('retain uses the station tax category of the fee line (inclusive), none by default (A3)', async () => {
      const { service, taxes } = build({
        booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' },
        allocation: { id: 1, state: 'confirmed', start_at: new Date(), expires_at: null, station: station({ reservation_fee_tax_category_id: 12 }) },
      });
      await service.decide(77, { ...base, action: 'retain' });
      expect(taxes.taxRowsForCategory).toHaveBeenCalledWith(expect.anything(), { tax_category_id: 12, tax_is_inclusive: true, store_id: 1 });
    });

    it('without a deposit balance there is nothing to decide: STATION_BOOKING_005', async () => {
      const { service } = build({ balance: 0, booking: { id: 77, status: 'confirmed', customer_id: 1, booking_number: 'BKG-1' } });
      await expect(service.decide(77, { ...base, action: 'retain' })).rejects.toMatchObject(code('STATION_BOOKING_005'));
    });

    it('a booking that is already closed or in service no longer admits the decision: STATION_BOOKING_006', async () => {
      for (const status of ['cancelled', 'no_show', 'completed', 'in_progress']) {
        const { service, deposits } = build({ booking: { id: 77, status, customer_id: 1, booking_number: 'BKG-1' } });
        await expect(service.decide(77, { ...base, action: 'refund' })).rejects.toMatchObject(code('STATION_BOOKING_006'));
        expect(deposits.refundInTx).not.toHaveBeenCalled();
      }
    });

    it('retain needs an identified customer (the fee order is invoiced to someone)', async () => {
      const { service, deposits } = build({ booking: { id: 77, status: 'confirmed', customer_id: null, booking_number: 'BKG-1' } });
      await expect(service.decide(77, { ...base, action: 'retain' })).rejects.toMatchObject(code('STATION_BOOKING_008'));
      expect(deposits.applyToOrderInTx).not.toHaveBeenCalled();
    });
  });

  describe('summary (booking detail)', () => {
    it('shows required, received, balance, pending request and the decision deadline', async () => {
      const { service, tx, deposits } = build();
      deposits.balanceOf.mockResolvedValue({ received: 400000, balance: 400000 });
      const due = new Date('2099-01-01T00:00:00Z');
      await expect(service.summary(77, due)).resolves.toEqual({
        required: 400000,
        received: 400000,
        balance: 400000,
        pending_request: null,
        decision_due_at: due,
      });
      expect(tx.service_deposits.findMany).toHaveBeenCalled();
    });

    it('is null for a booking that never had a deposit on a free station', async () => {
      const { service, deposits } = build({
        allocation: { id: 1, state: 'confirmed', start_at: new Date(), expires_at: null, station: station({ deposit_policy: 'none', deposit_amount: null }) },
      });
      deposits.balanceOf.mockResolvedValue({ received: 0, balance: 0 });
      await expect(service.summary(77, null)).resolves.toBeNull();
    });

    it('exposes the pending payment request while the deposit is unpaid', async () => {
      const { service, tx, deposits } = build();
      deposits.balanceOf.mockResolvedValue({ received: 0, balance: 0 });
      const expires = new Date('2099-01-01T00:30:00Z');
      tx.service_deposits.findMany.mockResolvedValue([{ amount: 400000, payment_request_id: 9 }]);
      tx.payment_requests.findFirst.mockResolvedValue({ id: 9, status: 'pending', expires_at: expires });
      const block = await service.summary(77, null);
      expect(block?.pending_request).toEqual({ payment_request_id: 9, amount: 400000, status: 'pending', expires_at: expires });
      expect(block?.received).toBe(0);
    });
  });
});
