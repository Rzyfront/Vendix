import { RequestContextService } from '@common/context/request-context.service';
import { lodgingKpis } from './lodging-kpis';
import { LodgingPerformanceService } from './performance.service';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);
const night = (date: string, total_price: number | null, cancelled = false) => ({
  night_date: day(date),
  posted_order_item: total_price === null ? null : { total_price, cancelled_at: cancelled ? new Date() : null },
});

describe('lodgingKpis (H7.2 formulas)', () => {
  it('occupancy = sold / available, ADR = revenue / sold, RevPAR = revenue / available', () => {
    expect(lodgingKpis(3, 4, 600000)).toEqual({ occupancy_pct: 75, adr: 200000, revpar: 150000 });
  });

  it('gives null, never 0 or Infinity, when a denominator is zero', () => {
    expect(lodgingKpis(0, 4, 0)).toEqual({ occupancy_pct: 0, adr: null, revpar: 0 });
    expect(lodgingKpis(0, 0, 0)).toEqual({ occupancy_pct: null, adr: null, revpar: null });
  });

  it('rounds only the emitted ratio', () => {
    expect(lodgingKpis(1, 3, 100)).toEqual({ occupancy_pct: 33.33, adr: 100, revpar: 33.33 });
  });
});

describe('LodgingPerformanceService (H7.2 occupancy, ADR and RevPAR)', () => {
  function build(opts: { audits?: unknown[]; nights?: unknown[]; rooms?: number } = {}) {
    const prisma = {
      store_settings: {
        findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
      },
      lodging_night_audits: { findMany: jest.fn(async () => opts.audits ?? []) },
      lodging_units: { count: jest.fn(async () => opts.rooms ?? 4) },
      lodging_room_nights: { findMany: jest.fn(async (_args: any) => opts.nights ?? []) },
    };
    return { service: new LodgingPerformanceService(prisma as any), prisma };
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

  it('uses the night audit snapshot for a closed day and the live nights otherwise', async () => {
    const { service, prisma } = build({
      audits: [
        {
          business_date: day('2026-11-08'),
          summary: { rooms_total: 5, rooms_occupied: 2, room_revenue: '300000.00' },
        },
      ],
      nights: [night('2026-11-09', 200000), night('2026-11-09', 100000, true), night('2026-11-09', null)],
    });

    const result = await service.get({ from: '2026-11-08', to: '2026-11-09' });

    expect(result.days).toEqual([
      {
        period: '2026-11-08',
        closed: true,
        nights_available: 5,
        nights_sold: 2,
        room_revenue: 300000,
        occupancy_pct: 40,
        adr: 150000,
        revpar: 60000,
      },
      {
        period: '2026-11-09',
        closed: false,
        nights_available: 4,
        nights_sold: 3,
        room_revenue: 200000,
        occupancy_pct: 75,
        adr: 66666.67,
        revpar: 50000,
      },
    ]);
    // Closed days are not read again from the live nights.
    expect(prisma.lodging_room_nights.findMany.mock.calls[0][0].where.night_date.notIn).toEqual([
      day('2026-11-08'),
    ]);
    expect(result.totals).toEqual(
      expect.objectContaining({ nights_available: 9, nights_sold: 5, room_revenue: 500000, adr: 100000 }),
    );
  });

  it('a day without sold nights shows ADR null and occupancy 0', async () => {
    const { service } = build();

    const result = await service.get({ from: '2026-11-01', to: '2026-11-01' });

    expect(result.days[0]).toEqual(
      expect.objectContaining({ nights_sold: 0, occupancy_pct: 0, adr: null, revpar: 0 }),
    );
  });

  it('a hotel without rooms shows every KPI as null', async () => {
    const { service } = build({ rooms: 0 });

    const result = await service.get({ from: '2026-11-01', to: '2026-11-01' });

    expect(result.totals).toEqual(expect.objectContaining({ occupancy_pct: null, adr: null, revpar: null }));
  });

  it('groups the days by month from the summed nights and revenue', async () => {
    const { service } = build({
      rooms: 2,
      nights: [night('2026-10-31', 100000), night('2026-11-01', 300000), night('2026-11-01', 100000)],
    });

    const result = await service.get({ from: '2026-10-31', to: '2026-11-01' });

    expect(result.months).toEqual([
      expect.objectContaining({ period: '2026-10', nights_available: 2, nights_sold: 1, occupancy_pct: 50, adr: 100000 }),
      expect.objectContaining({ period: '2026-11', nights_available: 2, nights_sold: 2, occupancy_pct: 100, adr: 200000 }),
    ]);
  });

  it('defaults to the store month up to the store today and never goes past it', async () => {
    const { service } = build();

    expect(await service.get({})).toEqual(
      expect.objectContaining({ from: '2026-11-01', to: '2026-11-10', timezone: 'America/Bogota' }),
    );
    const capped = await service.get({ from: '2026-11-09', to: '2026-12-31' });
    expect(capped.to).toBe('2026-11-10');
    expect(capped.days.map((d) => d.period)).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('rejects an inverted range or one longer than 366 days', async () => {
    const { service } = build();

    await expect(service.get({ from: '2026-11-05', to: '2026-11-01' })).rejects.toMatchObject({
      errorCode: 'LODGING_PERFORMANCE_RANGE_001',
    });
    await expect(service.get({ from: '2025-01-01', to: '2026-11-01' })).rejects.toMatchObject({
      errorCode: 'LODGING_PERFORMANCE_RANGE_001',
    });
  });
});
