/**
 * QUI-966 T4 — booking lifecycle and its order (S7, S8, S13, S14) plus the
 * T3 advisories A–D. Run with `TZ=UTC` to mirror the backend container.
 */
process.env.TZ = 'UTC';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { isSerializationFailure } from '@common/utils/sequence-number.util';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
import { BookingConfirmationService } from './booking-confirmation.service';

(RequestContextService.getContext as jest.Mock) = jest.fn().mockReturnValue({
  user_id: 1,
  store_id: 1,
  organization_id: 1,
});

type Row = Record<string, any>;

/** Evaluator for the Prisma `where` shapes used here (incl. `OR`). */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond === undefined) return true;
    if (cond === null) return value == null;
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (typeof cond === 'object') {
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      const cmp = (v: any) => (v instanceof Date ? v.getTime() : v);
      if ('lt' in cond && !(value != null && cmp(value) < cmp(cond.lt))) return false;
      if ('gt' in cond && !(value != null && cmp(value) > cmp(cond.gt))) return false;
      if ('gte' in cond && !(value != null && cmp(value) >= cmp(cond.gte))) return false;
      if ('lte' in cond && !(value != null && cmp(value) <= cmp(cond.lte))) return false;
      if ('startsWith' in cond && !String(value).startsWith(cond.startsWith))
        return false;
      return true;
    }
    return value === cond;
  });
}

// 2026-10-29 10:00 America/Bogota
const NOW = new Date('2026-10-29T15:00:00.000Z');
const TODAY = '2026-10-29';
const FUTURE = '2026-11-05';

function buildService(opts: { product?: Row; isSlotAvailable?: boolean } = {}) {
  const bookings: Row[] = [];
  const requests: Row[] = [];
  const orders: Row[] = [];
  const payments: Row[] = [];
  const product = opts.product ?? {
    id: 10,
    name: 'Corte',
    requires_booking: true,
    booking_mode: 'free_booking',
    base_price: 20000,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
  };

  const prisma: any = {
    bookings: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(bookings.find((b) => matches(b, where)) ?? null),
      ),
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
        const row = { id: bookings.length + 100, product: { name: 'Corte' }, ...data };
        bookings.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const target = bookings.find((b) => b.id === where.id);
        if (!target) throw new Error('not found');
        Object.assign(target, data);
        return Promise.resolve(target);
      }),
      delete: jest.fn(({ where }: any) => {
        const i = bookings.findIndex((b) => b.id === where.id);
        bookings.splice(i, 1);
        return Promise.resolve({});
      }),
    },
    products: { findFirst: jest.fn().mockResolvedValue(product) },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    provider_services: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    store_settings: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    booking_reschedule_requests: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(requests.find((r) => matches(r, where)) ?? null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(requests.find((r) => r.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const target = requests.find((r) => r.id === where.id);
        Object.assign(target, data);
        return Promise.resolve(target);
      }),
    },
    orders: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(orders.find((o) => o.id === where.id) ?? null),
      ),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payments: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(payments.find((p) => matches(p, where)) ?? null),
      ),
    },
    store_users: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));

  const availabilityService: any = {
    isSlotAvailable: jest.fn().mockResolvedValue(opts.isSlotAvailable ?? true),
    getAvailableProvidersForSlot: jest.fn().mockResolvedValue([]),
    validateNoOverlapForCustomer: jest.fn().mockResolvedValue(undefined),
  };
  const ordersService: any = {
    create: jest.fn().mockResolvedValue({ id: 900 }),
    update: jest.fn((id: number, dto: any) => {
      const order = orders.find((o) => o.id === id);
      if (order && dto.state) order.state = dto.state;
      return Promise.resolve(order ?? {});
    }),
  };
  const emits: Array<{ name: string; payload: any }> = [];
  const eventEmitter: any = {
    emit: jest.fn((name: string, payload: any) => emits.push({ name, payload })),
  };
  const priceResolverService: any = {
    resolvePrice: jest.fn().mockReturnValue({ unitPrice: 20000 }),
  };
  const service = new ReservationsService(
    prisma,
    availabilityService,
    ordersService,
    { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
    eventEmitter,
    priceResolverService,
    {} as any,
    {} as any,
    { record: jest.fn() } as any,
    { loadStoreHours: jest.fn().mockResolvedValue(new Map()) } as any,
  );
  return {
    service,
    prisma,
    bookings,
    requests,
    orders,
    payments,
    availabilityService,
    ordersService,
    priceResolverService,
    emits,
  };
}

function booking(overrides: Row = {}): Row {
  return {
    id: 1,
    store_id: 1,
    customer_id: 7,
    product_id: 10,
    product_variant_id: null,
    provider_id: null,
    order_id: null,
    booking_number: 'BKG-20261105-0001',
    date: new Date(`${FUTURE}T00:00:00.000Z`),
    start_time: '10:00',
    end_time: '11:00',
    status: 'confirmed',
    channel: 'ecommerce',
    expires_at: null,
    customer: { first_name: 'Ana', last_name: 'Ruiz' },
    product: { name: 'Corte' },
    ...overrides,
  };
}

function order(overrides: Row = {}): Row {
  return {
    id: 900,
    state: 'created',
    order_number: 'ORD-900',
    order_items: [{ product_id: 10 }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(NOW);
});
afterEach(() => jest.useRealTimers());

describe('S7 — cancelling a booking releases its order', () => {
  it('cancels an unpaid order that belongs only to the booking', async () => {
    const { service, bookings, orders, ordersService } = buildService();
    bookings.push(booking({ order_id: 900 }));
    orders.push(order());
    const result = await service.cancel(1);
    expect(result.status).toBe('cancelled');
    expect(ordersService.update).toHaveBeenCalledWith(
      900,
      expect.objectContaining({ state: 'cancelled' }),
    );
    expect(orders[0].state).toBe('cancelled');
    expect(result).toMatchObject({
      order_cancelled: true,
      order_requires_refund: false,
      order_warning: null,
    });
  });

  it('leaves a paid order untouched and warns staff to handle the refund', async () => {
    const { service, bookings, orders, payments, ordersService } = buildService();
    bookings.push(booking({ order_id: 900 }));
    orders.push(order({ state: 'processing' }));
    payments.push({ id: 1, order_id: 900, state: 'succeeded' });
    const result = await service.cancel(1);
    expect(result.status).toBe('cancelled');
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(orders[0].state).toBe('processing');
    expect(result.order_cancelled).toBe(false);
    expect(result.order_requires_refund).toBe(true);
    expect(result.order_warning).toMatch(/devolución/);
  });

  it('does not cancel an order with other products; warns instead', async () => {
    const { service, bookings, orders, ordersService } = buildService();
    bookings.push(booking({ order_id: 900 }));
    orders.push(order({ order_items: [{ product_id: 10 }, { product_id: 55 }] }));
    const result = await service.cancel(1);
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(result.order_cancelled).toBe(false);
    expect(result.order_requires_refund).toBe(false);
    expect(result.order_warning).toMatch(/otros productos o reservas/);
  });

  it('does not cancel an order still holding another live booking', async () => {
    const { service, bookings, orders, ordersService } = buildService();
    bookings.push(booking({ order_id: 900 }));
    bookings.push(booking({ id: 2, order_id: 900, start_time: '12:00', end_time: '13:00' }));
    orders.push(order({ order_items: [{ product_id: 10 }, { product_id: 10 }] }));
    const result = await service.cancel(1);
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(result.order_warning).toMatch(/otros productos o reservas/);
  });

  it('regression: a booking without order still cancels and emits booking.cancelled', async () => {
    const { service, bookings, emits, ordersService } = buildService();
    bookings.push(booking());
    const result = await service.cancel(1);
    expect(result.status).toBe('cancelled');
    expect(emits.map((e) => e.name)).toContain('booking.cancelled');
    expect(ordersService.update).not.toHaveBeenCalled();
    expect(result.order_warning).toBeNull();
  });

  it('DELETE of a pending booking also cancels its unpaid order', async () => {
    const { service, bookings, orders } = buildService();
    bookings.push(booking({ status: 'pending', order_id: 900 }));
    orders.push(order());
    const result = await service.remove(1);
    expect(bookings).toHaveLength(0);
    expect(orders[0].state).toBe('cancelled');
    expect(result.order_cancelled).toBe(true);
  });

  it('DELETE still rejects a non-pending booking', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ status: 'confirmed' }));
    await expect(service.remove(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings).toHaveLength(1);
  });
});

describe('S8 — no-show and check-in timing (store timezone)', () => {
  it('rejects no-show before the appointment started', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ date: new Date(`${TODAY}T00:00:00.000Z`), start_time: '11:00', end_time: '12:00' }));
    await expect(service.noShow(1)).rejects.toThrow(
      'No se puede marcar no-show antes de la hora de la cita',
    );
    expect(bookings[0].status).toBe('confirmed');
  });

  it('allows no-show once the appointment started', async () => {
    const { service, bookings, emits } = buildService();
    bookings.push(booking({ date: new Date(`${TODAY}T00:00:00.000Z`), start_time: '09:00', end_time: '10:30' }));
    const result = await service.noShow(1);
    expect(result.status).toBe('no_show');
    expect(emits.map((e) => e.name)).toContain('booking.no_show');
  });

  it('rejects check-in on another day', async () => {
    const { service, bookings } = buildService();
    bookings.push(booking({ date: new Date(`${FUTURE}T00:00:00.000Z`) }));
    await expect(service.checkIn(1, 'staff')).rejects.toThrow(
      'Solo se puede hacer check-in el día de la cita',
    );
    expect(bookings[0].status).toBe('confirmed');
  });

  it('uses the store day: 20:00 Bogota (01:00Z next day) still checks in a booking of that Bogota day', async () => {
    jest.setSystemTime(new Date('2026-10-30T01:00:00.000Z'));
    const { service, bookings } = buildService();
    bookings.push(booking({ date: new Date(`${TODAY}T00:00:00.000Z`) }));
    const result = await service.checkIn(1, 'customer');
    expect(result.status).toBe('arriving');
  });

  it('regression: check-in today moves confirmed → arriving and emits booking.checked_in', async () => {
    const { service, bookings, emits } = buildService();
    bookings.push(booking({ date: new Date(`${TODAY}T00:00:00.000Z`) }));
    const result = await service.checkIn(1, 'staff');
    expect(result.status).toBe('arriving');
    expect(result.checked_in_at).toBeInstanceOf(Date);
    expect(emits.map((e) => e.name)).toContain('booking.checked_in');
  });
});

describe('S13 — approving a reschedule request', () => {
  const pendingRequest = (o: Row = {}) => ({
    id: 1,
    store_id: 1,
    booking_id: 1,
    status: 'pending',
    requested_date: new Date('2026-11-06T00:00:00Z'),
    requested_start_time: '12:00',
    requested_end_time: '13:00',
    ...o,
  });

  it('rejects when the booking was cancelled meanwhile', async () => {
    const { service, bookings, requests } = buildService();
    bookings.push(booking({ status: 'cancelled' }));
    requests.push(pendingRequest());
    await expect(
      service.approveRescheduleRequest(1, { decidedByUserId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].start_time).toBe('10:00');
    expect(requests[0].status).toBe('pending');
  });

  it('rejects a requested slot that is now in the past', async () => {
    const { service, bookings, requests } = buildService();
    bookings.push(booking());
    requests.push(pendingRequest({ requested_date: new Date('2026-10-20T00:00:00Z') }));
    await expect(
      service.approveRescheduleRequest(1, { decidedByUserId: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].start_time).toBe('10:00');
  });

  it('regression: approves a confirmed booking into a free slot (availability excludes itself)', async () => {
    const { service, bookings, requests, availabilityService } = buildService();
    bookings.push(booking());
    requests.push(pendingRequest());
    const result = await service.approveRescheduleRequest(1, { decidedByUserId: 1 });
    expect(result.start_time).toBe('12:00');
    expect(requests[0].status).toBe('approved');
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10, '2026-11-06', '12:00', '13:00', undefined, 1,
    );
  });
});

describe('S14 — confirm-hold and reopen_order', () => {
  const hold = (o: Row = {}) =>
    booking({ status: 'pending', expires_at: new Date(NOW.getTime() + 10 * 60_000), ...o });

  it('rejects confirming a hold whose slot is now taken (availability excludes itself)', async () => {
    const { service, bookings, availabilityService, ordersService } = buildService({
      isSlotAvailable: false,
    });
    bookings.push(hold());
    await expect(service.confirmHold(1)).rejects.toBeInstanceOf(ConflictException);
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10, FUTURE, '10:00', '11:00', undefined, 1,
    );
    expect(ordersService.create).not.toHaveBeenCalled();
    expect(bookings[0].expires_at).not.toBeNull();
  });

  it('rejects confirming a hold whose slot is already over', async () => {
    const { service, bookings, ordersService } = buildService();
    bookings.push(hold({ date: new Date('2026-10-20T00:00:00Z') }));
    await expect(service.confirmHold(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(ordersService.create).not.toHaveBeenCalled();
  });

  it('rejects confirming when the in-transaction re-count finds the capacity full', async () => {
    const { service, bookings, ordersService } = buildService();
    bookings.push(hold());
    for (let i = 0; i < 10; i++) {
      bookings.push(booking({ id: 200 + i, booking_number: `B-${i}` }));
    }
    await expect(service.confirmHold(1)).rejects.toBeInstanceOf(ConflictException);
    // The pre-created order is compensated.
    expect(ordersService.update).toHaveBeenCalledWith(
      900,
      expect.objectContaining({ state: 'cancelled' }),
    );
    expect(bookings[0].order_id).toBeNull();
  });

  it('creates the order with the server-side price and links it', async () => {
    const { service, bookings, ordersService, priceResolverService } = buildService();
    bookings.push(hold());
    const result = await service.confirmHold(1);
    expect(priceResolverService.resolvePrice).toHaveBeenCalled();
    const [orderDto] = ordersService.create.mock.calls[0];
    expect(orderDto).toMatchObject({
      customer_id: 7,
      subtotal: 20000,
      total_amount: 20000,
      items: [expect.objectContaining({ product_id: 10, unit_price: 20000, quantity: 1 })],
    });
    expect(result.order_id).toBe(900);
    expect(result.expires_at).toBeNull();
  });

  it('rejects confirming a hold that is no longer pending', async () => {
    const { service, bookings, ordersService } = buildService();
    bookings.push(hold({ status: 'cancelled' }));
    await expect(service.confirmHold(1)).rejects.toBeInstanceOf(BadRequestException);
    expect(ordersService.create).not.toHaveBeenCalled();
  });

  it('reopen_order on a cancelled order is rejected (409) and the booking does not move', async () => {
    const { service, bookings, orders, prisma } = buildService();
    bookings.push(booking({ order_id: 900 }));
    orders.push(order({ state: 'cancelled' }));
    await expect(
      service.reschedule(1, {
        date: '2026-11-06',
        start_time: '12:00',
        end_time: '13:00',
        reopen_order: true,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bookings[0].start_time).toBe('10:00');
    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(orders[0].state).toBe('cancelled');
  });

  it('regression: reschedule with reopen_order on a live order still moves the booking', async () => {
    const { service, bookings, orders, prisma } = buildService();
    bookings.push(booking({ order_id: 900 }));
    orders.push(order({ state: 'processing' }));
    const result = await service.reschedule(1, {
      date: '2026-11-06',
      start_time: '12:00',
      end_time: '13:00',
      reopen_order: true,
    } as any);
    expect(result.start_time).toBe('12:00');
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });
});

describe('T3 advisory A/B — expired holds and the hold re-count', () => {
  it('hold re-counts free_booking capacity inside the transaction', async () => {
    const { service, bookings } = buildService();
    for (let i = 0; i < 10; i++) {
      bookings.push(booking({ id: 200 + i, booking_number: `B-${i}` }));
    }
    await expect(
      service.hold({ customer_id: 7, product_id: 10, date: FUTURE, start_time: '10:00', end_time: '11:00' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(bookings).toHaveLength(10);
  });

  it('expired holds do not take seats in the in-transaction re-count', async () => {
    const { service, bookings } = buildService();
    for (let i = 0; i < 10; i++) {
      bookings.push(
        booking({
          id: 200 + i,
          booking_number: `B-${i}`,
          status: 'pending',
          expires_at: new Date(NOW.getTime() - 60_000),
        }),
      );
    }
    const created = await service.hold({
      customer_id: 7,
      product_id: 10,
      date: FUTURE,
      start_time: '10:00',
      end_time: '11:00',
    });
    expect(created.status).toBe('pending');
    expect(bookings).toHaveLength(11);
  });

  it('AvailabilityService: 10 expired holds leave a free_booking slot available, 10 live holds do not', async () => {
    const rows: Row[] = [];
    const prisma: any = {
      products: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, store_id: 1, booking_mode: 'free_booking' }),
      },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      bookings: {
        count: jest.fn(({ where }: any) =>
          Promise.resolve(rows.filter((b) => matches(b, where)).length),
        ),
      },
    };
    const availability = new AvailabilityService(prisma, {} as any);
    for (let i = 0; i < 10; i++) {
      rows.push(booking({ id: i + 1, status: 'pending', expires_at: new Date(NOW.getTime() - 60_000) }));
    }
    await expect(availability.isSlotAvailable(10, FUTURE, '10:00', '11:00')).resolves.toBe(true);
    for (const r of rows) r.expires_at = new Date(NOW.getTime() + 60_000);
    await expect(availability.isSlotAvailable(10, FUTURE, '10:00', '11:00')).resolves.toBe(false);
  });
});

describe('T3 advisory C — email confirmation re-check excludes the booking itself', () => {
  it('passes the booking id to isSlotAvailable', async () => {
    const isSlotAvailable = jest.fn().mockResolvedValue(true);
    const tokenRecord = {
      id: 1,
      token: 'tkn',
      used: false,
      expires_at: new Date(NOW.getTime() + 60_000),
      action: 'confirm',
      booking: booking({ id: 42, provider_id: 5, status: 'pending' }),
    };
    const delegates: any = {
      booking_confirmation_tokens: {
        findUnique: jest.fn().mockResolvedValue(tokenRecord),
        findFirst: jest.fn().mockResolvedValue(tokenRecord),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bookings: {
        update: jest.fn().mockResolvedValue({ id: 42 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma: any = { withoutScope: () => delegates, ...delegates };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const service = new BookingConfirmationService(
      prisma,
      { emit: jest.fn() } as any,
      { isSlotAvailable } as any,
    );
    await service.processToken('tkn');
    expect(isSlotAvailable).toHaveBeenCalledWith(10, FUTURE, '10:00', '11:00', 5, 42);
  });
});

describe('T3 advisory D — isSerializationFailure', () => {
  it('matches the Prisma/Postgres serialization signals', () => {
    expect(isSerializationFailure({ code: 'P2034' })).toBe(true);
    expect(isSerializationFailure({ meta: { code: '40001' } })).toBe(true);
    expect(
      isSerializationFailure({ message: 'could not serialize access due to concurrent update' }),
    ).toBe(true);
    expect(isSerializationFailure({ message: 'Error occurred: code: `40001`' })).toBe(true);
    expect(isSerializationFailure({ message: 'ERROR: SQLSTATE 40001' })).toBe(true);
  });

  it('does not match "40001" appearing anywhere else in a message', () => {
    expect(isSerializationFailure({ message: 'Order 40001 not found' })).toBe(false);
    expect(isSerializationFailure({ message: 'Amount 140001.00 exceeds limit' })).toBe(false);
    expect(isSerializationFailure({ message: 'booking BKG-20261105-40001 duplicated' })).toBe(false);
  });
});
