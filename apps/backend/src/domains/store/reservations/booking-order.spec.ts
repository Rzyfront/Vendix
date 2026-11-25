import { ReservationsService } from './reservations.service';

/**
 * QUI-1063 — the order of a service booking: born with its real pending
 * balance and cancelled with the booking when no money or other booking is
 * on it. Booking 12 → order 300 ($119.000).
 */
function build(
  options: {
    orderState?: string;
    payments?: Array<{ amount: number; state: string }>;
    sharedWith?: number;
    sessionId?: number | null;
    paymentForm?: string | null;
    remaining?: number;
  } = {},
) {
  const order = {
    id: 300,
    state: options.orderState ?? 'created',
    grand_total: 119000,
    remaining_balance: options.remaining ?? 0,
    payment_form: options.paymentForm ?? null,
    service_session_id: options.sessionId ?? null,
    payments: options.payments ?? [],
  };
  let bookingStatus = 'confirmed';
  const prisma = {
    bookings: {
      findFirst: jest.fn(async () => ({ order_id: 300, status: bookingStatus })),
      count: jest.fn(async () => options.sharedWith ?? 0),
    },
    orders: {
      findFirst: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
  };
  const ordersService = { update: jest.fn(async () => ({})) };
  const eventEmitter = { emit: jest.fn() };
  const service = new ReservationsService(
    prisma as any,
    {} as any,
    ordersService as any,
    {} as any,
    eventEmitter as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const booking = {
    id: 12,
    store_id: 3,
    booking_number: 'RSV-12',
    date: new Date('2026-11-30T00:00:00Z'),
    start_time: '10:00',
    customer: { first_name: 'Ana', last_name: 'Ruiz' },
    product: { name: 'Masaje' },
  };
  jest.spyOn(service as any, 'transition').mockImplementation(async (_id: unknown, to: unknown) => {
    bookingStatus = to as string;
    return { ...booking, status: to };
  });
  return { service, prisma, ordersService, order };
}

describe('Service booking order (QUI-1063)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('cancelled / no-show booking', () => {
    it('cancelling an unpaid booking cancels its order: it stays in Orders as "Cancelada"', async () => {
      const { service, ordersService } = build();

      await service.cancel(12);

      expect(ordersService.update).toHaveBeenCalledWith(300, { state: 'cancelled' });
    });

    it('a no-show (desk or job) cancels its unpaid order too', async () => {
      const desk = build();
      await desk.service.noShow(12);
      expect(desk.ordersService.update).toHaveBeenCalledWith(300, { state: 'cancelled' });

      const job = build();
      await job.service.archiveToNoShow(12);
      expect(job.ordersService.update).toHaveBeenCalledWith(300, { state: 'cancelled' });
    });

    it('an order with money paid, or a payment pending on a gateway, is left for the desk (no double charge, no lost money)', async () => {
      for (const payments of [[{ amount: 50000, state: 'succeeded' }], [{ amount: 119000, state: 'pending' }]]) {
        const { service, ordersService } = build({ payments });
        await service.cancel(12);
        expect(ordersService.update).not.toHaveBeenCalled();
      }
    });

    it('an order shared with another live booking, or already closed, stays as it is', async () => {
      for (const options of [{ sharedWith: 1 }, { orderState: 'finished' }, { sessionId: 8 }]) {
        const { service, ordersService } = build(options);
        await service.cancel(12);
        expect(ordersService.update).not.toHaveBeenCalled();
      }
    });

    it('a failing order cancellation never fails the booking cancellation', async () => {
      const { service, ordersService } = build();
      ordersService.update.mockRejectedValueOnce(new Error('transition refused'));

      await expect(service.cancel(12)).resolves.toMatchObject({ status: 'cancelled' });
    });
  });

  describe('pending balance of the booking order', () => {
    it('an order born for the booking owes its total (not $0 "settled")', async () => {
      const { service, prisma, order } = build({ remaining: 0 });

      await (service as any).openBookingOrderBalance(300);

      expect(prisma.orders.update).toHaveBeenCalledTimes(1);
      expect(Number(order.remaining_balance)).toBe(119000);
    });

    it('what was already paid is discounted from the balance', async () => {
      const { service, order } = build({ payments: [{ amount: 19000, state: 'succeeded' }] });

      await (service as any).openBookingOrderBalance(300);

      expect(Number(order.remaining_balance)).toBe(100000);
    });

    it('a credit order (payment form 2) and a closed order keep their balance', async () => {
      for (const options of [{ paymentForm: '2' }, { orderState: 'finished' }]) {
        const { service, prisma } = build(options);
        expect(await (service as any).openBookingOrderBalance(300)).toBe(false);
        expect(prisma.orders.update).not.toHaveBeenCalled();
      }
    });
  });
});
