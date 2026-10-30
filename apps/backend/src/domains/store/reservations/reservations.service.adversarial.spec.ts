/**
 * Adversarial QA spec for ReservationsService.
 *
 * Every assertion states the CORRECT business behavior. A failing test is a
 * finding against the production code, not a flaky test.
 *
 * Process TZ is forced to UTC to mirror the backend container.
 */
// Run with `TZ=UTC` in the environment to mirror the backend container;
// assigning process.env.TZ here is too late for the jest worker.
process.env.TZ = 'UTC';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ReservationsService } from './reservations.service';

(RequestContextService.getContext as jest.Mock) = jest.fn().mockReturnValue({
  user_id: 1,
  store_id: 1,
  organization_id: 1,
});

type Row = Record<string, any>;

/** Minimal evaluator for the Prisma `where` shapes this service uses. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === undefined) return true;
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (cond !== null && typeof cond === 'object') {
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(value < cond.lt)) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      if ('lte' in cond && !(value <= cond.lte)) return false;
      if ('gte' in cond && !(value >= cond.gte)) return false;
      if ('startsWith' in cond && !String(value).startsWith(cond.startsWith))
        return false;
      return true;
    }
    return value === cond;
  });
}

function buildService(
  opts: {
    product?: Row;
    providers?: Row[];
    availableProviders?: Row[];
    isSlotAvailable?: boolean;
    settings?: Row | null;
  } = {},
) {
  const bookings: Row[] = [];
  const requests: Row[] = [];
  const product = opts.product ?? {
    id: 10,
    name: 'Corte',
    requires_booking: true,
    service_duration_minutes: 60,
    booking_mode: 'provider_required',
    base_price: 20000,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
  };

  const bookingsDelegate: any = {
    findFirst: jest.fn(({ where, orderBy }: any) => {
      let rows = bookings.filter((b) => matches(b, where));
      if (orderBy?.booking_number === 'desc') {
        rows = [...rows].sort((a, b) =>
          a.booking_number < b.booking_number ? 1 : -1,
        );
      }
      return Promise.resolve(rows[0] ?? null);
    }),
    findUnique: jest.fn(({ where }: any) =>
      Promise.resolve(bookings.find((b) => b.id === where.id) ?? null),
    ),
    findMany: jest.fn(({ where }: any) =>
      Promise.resolve(bookings.filter((b) => matches(b, where))),
    ),
    count: jest.fn(({ where }: any) =>
      Promise.resolve(bookings.filter((b) => matches(b, where)).length),
    ),
    create: jest.fn(({ data }: any) => {
      const row = {
        id: bookings.length + 100,
        customer: { first_name: 'Ana', last_name: 'Ruiz' },
        product: { name: 'Corte' },
        ...data,
      };
      bookings.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }: any) => {
      const target = bookings.find((b) => b.id === where.id);
      if (!target) throw new Error('not found');
      Object.assign(target, data);
      return Promise.resolve(target);
    }),
    delete: jest.fn(),
  };

  const prisma: any = {
    bookings: bookingsDelegate,
    products: { findFirst: jest.fn().mockResolvedValue(product) },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    provider_services: {
      findFirst: jest.fn().mockResolvedValue({
        provider_id: 5,
        provider: { id: 5, is_active: true },
      }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          opts.providers ?? [{ provider_id: 5, provider: { id: 5, is_active: true } }],
        ),
    },
    store_settings: {
      findUnique: jest.fn().mockResolvedValue(opts.settings ?? null),
      // resolveStoreTimezone (canonical reader) uses findFirst.
      findFirst: jest.fn().mockResolvedValue(null),
    },
    booking_reschedule_requests: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(requests.find((r) => matches(r, where)) ?? null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(requests.find((r) => r.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const row = { id: requests.length + 1, ...data };
        requests.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const target = requests.find((r) => r.id === where.id);
        Object.assign(target, data);
        return Promise.resolve(target);
      }),
    },
    tables: {
      updateMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 3 }),
    },
    orders: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 900 }),
    },
    // Scoped delegates: a row means "belongs to the current store".
    store_users: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    addresses: { findFirst: jest.fn().mockResolvedValue({ id: 4 }) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));

  const availabilityService: any = {
    getAvailableProvidersForSlot: jest
      .fn()
      .mockResolvedValue(opts.availableProviders ?? [{ id: 5 }]),
    isSlotAvailable: jest.fn().mockResolvedValue(opts.isSlotAvailable ?? true),
    validateNoOverlapForCustomer: jest.fn().mockResolvedValue(undefined),
  };
  const ordersService: any = {
    create: jest.fn().mockResolvedValue({ id: 900 }),
    update: jest.fn().mockResolvedValue({}),
  };
  const emits: Array<{ name: string; payload: any }> = [];
  const eventEmitter: any = {
    emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })),
  };
  const s3Service: any = { signUrl: jest.fn((u: string) => Promise.resolve(u)) };
  const priceResolverService: any = {
    resolvePrice: jest.fn().mockReturnValue({ unitPrice: 20000 }),
  };
  const service = new ReservationsService(
    prisma,
    availabilityService,
    ordersService,
    s3Service,
    eventEmitter,
    priceResolverService,
    {} as any,
    {} as any,
    { record: jest.fn() } as any,
    // QUI-966 T2: store hours for the S4 gate (empty = not configured).
    { loadStoreWindows: jest.fn().mockResolvedValue(new Map()) } as any,
  );
  return {
    service,
    prisma,
    bookings,
    requests,
    availabilityService,
    ordersService,
    emits,
  };
}

function booking(overrides: Row = {}): Row {
  return {
    id: 1,
    store_id: 1,
    customer_id: 7,
    product_id: 10,
    provider_id: 5,
    booking_number: 'BKG-20261105-0001',
    date: new Date('2026-11-05T00:00:00.000Z'),
    start_time: '10:00',
    end_time: '11:00',
    status: 'pending',
    customer: { first_name: 'Ana', last_name: 'Ruiz' },
    product: { name: 'Corte' },
    ...overrides,
  };
}

const FUTURE = '2026-11-05';

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  // 2026-10-29 10:00 America/Bogota
  jest.setSystemTime(new Date('2026-10-29T15:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

describe('ReservationsService (adversarial) — state machine', () => {
  it.each([
    ['completed', 'cancel'],
    ['no_show', 'cancel'],
    ['cancelled', 'confirm'],
    ['confirmed', 'confirm'],
    ['completed', 'start'],
    ['cancelled', 'noShow'],
  ])('rejects %s → %s', async (status, method) => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status }));
    await expect((service as any)[method](1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bookings[0].status).toBe(status);
  });

  it('rejects check-in of a cancelled booking', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'cancelled' }));
    await expect(service.checkIn(1, 'staff')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects reschedule of a no_show booking', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'no_show' }));
    await expect(
      service.reschedule(1, { date: FUTURE, start_time: '12:00', end_time: '13:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('archiveToNoShow archives an overdue PENDING booking (documented pending → no_show)', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'pending', date: new Date('2026-10-27T00:00:00Z') }));
    await expect(service.archiveToNoShow(1)).resolves.toBeUndefined();
    expect(bookings[0].status).toBe('no_show');
  });

  it('rejects check-in for a booking scheduled on a future day', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'confirmed', date: new Date('2026-11-05T00:00:00Z') }));
    await expect(service.checkIn(1, 'customer')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ReservationsService (adversarial) — create', () => {
  it('rejects a provider_required booking when every provider is busy for the slot', async () => {
    const { service, prisma } = buildService({
      availableProviders: [],
      isSlotAvailable: false,
    });
    await expect(
      service.create({
        customer_id: 7,
        product_id: 10,
        date: FUTURE,
        start_time: '10:00',
        end_time: '11:00',
        skip_order_creation: true,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it.each([
    ['inverted', '11:00', '10:00'],
    ['zero duration', '10:00', '10:00'],
    ['crossing midnight', '23:30', '00:30'],
  ])('rejects a %s time range', async (_label, start_time, end_time) => {
    const { service, prisma } = buildService();
    await expect(
      service.create({
        customer_id: 7,
        product_id: 10,
        date: FUTURE,
        start_time,
        end_time,
        skip_order_creation: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('rejects a booking on a past date', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.create({
        customer_id: 7,
        product_id: 10,
        date: '2026-10-01',
        start_time: '10:00',
        end_time: '11:00',
        skip_order_creation: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('in-transaction re-check rejects an OVERLAPPING (not identical) provider booking committed concurrently', async () => {
    // Pre-check passed (race), but by the time the tx runs another booking
    // 10:30-11:30 for the same provider exists.
    const { service, bookings, prisma } = buildService();
    bookings.push(
      booking({ id: 50, status: 'confirmed', start_time: '10:30', end_time: '11:30' }),
    );
    await expect(
      service.create({
        customer_id: 8,
        product_id: 10,
        provider_id: 5,
        date: FUTURE,
        start_time: '10:00',
        end_time: '11:00',
        skip_order_creation: true,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  // QUI-966 L2/S4: `date` is a civil `YYYY-MM-DD` only; an ISO datetime with
  // offset is rejected instead of being silently re-interpreted.
  it('rejects an ISO datetime with offset as the booking date (400)', async () => {
    const { service, bookings } = buildService();
    await expect(
      service.create({
        customer_id: 7,
        product_id: 10,
        provider_id: 5,
        date: '2026-11-05T20:00:00-05:00',
        start_time: '20:00',
        end_time: '21:00',
        skip_order_creation: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings).toHaveLength(0);
  });

  it('never generates a duplicate booking_number after sequence 9999', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ id: 60, booking_number: 'BKG-20261105-9999', status: 'cancelled' }));
    bookings.push(booking({ id: 61, booking_number: 'BKG-20261105-10000', status: 'cancelled' }));
    await service.create({
      customer_id: 7,
      product_id: 10,
      provider_id: 5,
      date: FUTURE,
      start_time: '15:00',
      end_time: '16:00',
      skip_order_creation: true,
    } as any);
    const numbers = bookings.map((b) => b.booking_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('ReservationsService (adversarial) — reschedule', () => {
  it('rejects rescheduling into an occupied slot (availability excludes only itself)', async () => {
    const { service, bookings, availabilityService } = buildService({ isSlotAvailable: false });
    bookings.push(booking({ status: 'confirmed' }));
    await expect(
      service.reschedule(1, { date: FUTURE, start_time: '12:00', end_time: '13:00' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10, FUTURE, '12:00', '13:00', 5, 1,
    );
    expect(bookings[0].start_time).toBe('10:00');
  });

  it('rejects rescheduling into the past', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'confirmed' }));
    await expect(
      service.reschedule(1, { date: '2026-10-01', start_time: '12:00', end_time: '13:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].date.toISOString().slice(0, 10)).toBe(FUTURE);
  });

  it('approving a reschedule request does not move a booking that was cancelled meanwhile', async () => {
    const { service, bookings, requests } = buildService();
    bookings.push(booking({ status: 'cancelled' }));
    requests.push({
      id: 1,
      store_id: 1,
      booking_id: 1,
      status: 'pending',
      requested_date: new Date('2026-11-06T00:00:00Z'),
      requested_start_time: '12:00',
      requested_end_time: '13:00',
    });
    await expect(
      service.approveRescheduleRequest(1, { decidedByUserId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].start_time).toBe('10:00');
  });
});

describe('ReservationsService (adversarial) — store-day boundaries', () => {
  it('getToday at 20:00 Bogota (01:00Z next day) queries the Bogota calendar day', async () => {
    const { service, prisma } = buildService();
    jest.setSystemTime(new Date('2026-10-30T01:00:00.000Z'));
    await service.getToday();
    const where = prisma.bookings.findMany.mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe('2026-10-29T00:00:00.000Z');
  });

  it('getToday at 10:00 Bogota keeps the same civil day (regression)', async () => {
    const { service, prisma } = buildService();
    await service.getToday();
    const where = prisma.bookings.findMany.mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(where.date.lt.toISOString()).toBe('2026-10-30T00:00:00.000Z');
  });

  it('getStats today_count at 20:00 Bogota counts the Bogota day, not tomorrow', async () => {
    const { service, bookings } = buildService();
    jest.setSystemTime(new Date('2026-10-30T01:00:00.000Z'));
    bookings.push(booking({ id: 1, date: new Date('2026-10-29T00:00:00.000Z') }));
    bookings.push(booking({ id: 2, date: new Date('2026-10-30T00:00:00.000Z') }));
    const stats = await service.getStats();
    expect(stats.today_count).toBe(1);
  });
});

describe('ReservationsService (adversarial) — job-only archival (QUI-966 S11)', () => {
  it('manual noShow still rejects a PENDING booking (T4 state machine kept)', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'pending', date: new Date('2026-10-27T00:00:00Z') }));
    await expect(service.noShow(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].status).toBe('pending');
  });

  it('archiveToNoShow does not reopen a closed booking', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'cancelled', date: new Date('2026-10-27T00:00:00Z') }));
    await expect(service.archiveToNoShow(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].status).toBe('cancelled');
  });

  it('archiveExpiredHold closes an expired hold as cancelled', async () => {
    const { service, bookings } = buildService();
    bookings.push(
      booking({
        status: 'pending',
        date: new Date('2026-10-27T00:00:00Z'),
        expires_at: new Date('2026-10-26T15:15:00Z'),
      }),
    );
    await service.archiveExpiredHold(1);
    expect(bookings[0].status).toBe('cancelled');
  });
});

describe('ReservationsService (QUI-966 S3) — references from another store', () => {
  const base = {
    product_id: 10,
    date: FUTURE,
    start_time: '10:00',
    end_time: '11:00',
  };

  it('rejects a customer_id that is not a customer of the current store', async () => {
    const { service, prisma, bookings } = buildService();
    prisma.store_users.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...base, customer_id: 1 } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(bookings).toHaveLength(0);
  });

  it('rejects an order_id of another store', async () => {
    const { service, prisma, bookings } = buildService();
    prisma.orders.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...base, order_id: 1 } as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(bookings).toHaveLength(0);
  });

  it('rejects a table_id of another store', async () => {
    const { service, prisma, bookings } = buildService();
    prisma.tables.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ ...base, table_id: 1 } as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(bookings).toHaveLength(0);
  });

  it('rejects a home-service address that is not the customer own address', async () => {
    const { service, prisma, bookings } = buildService();
    prisma.addresses.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        ...base,
        customer_id: 7,
        service_location_type: 'home',
        service_address_id: 99,
      } as any),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.addresses.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99, user_id: 7 } }),
    );
    expect(bookings).toHaveLength(0);
  });

  it('still creates a booking whose references all belong to the store', async () => {
    const { service, bookings } = buildService();
    await service.create({ ...base, customer_id: 7, order_id: 900 } as any);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ customer_id: 7, order_id: 900 });
  });
});
