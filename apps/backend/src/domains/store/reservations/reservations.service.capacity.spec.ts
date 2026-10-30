/**
 * QUI-966 T3 (S5/S6) — ReservationsService.create capacity, in-transaction
 * overlap re-check, booking numbering and concurrency retries.
 * Fixture mirrors reservations.service.adversarial.spec.ts.
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
    { loadStoreHours: jest.fn().mockResolvedValue(new Map()) } as any,
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

describe('ReservationsService (QUI-966 S5/S6) — capacity and concurrency', () => {
  const base = {
    customer_id: 7,
    product_id: 10,
    date: FUTURE,
    start_time: '10:00',
    end_time: '11:00',
    skip_order_creation: true,
  };
  const freeProduct = {
    id: 10,
    name: 'Clase',
    requires_booking: true,
    service_duration_minutes: 60,
    booking_mode: 'free_booking',
    base_price: 20000,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
  };
  const p2002 = () =>
    Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: { constraint: { fields: ['store_id', 'booking_number'] } },
        },
      },
    });
  const seq = (i: number) => `BKG-20261105-${String(i).padStart(4, '0')}`;

  it('still creates a valid provider_required booking with the free provider', async () => {
    const { service, bookings } = buildService({ availableProviders: [{ id: 5 }] });
    await service.create({ ...base } as any);
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({ provider_id: 5, booking_number: seq(1) });
  });

  it('keeps the legacy fallback when the product has zero active providers', async () => {
    const { service, bookings, availabilityService } = buildService({
      providers: [{ provider_id: 5, provider: { id: 5, is_active: false } }],
      availableProviders: [],
    });
    await service.create({ ...base } as any);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].provider_id).toBeNull();
    expect(availabilityService.isSlotAvailable).not.toHaveBeenCalled();
  });

  it('in-transaction re-check allows an adjacent booking (end == start)', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ id: 50, status: 'confirmed', start_time: '11:00', end_time: '12:00' }));
    await service.create({ ...base, provider_id: 5 } as any);
    expect(bookings).toHaveLength(2);
  });

  it('in-transaction re-check ignores cancelled overlapping bookings', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ id: 50, status: 'cancelled', start_time: '10:30', end_time: '11:30' }));
    await service.create({ ...base, provider_id: 5 } as any);
    expect(bookings).toHaveLength(2);
  });

  it('free_booking: the 11th overlapping booking is rejected with 409 (capacity 10)', async () => {
    const { service, bookings, prisma } = buildService({ product: freeProduct });
    for (let i = 0; i < 10; i++) {
      bookings.push(
        booking({
          id: 200 + i,
          provider_id: null,
          booking_number: seq(i + 1),
          start_time: i % 2 ? '10:30' : '10:00',
          end_time: i % 2 ? '11:30' : '11:00',
        }),
      );
    }
    await expect(service.create({ ...base } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('free_booking: a 10th booking fits; cancelled and adjacent bookings do not count', async () => {
    const { service, bookings } = buildService({ product: freeProduct });
    for (let i = 0; i < 9; i++) {
      bookings.push(booking({ id: 200 + i, provider_id: null, booking_number: seq(i + 1) }));
    }
    bookings.push(booking({ id: 300, provider_id: null, status: 'cancelled', booking_number: seq(10) }));
    bookings.push(
      booking({ id: 301, provider_id: null, start_time: '11:00', end_time: '12:00', booking_number: seq(11) }),
    );
    await service.create({ ...base } as any);
    expect(bookings).toHaveLength(12);
    expect(bookings[11].booking_number).toBe(seq(12));
  });

  it('retries with a fresh booking_number when a concurrent insert took the same number (P2002)', async () => {
    const { service, bookings, prisma } = buildService();
    prisma.bookings.create.mockImplementationOnce(({ data }: any) => {
      // A concurrent request committed the same number first.
      bookings.push(
        booking({ id: 70, booking_number: data.booking_number, start_time: '15:00', end_time: '16:00' }),
      );
      return Promise.reject(p2002());
    });
    const pending = service.create({ ...base, provider_id: 5 } as any);
    await jest.runAllTimersAsync();
    await pending;
    expect(bookings.map((b) => b.booking_number)).toEqual([seq(1), seq(2)]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('a serialization failure caused by a concurrent overlapping booking ends in 409, not 500', async () => {
    const { service, bookings, prisma } = buildService();
    let first = true;
    prisma.$transaction.mockImplementation((fn: any) => {
      if (first) {
        first = false;
        // The racing booking commits; this tx aborts with 40001.
        bookings.push(booking({ id: 80, customer_id: 9, start_time: '10:30', end_time: '11:30' }));
        return Promise.reject(
          Object.assign(new Error('could not serialize access'), { code: 'P2034' }),
        );
      }
      return fn(prisma);
    });
    const pending = service.create({ ...base, provider_id: 5 } as any);
    const assertion = expect(pending).rejects.toBeInstanceOf(ConflictException);
    await jest.runAllTimersAsync();
    await assertion;
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('persistent serialization failures surface as 409', async () => {
    const { service, prisma } = buildService();
    prisma.$transaction.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('write conflict'), { code: 'P2034' })),
    );
    const pending = service.create({ ...base, provider_id: 5 } as any);
    const assertion = expect(pending).rejects.toBeInstanceOf(ConflictException);
    await jest.runAllTimersAsync();
    await assertion;
  });
});

