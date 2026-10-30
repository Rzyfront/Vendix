/**
 * QUI-966 T2 (S4) — date/time gate on every booking entry point.
 * Run with TZ=UTC (backend container). "Now" is pinned to
 * 2026-10-29 10:00 America/Bogota (15:00Z, a Thursday).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ReservationsService } from './reservations.service';

(RequestContextService.getContext as jest.Mock) = jest.fn().mockReturnValue({
  user_id: 1,
  store_id: 1,
  organization_id: 1,
});

type Row = Record<string, any>;
type Hours = Array<[number, { start_time: string; end_time: string }]>;

// Mon–Sat 08:00–18:00, Sunday closed.
const STORE_HOURS: Hours = [1, 2, 3, 4, 5, 6].map((d) => [
  d,
  { start_time: '08:00', end_time: '18:00' },
]);

function build(
  opts: { bookingMode?: string; hours?: Hours; providers?: Row[] } = {},
) {
  const bookings: Row[] = [];
  const requests: Row[] = [];
  const product = {
    id: 10,
    name: 'Corte',
    requires_booking: true,
    service_duration_minutes: 60,
    booking_mode: opts.bookingMode ?? 'provider_required',
    base_price: 20000,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
  };
  const prisma: any = {
    products: { findFirst: jest.fn().mockResolvedValue(product) },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    provider_services: {
      findFirst: jest.fn().mockResolvedValue({
        provider_id: 5,
        provider: { id: 5, is_active: true },
      }),
      findMany: jest.fn().mockResolvedValue(
        opts.providers ?? [{ provider_id: 5, provider: { id: 5, is_active: true } }],
      ),
    },
    store_users: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    orders: { findFirst: jest.fn().mockResolvedValue({ id: 900 }) },
    store_settings: {
      // null → resolveStoreTimezone falls back to America/Bogota and
      // allow_direct_reschedule keeps its legacy default (true).
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    bookings: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where?.id ? (bookings.find((b) => b.id === where.id) ?? null) : null,
        ),
      ),
      count: jest.fn().mockResolvedValue(0),
      // QUI-966 S6: booking numbering reads the day's numbers (numeric max).
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: 100 + bookings.length,
          customer: { first_name: 'Ana', last_name: 'Ruiz' },
          product: { name: 'Corte' },
          ...data,
        };
        bookings.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const t = bookings.find((b) => b.id === where.id)!;
        Object.assign(t, data);
        return Promise.resolve(t);
      }),
    },
    booking_reschedule_requests: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => {
        const row = { id: requests.length + 1, ...data };
        requests.push(row);
        return Promise.resolve(row);
      }),
    },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));

  const availabilityService: any = {
    getAvailableProvidersForSlot: jest.fn().mockResolvedValue([{ id: 5 }]),
    isSlotAvailable: jest.fn().mockResolvedValue(true),
    validateNoOverlapForCustomer: jest.fn().mockResolvedValue(undefined),
  };
  const businessHoursService: any = {
    loadStoreHours: jest.fn().mockResolvedValue(new Map(opts.hours ?? STORE_HOURS)),
  };
  const service = new ReservationsService(
    prisma,
    availabilityService,
    { create: jest.fn().mockResolvedValue({ id: 900 }), update: jest.fn() } as any,
    { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
    { emit: jest.fn() } as any,
    { resolvePrice: jest.fn().mockReturnValue({ unitPrice: 20000 }) } as any,
    {} as any,
    {} as any,
    { record: jest.fn() } as any,
    businessHoursService,
  );
  return { service, prisma, bookings, requests, availabilityService };
}

const FUTURE = '2026-11-05'; // Thursday
const SUNDAY = '2026-11-08';
const base = {
  customer_id: 7,
  product_id: 10,
  date: FUTURE,
  start_time: '10:00',
  end_time: '11:00',
  skip_order_creation: true,
};
const existing = (o: Row = {}): Row => ({
  id: 1,
  store_id: 1,
  customer_id: 7,
  product_id: 10,
  provider_id: 5,
  booking_number: 'BKG-20261105-0001',
  date: new Date(`${FUTURE}T00:00:00.000Z`),
  start_time: '10:00',
  end_time: '11:00',
  status: 'confirmed',
  customer: { first_name: 'Ana', last_name: 'Ruiz' },
  product: { name: 'Corte' },
  ...o,
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-29T15:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

describe('ReservationsService.create — S4 date/time gate', () => {
  it('still creates a valid booking inside business hours', async () => {
    const { service, bookings } = build();
    await service.create({ ...base } as any);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].start_time).toBe('10:00');
  });

  it('still auto-creates the linked order for a valid POS booking', async () => {
    const { service, bookings } = build();
    const { skip_order_creation: _s, ...pos } = base;
    await service.create({ ...pos, channel: 'pos' } as any);
    expect(bookings[0].order_id).toBe(900);
  });

  it('rejects a slot that already ended earlier today in the store timezone', async () => {
    const { service, prisma } = build();
    await expect(
      service.create({ ...base, date: '2026-10-29', start_time: '08:00', end_time: '09:00' } as any),
    ).rejects.toThrow('No se puede reservar en una fecha u hora que ya pasó');
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('accepts a slot in progress (POS charges first, books right after)', async () => {
    const { service, bookings } = build();
    await service.create({
      ...base,
      channel: 'pos',
      date: '2026-10-29',
      start_time: '09:58',
      end_time: '10:58',
    } as any);
    expect(bookings).toHaveLength(1);
    expect(bookings[0].start_time).toBe('09:58');
  });

  it('rejects a past date even inside business hours', async () => {
    const { service, prisma } = build();
    await expect(
      service.create({ ...base, date: '2026-10-28', start_time: '16:00', end_time: '17:00' } as any),
    ).rejects.toThrow('No se puede reservar en una fecha u hora que ya pasó');
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('accepts a slot later today in the store timezone', async () => {
    const { service, bookings } = build();
    await service.create({ ...base, date: '2026-10-29', start_time: '11:00', end_time: '12:00' } as any);
    expect(bookings).toHaveLength(1);
  });

  it('rejects a slot outside business hours with a clear message', async () => {
    const { service, prisma } = build();
    await expect(
      service.create({ ...base, start_time: '17:30', end_time: '18:30' } as any),
    ).rejects.toThrow('fuera del horario de atención (08:00 - 18:00)');
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });

  it('rejects a closed day', async () => {
    const { service } = build();
    await expect(service.create({ ...base, date: SUNDAY } as any)).rejects.toThrow(
      'La tienda no atiende el día domingo',
    );
  });

  it('enforces hours and past date for free_booking products (no availability check)', async () => {
    const { service, availabilityService } = build({ bookingMode: 'free_booking' });
    await expect(
      service.create({ ...base, start_time: '19:00', end_time: '20:00' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ ...base, date: '2026-10-01' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availabilityService.isSlotAvailable).not.toHaveBeenCalled();
  });

  it('enforces hours when no providers are configured', async () => {
    const { service } = build({ providers: [] });
    await expect(
      service.create({ ...base, start_time: '06:00', end_time: '07:00' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not enforce a window when the store has no hours configured', async () => {
    const { service, bookings } = build({ hours: [] });
    await service.create({ ...base, start_time: '21:00', end_time: '22:00' } as any);
    expect(bookings).toHaveLength(1);
  });

  it('rejects an impossible calendar date (no rollover)', async () => {
    const { service } = build();
    await expect(service.create({ ...base, date: '2026-02-30' } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('staff override (skip_availability_check)', () => {
    it('allows a past slot', async () => {
      const { service, bookings } = build();
      await service.create({ ...base, date: '2026-10-01', skip_availability_check: true } as any);
      expect(bookings).toHaveLength(1);
    });

    it('allows a slot outside business hours and on a closed day', async () => {
      const { service, bookings } = build();
      await service.create({
        ...base,
        date: SUNDAY,
        start_time: '19:00',
        end_time: '20:00',
        skip_availability_check: true,
      } as any);
      expect(bookings).toHaveLength(1);
    });

    it.each([
      ['inverted', '11:00', '10:00'],
      ['zero duration', '10:00', '10:00'],
      ['crossing midnight', '23:30', '00:30'],
    ])('never allows a %s range', async (_l, start_time, end_time) => {
      const { service, prisma } = build();
      await expect(
        service.create({ ...base, start_time, end_time, skip_availability_check: true } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bookings.create).not.toHaveBeenCalled();
    });

    it('never allows an invalid date', async () => {
      const { service } = build();
      await expect(
        service.create({ ...base, date: '2026-11-05T10:00:00-05:00', skip_availability_check: true } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a string "true" is not an override', async () => {
      const { service } = build();
      await expect(
        service.create({ ...base, date: '2026-10-01', skip_availability_check: 'true' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('ReservationsService.hold — S4 (ecommerce, never forced)', () => {
  it('still holds a valid slot', async () => {
    const { service, bookings } = build();
    await service.hold({ ...base });
    expect(bookings).toHaveLength(1);
    expect(bookings[0].expires_at).toBeInstanceOf(Date);
  });

  it.each([
    ['past date', { date: '2026-10-01' }],
    ['outside hours', { start_time: '18:00', end_time: '19:00' }],
    ['inverted range', { start_time: '11:00', end_time: '10:00' }],
    ['invalid date', { date: '2026-02-30' }],
  ])('rejects a %s', async (_l, patch) => {
    const { service, prisma } = build();
    await expect(service.hold({ ...base, ...patch })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bookings.create).not.toHaveBeenCalled();
  });
});

describe('ReservationsService.reschedule / requestReschedule — S4', () => {
  it('still reschedules into a valid future slot', async () => {
    const { service, bookings } = build();
    bookings.push(existing());
    await service.reschedule(1, { date: '2026-11-06', start_time: '14:00', end_time: '15:00' });
    expect(bookings[0].start_time).toBe('14:00');
  });

  it.each([
    ['outside hours', { date: FUTURE, start_time: '07:00', end_time: '08:00' }],
    ['closed day', { date: SUNDAY, start_time: '10:00', end_time: '11:00' }],
    ['inverted range', { date: FUTURE, start_time: '15:00', end_time: '14:00' }],
  ])('rejects rescheduling into a %s slot', async (_l, dto) => {
    const { service, bookings } = build();
    bookings.push(existing());
    await expect(service.reschedule(1, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings[0].start_time).toBe('10:00');
  });

  it('still creates a reschedule request for a valid slot', async () => {
    const { service, requests } = build();
    await service.requestReschedule(
      existing() as any,
      { date: '2026-11-06', start_time: '14:00', end_time: '15:00' },
      { requestedByCustomerId: 7 },
    );
    expect(requests).toHaveLength(1);
  });

  it('rejects a reschedule request into the past', async () => {
    const { service, requests } = build();
    await expect(
      service.requestReschedule(
        existing() as any,
        { date: '2026-10-28', start_time: '14:00', end_time: '15:00' },
        { requestedByCustomerId: 7 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(requests).toHaveLength(0);
  });
});

describe('ReservationsService.assertCheckoutBookingBookable — S14 checkout pre-check', () => {
  it('passes a valid, available slot and checks availability with the provider', async () => {
    const { service, availabilityService } = build();
    await expect(
      service.assertCheckoutBookingBookable(1, { ...base, provider_id: 5 }),
    ).resolves.toBeUndefined();
    expect(availabilityService.isSlotAvailable).toHaveBeenCalledWith(
      10,
      FUTURE,
      '10:00',
      '11:00',
      5,
    );
  });

  it.each([
    ['past date', { date: '2026-10-01' }],
    ['outside hours', { start_time: '18:00', end_time: '19:00' }],
    ['inverted range', { start_time: '11:00', end_time: '10:00' }],
    ['invalid date', { date: '2026-02-30' }],
  ])('rejects a %s with 400', async (_l, patch) => {
    const { service, availabilityService } = build();
    await expect(
      service.assertCheckoutBookingBookable(1, { ...base, ...patch }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availabilityService.isSlotAvailable).not.toHaveBeenCalled();
  });

  it('rejects a taken slot with 409', async () => {
    const { service, availabilityService } = build();
    availabilityService.isSlotAvailable.mockResolvedValue(false);
    await expect(
      service.assertCheckoutBookingBookable(1, { ...base }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the legacy fallback: provider_required with no active providers is not availability-checked', async () => {
    const { service, availabilityService } = build({ providers: [] });
    await expect(
      service.assertCheckoutBookingBookable(1, { ...base }),
    ).resolves.toBeUndefined();
    expect(availabilityService.isSlotAvailable).not.toHaveBeenCalled();
  });
});
