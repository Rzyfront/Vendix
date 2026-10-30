/**
 * QUI-966 T3 (S5) — free_booking keeps a fixed capacity of 10 seats; every
 * non-cancelled booking that OVERLAPS the range takes one (L2 decision).
 */
process.env.TZ = 'UTC';

import { AvailabilityService, FREE_BOOKING_CAPACITY } from './availability.service';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond === undefined) return true;
    if (cond instanceof Date) {
      return value instanceof Date && value.getTime() === cond.getTime();
    }
    if (cond !== null && typeof cond === 'object') {
      if ('notIn' in cond && cond.notIn.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(value < cond.lt)) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
      return true;
    }
    return value === cond;
  });
}

const DAY = '2026-11-05';

function build(bookings: Row[]) {
  const prisma: any = {
    products: {
      findFirst: jest.fn().mockResolvedValue({
        id: 10,
        store_id: 1,
        booking_mode: 'free_booking',
      }),
    },
    store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
    bookings: {
      count: jest.fn(({ where }: any) =>
        Promise.resolve(bookings.filter((b) => matches(b, where)).length),
      ),
    },
  };
  return new AvailabilityService(prisma, {} as any);
}

const row = (o: Row = {}) => ({
  id: 1,
  product_id: 10,
  provider_id: null,
  date: new Date(`${DAY}T00:00:00.000Z`),
  start_time: '10:00',
  end_time: '11:00',
  status: 'confirmed',
  ...o,
});

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-29T15:00:00.000Z'));
});
afterEach(() => jest.useRealTimers());

describe('AvailabilityService.isSlotAvailable — free_booking capacity (QUI-966 S5)', () => {
  it('capacity is fixed at 10', () => {
    expect(FREE_BOOKING_CAPACITY).toBe(10);
  });

  it('is available with 9 overlapping bookings', async () => {
    const service = build(Array.from({ length: 9 }, (_, i) => row({ id: i + 1 })));
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00')).resolves.toBe(true);
  });

  it('is NOT available when 10 bookings overlap (not only identical start/end)', async () => {
    const service = build(
      Array.from({ length: 10 }, (_, i) =>
        row({ id: i + 1, start_time: i % 2 ? '10:30' : '09:30', end_time: i % 2 ? '11:30' : '10:30' }),
      ),
    );
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00')).resolves.toBe(false);
  });

  it('cancelled and adjacent (end == start) bookings do not take a seat', async () => {
    const service = build([
      ...Array.from({ length: 9 }, (_, i) => row({ id: i + 1 })),
      row({ id: 20, status: 'cancelled' }),
      row({ id: 21, start_time: '11:00', end_time: '12:00' }),
      row({ id: 22, start_time: '09:00', end_time: '10:00' }),
    ]);
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00')).resolves.toBe(true);
  });

  it('a reschedule excludes the booking being moved from the count', async () => {
    const service = build(Array.from({ length: 10 }, (_, i) => row({ id: i + 1 })));
    await expect(service.isSlotAvailable(10, DAY, '10:00', '11:00', undefined, 3)).resolves.toBe(true);
  });
});
