import { RequestContextService } from '@common/context/request-context.service';
import { LodgingPickupService } from './pickup.service';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const night = (date: string, created_at: string) => ({
  night_date: day(date),
  created_at: new Date(created_at),
});

describe('LodgingPickupService (H7.3 pickup and forecast)', () => {
  function build(opts: { nights?: unknown[]; rooms?: number } = {}) {
    const prisma = {
      store_settings: {
        findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
      },
      lodging_units: { count: jest.fn(async () => opts.rooms ?? 4) },
      lodging_room_nights: { findMany: jest.fn(async (_args: any) => opts.nights ?? []) },
    };
    return { service: new LodgingPickupService(prisma as any), prisma };
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
    // 2026-11-10 21:00 in Bogotá is already 2026-11-11 in UTC.
    jest.useFakeTimers().setSystemTime(new Date('2026-11-11T02:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('counts the pickup of the last 7 and 30 days by the created_at of each night', async () => {
    const { service } = build({
      nights: [
        night('2026-11-12', '2026-11-10T20:00:00Z'), // 6 h ago: 7 and 30 days
        night('2026-11-12', '2026-11-04T02:00:00Z'), // exactly 7 days ago: 7 and 30 days
        night('2026-11-12', '2026-11-04T01:59:59Z'), // just older than 7 days: 30 days only
        night('2026-11-12', '2026-10-12T02:00:00Z'), // exactly 30 days ago: 30 days
        night('2026-11-12', '2026-10-01T00:00:00Z'), // older than 30 days: on the books only
      ],
    });

    const result = await service.get({ days: 3 });
    const target = result.days.find((d) => d.stay_date === '2026-11-12')!;

    expect(target).toEqual({
      stay_date: '2026-11-12',
      rooms: 4,
      on_books: 5,
      pickup_7: 2,
      pickup_30: 4,
      projected_occupancy_pct: 125,
    });
    expect(result.totals).toMatchObject({ on_books: 5, pickup_7: 2, pickup_30: 4 });
  });

  it('covers the next N stay dates from the store today, with empty days at zero', async () => {
    const { service, prisma } = build({ rooms: 2, nights: [night('2026-11-10', '2026-11-09T00:00:00Z')] });

    const result = await service.get({});

    expect(result.from).toBe('2026-11-10');
    expect(result.to).toBe('2027-02-07');
    expect(result.days).toHaveLength(90);
    expect(result.days[0]).toMatchObject({ stay_date: '2026-11-10', on_books: 1, projected_occupancy_pct: 50 });
    expect(result.days[1]).toMatchObject({ on_books: 0, pickup_7: 0, projected_occupancy_pct: 0 });
    expect(result.totals).toMatchObject({ rooms: 180, on_books: 1, projected_occupancy_pct: 0.56 });

    const where = prisma.lodging_room_nights.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      is_active: true,
      night_date: { gte: day('2026-11-10'), lte: day('2027-02-07') },
      reservation_room: { cancelled_at: null, reservation: { status: { in: ['confirmed', 'checked_in'] } } },
    });
  });

  it('gives a null projected occupancy, never a division by zero, without active rooms', async () => {
    const { service } = build({ rooms: 0 });

    const result = await service.get({ days: 1 });

    expect(result.days[0].projected_occupancy_pct).toBeNull();
    expect(result.totals.projected_occupancy_pct).toBeNull();
  });

  it('rejects a horizon outside 1..365 days', async () => {
    const { service } = build();

    await expect(service.get({ days: 0 })).rejects.toMatchObject({
      errorCode: 'LODGING_PICKUP_RANGE_001',
    });
    await expect(service.get({ days: 366 })).rejects.toMatchObject({
      errorCode: 'LODGING_PICKUP_RANGE_001',
    });
  });
});
