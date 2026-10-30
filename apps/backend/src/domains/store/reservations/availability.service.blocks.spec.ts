/**
 * QUI-966 T7 (S15) — business-hours blocks and provider occupancy.
 *
 * - The store master calendar may have several blocks per day (POS settings
 *   `business_hours[day].blocks`, e.g. 08–12 / 14–18): a slot is bookable
 *   only when it fits entirely inside ONE block, so the lunch gap is closed.
 * - The grid marks a provider busy while attending ANOTHER service.
 * - A provider_required service with active providers never falls back to
 *   generic provider-less slots.
 * - Both grid routes hide only slots that already ENDED today.
 *
 * Run with `TZ=UTC` (backend container).
 */
process.env.TZ = 'UTC';

import { BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import {
  assertBookingSlotOpen,
  StoreWindow,
  StoreWindowsMap,
} from './booking-time.util';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === undefined) return true;
    if (key === 'services' || key === 'OR') return true;
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

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const LUNCH: StoreWindow[] = [
  { start_time: '08:00', end_time: '12:00' },
  { start_time: '14:00', end_time: '18:00' },
];
const FULL_DAY: StoreWindow[] = [{ start_time: '08:00', end_time: '18:00' }];

const block = (provider_id: number, start: string, end: string, order = 0) =>
  ALL_DAYS.map((d) => ({
    provider_id,
    day_of_week: d,
    start_time: start,
    end_time: end,
    is_active: true,
    block_order: order,
  }));

function build(
  opts: {
    bookingMode?: 'provider_required' | 'free_booking';
    windows?: StoreWindow[];
    storeWindows?: StoreWindowsMap;
    providers?: Row[];
    schedules?: Row[];
    bookings?: Row[];
  } = {},
) {
  const bookings = opts.bookings ?? [];
  const providers = opts.providers ?? [
    { id: 5, display_name: 'Pedro', avatar_url: null },
  ];
  const schedules = opts.schedules ?? block(5, '08:00', '18:00');
  const storeWindows: StoreWindowsMap =
    opts.storeWindows ??
    new Map(ALL_DAYS.map((d) => [d, opts.windows ?? FULL_DAY]));

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
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          providers.filter((p) => (where?.id ? p.id === where.id : true)),
        ),
      ),
      count: jest.fn().mockResolvedValue(providers.length),
    },
    provider_services: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          providers.some((p) => p.id === where.provider_id)
            ? { provider_id: where.provider_id, product_id: 10 }
            : null,
        ),
      ),
    },
    provider_schedules: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          schedules.filter((s) =>
            matches(s, {
              ...where,
              provider_id:
                typeof where.provider_id === 'object'
                  ? undefined
                  : where.provider_id,
            }) &&
            (typeof where.provider_id === 'object'
              ? where.provider_id.in.includes(s.provider_id)
              : true),
          ),
        ),
      ),
    },
    provider_exceptions: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
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
        settings: { availability: { working_days: ALL_DAYS } },
      }),
    },
  };
  const businessHoursService: any = {
    loadStoreWindows: jest.fn().mockResolvedValue(storeWindows),
  };
  return {
    service: new AvailabilityService(prisma, businessHoursService),
    prisma,
  };
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
  expires_at: null,
  ...o,
});
const starts = (slots: Array<{ start_time: string }>) =>
  slots.map((s) => s.start_time);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-29T15:00:00.000Z')); // 10:00 Bogota
});
afterEach(() => jest.useRealTimers());

describe('QUI-966 S15 — booking gate respects store blocks', () => {
  const ctx = (windows: StoreWindow[]) => ({
    timezone: 'America/Bogota',
    storeHours: new Map(ALL_DAYS.map((d) => [d, windows])) as StoreWindowsMap,
  });
  const slot = (start_time: string, end_time: string) => ({
    date: DAY,
    start_time,
    end_time,
  });

  it('rejects a slot inside the lunch gap, naming every block', () => {
    expect(() => assertBookingSlotOpen(slot('12:30', '13:30'), ctx(LUNCH))).toThrow(
      'El horario solicitado está fuera del horario de atención (08:00 - 12:00, 14:00 - 18:00)',
    );
  });

  it('rejects a slot that straddles the gap between two blocks', () => {
    expect(() =>
      assertBookingSlotOpen(slot('11:30', '14:30'), ctx(LUNCH)),
    ).toThrow(BadRequestException);
  });

  it('accepts slots inside one block, including one ending exactly at the block end', () => {
    expect(() => assertBookingSlotOpen(slot('11:00', '12:00'), ctx(LUNCH))).not.toThrow();
    expect(() => assertBookingSlotOpen(slot('14:00', '15:00'), ctx(LUNCH))).not.toThrow();
  });

  it('single-block day is unchanged (same message and bounds)', () => {
    expect(() => assertBookingSlotOpen(slot('12:30', '13:30'), ctx(FULL_DAY))).not.toThrow();
    expect(() => assertBookingSlotOpen(slot('17:30', '18:30'), ctx(FULL_DAY))).toThrow(
      'El horario solicitado está fuera del horario de atención (08:00 - 18:00)',
    );
  });

  it('a day with no block is closed', () => {
    const storeHours: StoreWindowsMap = new Map([[1, FULL_DAY]]);
    expect(() =>
      assertBookingSlotOpen(slot('10:00', '11:00'), {
        timezone: 'America/Bogota',
        storeHours,
      }),
    ).toThrow('La tienda no atiende el día jueves');
  });
});

describe('QUI-966 S15 — isSlotAvailable respects blocks', () => {
  it('store lunch gap and a slot straddling it are NOT available', async () => {
    const { service } = build({ windows: LUNCH });
    await expect(service.isSlotAvailable(10, DAY, '12:30', '13:30', 5)).resolves.toBe(false);
    await expect(service.isSlotAvailable(10, DAY, '11:30', '12:30', 5)).resolves.toBe(false);
    await expect(service.isSlotAvailable(10, DAY, '11:30', '12:30')).resolves.toBe(false);
  });

  it('a slot ending exactly at the block end is available', async () => {
    const { service } = build({ windows: LUNCH });
    await expect(service.isSlotAvailable(10, DAY, '11:00', '12:00', 5)).resolves.toBe(true);
    await expect(service.isSlotAvailable(10, DAY, '17:00', '18:00')).resolves.toBe(true);
  });

  it('provider blocks (08–12 / 14–18) close the provider lunch gap too', async () => {
    const { service } = build({
      schedules: [...block(5, '08:00', '12:00', 0), ...block(5, '14:00', '18:00', 1)],
    });
    await expect(service.isSlotAvailable(10, DAY, '12:00', '13:00', 5)).resolves.toBe(false);
    await expect(service.isSlotAvailable(10, DAY, '11:30', '14:30', 5)).resolves.toBe(false);
    await expect(service.isSlotAvailable(10, DAY, '14:00', '15:00', 5)).resolves.toBe(true);
  });

  it('getAvailableProvidersForSlot returns nobody during the store lunch gap', async () => {
    const { service } = build({ windows: LUNCH });
    await expect(
      service.getAvailableProvidersForSlot(10, DAY, '12:00', '13:00'),
    ).resolves.toEqual([]);
    await expect(
      service.getAvailableProvidersForSlot(10, DAY, '10:00', '11:00'),
    ).resolves.toEqual([{ id: 5, display_name: 'Pedro', avatar_url: null }]);
  });
});

describe('QUI-966 S15 — grid respects blocks', () => {
  const OPEN_HOURS = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];

  it('provider route offers no slot in the store lunch gap', async () => {
    const { service } = build({ windows: LUNCH });
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    expect(starts(slots)).toEqual(OPEN_HOURS);
    expect(slots.every((s) => s.total_available === 1 && !s.is_booked)).toBe(true);
  });

  it('free_booking route offers no slot in the lunch gap and keeps capacity 10', async () => {
    const { service } = build({ bookingMode: 'free_booking', windows: LUNCH });
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    expect(starts(slots)).toEqual(OPEN_HOURS);
    expect(slots.every((s) => s.total_available === 10)).toBe(true);
  });

  it('single-block day is unchanged (08:00–17:00 starts)', async () => {
    const { service } = build();
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    expect(starts(slots)).toEqual([
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
    ]);
  });

  it('free_booking skips a day with no block when the store configured its hours', async () => {
    const { service } = build({
      bookingMode: 'free_booking',
      storeWindows: new Map([[1, FULL_DAY]]), // only Monday open
    });
    await expect(service.getAvailableSlots(10, DAY, DAY)).resolves.toEqual([]);
  });
});

describe('QUI-966 S15 — grid marks a provider busy with another service', () => {
  it('slot is booked when the only provider attends ANOTHER service', async () => {
    const { service } = build({ bookings: [bookingRow({ product_id: 99 })] });
    const s10 = (await service.getAvailableSlots(10, DAY, DAY)).find(
      (s) => s.start_time === '10:00',
    );
    expect(s10).toMatchObject({ total_available: 0, is_booked: true });
  });

  it('another free provider keeps the slot selectable', async () => {
    const { service } = build({
      providers: [
        { id: 5, display_name: 'Pedro', avatar_url: null },
        { id: 6, display_name: 'Ana', avatar_url: null },
      ],
      schedules: [...block(5, '08:00', '18:00'), ...block(6, '08:00', '18:00')],
      bookings: [bookingRow({ product_id: 99 })],
    });
    const s10 = (await service.getAvailableSlots(10, DAY, DAY)).find(
      (s) => s.start_time === '10:00',
    );
    expect(s10).toMatchObject({ total_available: 1, is_booked: false });
    expect(s10?.available_providers.map((p) => p.id)).toEqual([6]);
  });

  it('include_booked=false hides the slot of a provider busy with another service', async () => {
    const { service } = build({ bookings: [bookingRow({ product_id: 99 })] });
    const slots = await service.getAvailableSlots(10, DAY, DAY, { include_booked: false });
    expect(starts(slots)).not.toContain('10:00');
    expect(starts(slots)).toContain('11:00');
  });
});

describe('QUI-966 L20 — no generic provider-less slots for provider_required', () => {
  it('providers exist but none works that day → no slots (no generic fallback)', async () => {
    const { service } = build({ schedules: [] });
    await expect(service.getAvailableSlots(10, DAY, DAY)).resolves.toEqual([]);
  });

  it('requested provider missing while the service has others → no slots', async () => {
    const { service } = build();
    await expect(
      service.getAvailableSlots(10, DAY, DAY, { provider_id: 77 }),
    ).resolves.toEqual([]);
  });

  it('zero active providers keeps the legacy generic fallback', async () => {
    const { service } = build({ providers: [] });
    const slots = await service.getAvailableSlots(10, DAY, DAY);
    expect(slots.length).toBe(10);
    expect(slots.every((s) => s.available_providers.length === 0)).toBe(true);
  });
});

describe('QUI-966 L20 — one "past" rule for both grid routes', () => {
  it('provider route keeps the slot in progress and hides the ended ones', async () => {
    jest.setSystemTime(new Date('2026-10-29T15:02:00.000Z')); // 10:02 Bogota
    const { service } = build();
    const slots = await service.getAvailableSlots(10, '2026-10-29', '2026-10-29');
    expect(starts(slots)[0]).toBe('10:00');
    expect(starts(slots)).not.toContain('09:00');
  });

  it('free_booking route applies the same rule', async () => {
    jest.setSystemTime(new Date('2026-10-29T15:02:00.000Z'));
    const { service } = build({ bookingMode: 'free_booking' });
    const slots = await service.getAvailableSlots(10, '2026-10-29', '2026-10-29');
    expect(starts(slots)[0]).toBe('10:00');
  });
});

// QUI-966 T8 (L21 open item 3): the ecommerce day calendar uses the same
// "past" rule as both grid routes — only slots that already ENDED are gone,
// a slot in progress still counts; slots stay on the block's own grid.
describe('QUI-966 T8 — day overview hides only ended slots', () => {
  const overview = async (
    opts: Parameters<typeof build>[0],
    nowIso: string,
  ) => {
    jest.setSystemTime(new Date(nowIso));
    const { service, prisma } = build(opts);
    prisma.withoutScope = () => prisma;
    const [day] = await service.getDayAvailabilityOverview(
      10,
      '2026-10-29',
      '2026-10-29',
    );
    return day;
  };

  it('provider route counts the slot in progress (10:02 → 10:00..17:00)', async () => {
    const day = await overview({}, '2026-10-29T15:02:00.000Z'); // 10:02 Bogota
    expect(day).toEqual({ date: '2026-10-29', has_slots: true, slots_count: 8 });
  });

  it('free_booking route applies the same rule', async () => {
    const day = await overview(
      { bookingMode: 'free_booking' },
      '2026-10-29T15:02:00.000Z',
    );
    expect(day.has_slots).toBe(true);
    expect(day.slots_count).toBe(8);
  });

  it('the last slot in progress keeps today green; once it ends the day is red', async () => {
    const inProgress = await overview({}, '2026-10-29T22:30:00.000Z'); // 17:30
    expect(inProgress).toEqual({ date: '2026-10-29', has_slots: true, slots_count: 1 });
    const ended = await overview({}, '2026-10-29T23:00:00.000Z'); // 18:00
    expect(ended).toEqual({ date: '2026-10-29', has_slots: false, slots_count: 0 });
  });

  it('a future day is unaffected (all 10 slots)', async () => {
    jest.setSystemTime(new Date('2026-10-29T15:02:00.000Z'));
    const { service, prisma } = build();
    prisma.withoutScope = () => prisma;
    const [day] = await service.getDayAvailabilityOverview(10, DAY, DAY);
    expect(day).toEqual({ date: DAY, has_slots: true, slots_count: 10 });
  });
});
