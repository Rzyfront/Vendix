import { BookingProximityJob } from './booking-proximity.job';

describe('BookingProximityJob', () => {
  function buildJob(opts: {
    stores?: any[];
    bookings?: any[];
    existingProximityRows?: any[];
  } = {}) {
    const stores = opts.stores ?? [];
    const bookings = opts.bookings ?? [];
    const existingProximityRows = opts.existingProximityRows ?? [];

    const prisma = {
      stores: {
        findMany: jest.fn().mockResolvedValue(stores),
      },
      bookings: {
        findMany: jest.fn().mockResolvedValue(bookings),
      },
      proximity_notification_log: {
        findFirst: jest.fn().mockResolvedValue(existingProximityRows[0] ?? null),
        create: jest.fn().mockResolvedValue({}),
      },
    } as any;

    const eventEmitter = {
      emit: jest.fn(),
    } as any;

    const job = new BookingProximityJob(prisma, eventEmitter);
    return { job, prisma, eventEmitter };
  }

  function makeStore(id: number, settings: any = {}) {
    return {
      id,
      is_active: true,
      store_settings: { settings },
    };
  }

  function makeBooking(
    id: number,
    start_time: string,
    overrides: Partial<any> = {},
  ) {
    return {
      id,
      booking_number: `BKG-${id}`,
      store_id: 1,
      customer_id: 100,
      product_id: 1,
      provider_id: 1,
      status: 'confirmed',
      date: new Date(),
      start_time,
      end_time: '11:00',
      customer: {
        first_name: 'Juan',
        last_name: 'Pérez',
        email: 'juan@test.com',
        phone: '+573001234567',
      },
      product: { name: 'Corte' },
      ...overrides,
    };
  }

  it('uses the default proximity windows [30,15,5] when store has no override', async () => {
    const { job, eventEmitter } = buildJob({
      stores: [makeStore(1, {})],
      bookings: [],
    });
    await job.handleBookingProximity();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('skips cancelled bookings', async () => {
    const store = makeStore(1, { appointments: { proximity_minutes: [5] } });
    const now = new Date();
    const isoNow = now.toISOString().slice(0, 10);
    const booking = makeBooking(1, '08:00', {
      status: 'cancelled',
      date: new Date(`${isoNow}T00:00:00Z`),
    });
    const { job, eventEmitter } = buildJob({
      stores: [store],
      bookings: [booking],
    });
    await job.handleBookingProximity();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('emits appointment.upcoming once and writes a dedup row', async () => {
    // Pick a booking that falls inside the T-5 window.
    const now = new Date();
    const start = new Date(now.getTime() + 5 * 60_000);
    const hh = String(start.getUTCHours()).padStart(2, '0');
    const mm = String(start.getUTCMinutes()).padStart(2, '0');

    const store = makeStore(1, { appointments: { proximity_minutes: [5] } });
    const isoDay = now.toISOString().slice(0, 10);
    const booking = makeBooking(1, `${hh}:${mm}`, {
      date: new Date(`${isoDay}T00:00:00Z`),
    });
    const { job, eventEmitter, prisma } = buildJob({
      stores: [store],
      bookings: [booking],
      existingProximityRows: [], // not yet sent
    });

    await job.handleBookingProximity();

    expect(prisma.proximity_notification_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        booking_id: 1,
        proximity_minutes: 5,
        channel: 'in_app',
      }),
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'appointment.upcoming',
      expect.objectContaining({
        booking_id: 1,
        proximity_minutes: 5,
      }),
    );
  });

  it('does NOT re-emit when the proximity row already exists', async () => {
    const now = new Date();
    const start = new Date(now.getTime() + 5 * 60_000);
    const hh = String(start.getUTCHours()).padStart(2, '0');
    const mm = String(start.getUTCMinutes()).padStart(2, '0');
    const isoDay = now.toISOString().slice(0, 10);

    const store = makeStore(1, { appointments: { proximity_minutes: [5] } });
    const booking = makeBooking(1, `${hh}:${mm}`, {
      date: new Date(`${isoDay}T00:00:00Z`),
    });
    const { job, eventEmitter, prisma } = buildJob({
      stores: [store],
      bookings: [booking],
      existingProximityRows: [{ id: 999 }], // already sent
    });

    await job.handleBookingProximity();

    expect(prisma.proximity_notification_log.create).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});