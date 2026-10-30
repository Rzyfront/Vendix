/**
 * Adversarial QA spec for AvailabilityService. Assertions describe the
 * CORRECT business behavior; a failing test is a finding.
 * Process TZ forced to UTC (backend container).
 */
// Run with `TZ=UTC` in the environment to mirror the backend container;
// assigning process.env.TZ here is too late for the jest worker.
process.env.TZ = 'UTC';

import { AvailabilityService } from './availability.service';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === undefined) return true;
    if (key === 'services') return true; // relation filter handled by fixture
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (cond !== null && typeof cond === 'object') {
      const v = value instanceof Date ? value.getTime() : value;
      const n = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(v < n(cond.lt))) return false;
      if ('gt' in cond && !(v > n(cond.gt))) return false;
      if ('lte' in cond && !(v <= n(cond.lte))) return false;
      if ('gte' in cond && !(v >= n(cond.gte))) return false;
      return true;
    }
    return value === cond;
  });
}

function build(
  opts: {
    bookingMode?: 'provider_required' | 'free_booking';
    bookings?: Row[];
    exceptions?: Row[];
    schedules?: Row[];
    storeHours?: Array<[number, { start_time: string; end_time: string }]>;
  } = {},
) {
  const bookings = opts.bookings ?? [];
  const exceptions = opts.exceptions ?? [];
  // Provider 5 works every day 08:00-18:00 by default.
  const schedules =
    opts.schedules ??
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      provider_id: 5,
      day_of_week: d,
      start_time: '08:00',
      end_time: '18:00',
      is_active: true,
      block_order: 0,
    }));
  const storeHours = new Map(
    opts.storeHours ??
      [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start_time: '08:00', end_time: '18:00' }] as const),
  );

  const prisma: any = {
    products: {
      findFirst: jest.fn().mockResolvedValue({
        id: 10,
        store_id: 1,
        service_duration_minutes: 60,
        buffer_minutes: 0,
        booking_mode: opts.bookingMode ?? 'provider_required',
      }),
    },
    product_variants: { findFirst: jest.fn().mockResolvedValue(null) },
    service_providers: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 5, display_name: 'Pedro', avatar_url: null }]),
    },
    provider_services: {
      findFirst: jest.fn().mockResolvedValue({ provider_id: 5, product_id: 10 }),
    },
    provider_schedules: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          schedules.filter((s) =>
            matches(s, {
              ...where,
              provider_id:
                typeof where.provider_id === 'object' ? undefined : where.provider_id,
            }),
          ),
        ),
      ),
    },
    provider_exceptions: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(exceptions.find((e) => matches(e, where)) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(exceptions),
    },
    bookings: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(bookings.filter((b) => matches(b, where)).length),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(bookings.filter((b) => matches(b, where))),
      ),
    },
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({
        settings: { general: { timezone: 'America/Bogota' } },
        stores: { timezone: 'America/Bogota' },
      }),
      findUnique: jest.fn().mockResolvedValue({
        settings: { availability: { working_days: [0, 1, 2, 3, 4, 5, 6] } },
      }),
    },
  };
  // QUI-966 S15: availability reads every open block per day.
  const storeWindows = new Map(
    [...storeHours].map(([d, w]) => [d, [w]] as const),
  );
  const businessHoursService: any = {
    loadStoreWindows: jest.fn().mockResolvedValue(storeWindows),
  };
  return { service: new AvailabilityService(prisma, businessHoursService), prisma };
}

const DAY = '2026-11-05'; // Thursday
const bookingRow = (o: Row = {}) => ({
  id: 1,
  product_id: 10,
  provider_id: 5,
  date: new Date(`${DAY}T00:00:00.000Z`),
  start_time: '10:00',
  end_time: '11:00',
  status: 'confirmed',
  ...o,
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-29T15:00:00.000Z')); // 10:00 Bogota
});
afterEach(() => jest.useRealTimers());

describe('AvailabilityService (adversarial) — isSlotAvailable boundaries', () => {
  it('back-to-back slot (end == start of next) is available', async () => {
    const { service } = build({ bookings: [bookingRow()] });
    await expect(service.isSlotAvailable(10, DAY, '11:00', '12:00', 5)).resolves.toBe(true);
  });

  it('overlapping slot for the same provider is NOT available', async () => {
    const { service } = build({ bookings: [bookingRow()] });
    await expect(service.isSlotAvailable(10, DAY, '10:30', '11:30', 5)).resolves.toBe(false);
  });

  it('a cancelled booking does not block the slot', async () => {
    const { service } = build({ bookings: [bookingRow({ status: 'cancelled' })] });
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', 5)).resolves.toBe(true);
  });

  it('slot crossing the business-hours close is NOT available', async () => {
    const { service } = build();
    await expect(service.isSlotAvailable(10, DAY, '17:30', '18:30', 5)).resolves.toBe(false);
  });

  it.each([
    ['inverted range', '11:00', '10:00'],
    ['zero duration', '10:00', '10:00'],
    ['crossing midnight', '17:30', '00:30'],
  ])('%s is NOT available', async (_l, start, end) => {
    const { service } = build();
    await expect(service.isSlotAvailable(10, DAY, start, end, 5)).resolves.toBe(false);
  });

  it('a zero-duration slot inside an existing booking is NOT available', async () => {
    const { service } = build({ bookings: [bookingRow()] });
    await expect(service.isSlotAvailable(10, DAY, '10:30', '10:30', 5)).resolves.toBe(false);
  });

  it('a slot on a past date is NOT available', async () => {
    const { service } = build();
    await expect(service.isSlotAvailable(10, '2026-10-01', '10:00', '11:00', 5)).resolves.toBe(false);
  });

  it('a slot earlier TODAY (already elapsed in store TZ) is NOT available', async () => {
    const { service } = build();
    await expect(service.isSlotAvailable(10, '2026-10-29', '08:00', '09:00', 5)).resolves.toBe(false);
  });

  it('provider marked unavailable by exception is NOT available', async () => {
    const { service } = build({
      exceptions: [
        { provider_id: 5, date: new Date(`${DAY}T00:00:00.000Z`), is_unavailable: true },
      ],
    });
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', 5)).resolves.toBe(false);
  });

  it('custom exception hours narrow the window', async () => {
    const { service } = build({
      exceptions: [
        {
          provider_id: 5,
          date: new Date(`${DAY}T00:00:00.000Z`),
          is_unavailable: false,
          custom_start_time: '14:00',
          custom_end_time: '16:00',
        },
      ],
    });
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', 5)).resolves.toBe(false);
    await expect(service.isSlotAvailable(10, DAY, '14:00', '15:00', 5)).resolves.toBe(true);
  });

  it('a provider busy with ANOTHER service is not available (provider-level overlap)', async () => {
    const { service } = build({ bookings: [bookingRow({ product_id: 99 })] });
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', 5)).resolves.toBe(false);
  });

  it('day-of-week derives from the civil date (Thursday schedule only)', async () => {
    const { service } = build({
      schedules: [
        { provider_id: 5, day_of_week: 4, start_time: '08:00', end_time: '18:00', is_active: true, block_order: 0 },
      ],
    });
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', 5)).resolves.toBe(true);
    await expect(service.isSlotAvailable(10, '2026-11-06', '10:00', '11:00', 5)).resolves.toBe(false);
  });
});

describe('AvailabilityService (adversarial) — getAvailableSlots', () => {
  it('marks a slot as booked when the provider is busy with ANOTHER service', async () => {
    const { service } = build({ bookings: [bookingRow({ product_id: 99 })] });
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    const s10 = slots.find((s) => s.start_time === '10:00');
    expect(s10?.total_available).toBe(0);
  });

  it('never offers slots for past dates', async () => {
    const { service } = build();
    const slots = await service.getAvailableSlots(10, '2026-10-27', '2026-10-27');
    expect(slots.filter((s) => s.total_available > 0)).toEqual([]);
  });

  it('free_booking (generic slots) hides already-elapsed slots of today in store TZ', async () => {
    const { service } = build({ bookingMode: 'free_booking' });
    const slots = await service.getAvailableSlots(10, '2026-10-29', '2026-10-29');
    expect(slots.some((s) => s.start_time < '10:00')).toBe(false);
  });

  it('free_booking capacity counts OVERLAPPING bookings, not only identical start/end', async () => {
    const { service } = build({
      bookingMode: 'free_booking',
      bookings: [bookingRow({ provider_id: null, start_time: '10:30', end_time: '11:30' })],
    });
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    const s10 = slots.find((s) => s.start_time === '10:00');
    expect(s10?.total_available).toBe(9);
  });
});
