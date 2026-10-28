import { RequestContextService } from '@common/context/request-context.service';
import { LodgingCancellationsService } from './cancellations.service';

const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

function event(opts: {
  id: number;
  to_status: 'cancelled' | 'no_show';
  created_at: string;
  web?: boolean;
  total?: string;
  penalty?: string | null;
  reason?: string | null;
}) {
  return {
    id: opts.id,
    to_status: opts.to_status,
    reason: opts.reason ?? null,
    created_at: new Date(opts.created_at),
    reservation: {
      id: 100 + opts.id,
      reservation_number: `R-${opts.id}`,
      arrival_date: day('2026-11-20'),
      departure_date: day('2026-11-23'),
      total_amount: opts.total ?? '300000',
      cancellation_penalty_amount: opts.penalty === undefined ? '100000' : opts.penalty,
      cancellation_penalty_detail: opts.penalty === null ? null : '1 noche',
      customer: { first_name: 'Ana', last_name: 'Pérez' },
      events: opts.web ? [{ to_status: 'tentative' }] : [{ to_status: 'confirmed' }],
    },
  };
}

describe('LodgingCancellationsService (H7.4 no-shows and cancellations)', () => {
  function build(events: unknown[] = []) {
    const prisma = {
      store_settings: {
        findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
      },
      lodging_reservation_events: { findMany: jest.fn(async (_args: any) => events) },
    };
    return { service: new LodgingCancellationsService(prisma as any), prisma };
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

  it('lists each cancellation and no-show with its channel, nights, value and penalty, plus the totals', async () => {
    const { service } = build([
      event({ id: 1, to_status: 'cancelled', created_at: '2026-11-05T15:00:00Z', web: true }),
      event({ id: 2, to_status: 'no_show', created_at: '2026-11-03T12:00:00Z', total: '450000.50', penalty: '150000.25' }),
      event({ id: 3, to_status: 'cancelled', created_at: '2026-11-02T12:00:00Z', penalty: null, reason: 'Cambio de planes' }),
    ]);

    const report = await service.get({});

    expect(report.rows).toEqual([
      expect.objectContaining({
        reservation_number: 'R-1',
        type: 'cancelled',
        channel: 'web',
        guest_name: 'Ana Pérez',
        occurred_on: '2026-11-05',
        arrival_date: '2026-11-20',
        departure_date: '2026-11-23',
        nights: 3,
        total_amount: 300000,
        penalty_amount: 100000,
        penalty_detail: '1 noche',
      }),
      expect.objectContaining({ reservation_number: 'R-2', type: 'no_show', channel: 'front_desk', total_amount: 450000.5, penalty_amount: 150000.25 }),
      expect.objectContaining({ reservation_number: 'R-3', penalty_amount: 0, penalty_detail: null, reason: 'Cambio de planes' }),
    ]);
    expect(report.totals).toEqual({
      cancellations: 2,
      no_shows: 1,
      lost_amount: 1050000.5,
      penalty_amount: 250000.25,
    });
  });

  it('reports the event day in the store time zone, not UTC', async () => {
    // 2026-11-06 03:00 UTC is still 2026-11-05 22:00 in Bogotá.
    const { service } = build([event({ id: 1, to_status: 'no_show', created_at: '2026-11-06T03:00:00Z' })]);
    const report = await service.get({});
    expect(report.rows[0].occurred_on).toBe('2026-11-05');
  });

  it('defaults to the store month up to the store today and queries firm reservations only', async () => {
    const { service, prisma } = build();
    const report = await service.get({});
    expect(report.from).toBe('2026-11-01');
    expect(report.to).toBe('2026-11-10');
    const where = prisma.lodging_reservation_events.findMany.mock.calls[0][0].where;
    expect(where.to_status).toEqual({ in: ['cancelled', 'no_show'] });
    // An unpaid web hold that expires is not a lost booking.
    expect(where.from_status).toEqual({ in: ['confirmed', 'checked_in'] });
    // Store-local bounds: Bogotá is UTC-5.
    expect(where.created_at).toEqual({
      gte: new Date('2026-11-01T05:00:00.000Z'),
      lt: new Date('2026-11-11T05:00:00.000Z'),
    });
    expect(where.reservation).toBeUndefined();
  });

  it('filters by channel and by event type in the query', async () => {
    const { service, prisma } = build();
    await service.get({ from: '2026-10-01', to: '2026-10-31', channel: 'web', type: 'no_show' });
    let where = prisma.lodging_reservation_events.findMany.mock.calls[0][0].where;
    expect(where.to_status).toEqual({ in: ['no_show'] });
    expect(where.reservation).toEqual({ events: { some: { from_status: null, to_status: 'tentative' } } });
    expect(where.created_at.lt).toEqual(new Date('2026-11-01T05:00:00.000Z'));

    await service.get({ channel: 'front_desk' });
    where = prisma.lodging_reservation_events.findMany.mock.calls[1][0].where;
    expect(where.reservation).toEqual({ events: { none: { from_status: null, to_status: 'tentative' } } });
  });

  it('rejects an inverted or too long range', async () => {
    const { service } = build();
    await expect(service.get({ from: '2026-11-05', to: '2026-11-01' })).rejects.toMatchObject({
      errorCode: 'LODGING_LOSSES_RANGE_001',
    });
    await expect(service.get({ from: '2024-01-01', to: '2026-11-01' })).rejects.toMatchObject({
      errorCode: 'LODGING_LOSSES_RANGE_001',
    });
  });
});
