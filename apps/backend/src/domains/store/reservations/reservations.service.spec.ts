import { ReservationsService } from './reservations.service';
import { BadRequestException } from '@nestjs/common';

/**
 * Smoke tests covering the appointment-design state-machine additions:
 * markArriving / markAttending + the checkIn re-write.
 *
 * Mocks the StorePrismaService and EventEmitter2 by hand so we exercise
 * the public service API without touching the DB.
 */
describe('ReservationsService — state machine (appointments redesign)', () => {
  function buildService() {
    const bookings: any[] = [];
    const prisma: any = {
      bookings: {
        findUnique: jest.fn(({ where, include }: any) =>
          Promise.resolve(
            bookings.find((b) => b.id === where.id) ?? null,
          ),
        ),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(({ where, data }: any) => {
          const target = bookings.find((b) => b.id === where.id);
          if (!target) throw new Error('not found');
          Object.assign(target, data);
          return Promise.resolve(target);
        }),
        create: jest.fn(),
      },
    };
    const emits: any[] = [];
    const eventEmitter: any = {
      emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })),
    };
    const availabilityService = {} as any;
    const ordersService = {} as any;
    const s3Service = { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any;
    const priceResolverService = {} as any;
    const tablesService = {} as any;
    const tableSessionsService = {} as any;

    const service = new ReservationsService(
      prisma,
      availabilityService,
      ordersService,
      s3Service,
      eventEmitter,
      priceResolverService,
      tablesService,
      tableSessionsService,
    );

    return { service, prisma, bookings, eventEmitter, emits };
  }

  it('markArriving only allows confirmed → arriving', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'confirmed' });
    await service.markArriving(1);
    expect(bookings[0].status).toBe('arriving');
  });

  it('markArriving rejects pending → arriving (must pass through confirmed first)', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'pending' });
    await expect(service.markArriving(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markAttending only allows arriving → attending', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'arriving' });
    await service.markAttending(1);
    expect(bookings[0].status).toBe('attending');
  });

  it('markAttending rejects confirmed → attending (must go through arriving)', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'confirmed' });
    await expect(service.markAttending(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('checkIn from confirmed writes arrival_at, trans to arriving, and emits both events', async () => {
    const { service, bookings, emits } = buildService();
    bookings.push({
      id: 1,
      status: 'confirmed',
      booking_number: 'BKG-1',
      customer: { first_name: 'Juan', last_name: 'Pérez' },
      product: { name: 'Corte' },
      provider: { id: 7 },
      date: new Date('2026-07-18T00:00:00Z'),
    });
    const result = await service.checkIn(1, 'customer');
    expect(result.arrival_at).toBeInstanceOf(Date);
    expect(result.status).toBe('arriving');
    expect(emits.map((e) => e.name).sort()).toEqual([
      'booking.arrival_recorded',
      'booking.checked_in',
    ]);
  });

  it('checkIn from arriving is idempotent (does not re-emit arrival_recorded)', async () => {
    const { service, bookings, emits } = buildService();
    const prevArrival = new Date();
    bookings.push({
      id: 1,
      status: 'arriving',
      booking_number: 'BKG-1',
      arrival_at: prevArrival,
      checked_in_at: prevArrival,
      customer: { first_name: 'A', last_name: 'B' },
      product: { name: 'S' },
      date: new Date('2026-07-18T00:00:00Z'),
    });
    await service.checkIn(1, 'customer');
    // arrival_recorded must NOT be re-emitted on idempotent calls.
    expect(emits.find((e) => e.name === 'booking.arrival_recorded')).toBeUndefined();
  });

  it('checkIn rejects when status is pending', async () => {
    const { service, bookings } = buildService();
    bookings.push({ id: 1, status: 'pending', customer: {}, product: {}, date: new Date() });
    await expect(service.checkIn(1, 'staff')).rejects.toBeInstanceOf(BadRequestException);
  });
});