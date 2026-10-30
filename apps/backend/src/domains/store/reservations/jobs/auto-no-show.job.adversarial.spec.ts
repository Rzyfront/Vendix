/**
 * Adversarial QA spec for AutoNoShowJob. Assertions describe the CORRECT
 * business behavior; a failing test is a finding.
 * Process TZ forced to UTC (backend container); store TZ America/Bogota.
 */
// Run with `TZ=UTC` in the environment to mirror the backend container;
// assigning process.env.TZ here is too late for the jest worker.
process.env.TZ = 'UTC';

import { AutoNoShowJob } from './auto-no-show.job';
import { ReservationsService } from '../reservations.service';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond instanceof Date) return value?.getTime?.() === cond.getTime();
    if (cond !== null && typeof cond === 'object') {
      const v = value instanceof Date ? value.getTime() : value;
      const n = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('lt' in cond && !(v < n(cond.lt))) return false;
      if ('lte' in cond && !(v <= n(cond.lte))) return false;
      if ('gt' in cond && !(v > n(cond.gt))) return false;
      return true;
    }
    return value === cond;
  });
}

function build(bookings: Row[]) {
  const prisma: any = {
    stores: { findMany: jest.fn().mockResolvedValue([{ id: 1 }]) },
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      }),
    },
    bookings: {
      findMany: jest.fn(({ where, take, orderBy }: any) => {
        let rows = bookings.filter((b) => matches(b, where));
        if (orderBy?.id === 'asc') rows = [...rows].sort((a, b) => a.id - b.id);
        return Promise.resolve(rows.slice(0, take));
      }),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(bookings.find((b) => b.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const t = bookings.find((b) => b.id === where.id)!;
        Object.assign(t, data);
        return Promise.resolve(t);
      }),
    },
  };
  const reservations = new ReservationsService(
    prisma,
    {} as any,
    {} as any,
    { signUrl: jest.fn((u: string) => Promise.resolve(u)) } as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
    { record: jest.fn() } as any,
  );
  const runner: any = { runInStoreContext: (_id: number, fn: () => any) => fn() };
  return { job: new AutoNoShowJob(prisma, reservations, runner) };
}

const row = (o: Row) => ({
  id: 1,
  store_id: 1,
  status: 'confirmed',
  start_time: '09:00',
  end_time: '10:00',
  ...o,
});

afterEach(() => jest.useRealTimers());
function at(iso: string) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(iso));
}

describe('AutoNoShowJob (adversarial)', () => {
  it('archives an overdue CONFIRMED booking from yesterday', async () => {
    at('2026-10-29T15:00:00.000Z'); // 10:00 Bogota
    const b = row({ date: new Date('2026-10-28T00:00:00Z') });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('no_show');
  });

  it('archives an overdue PENDING booking from yesterday (job contract: pending|confirmed → no_show)', async () => {
    at('2026-10-29T15:00:00.000Z');
    const b = row({ status: 'pending', date: new Date('2026-10-28T00:00:00Z') });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('no_show');
  });

  it('does not touch an already checked-in (arriving) booking', async () => {
    at('2026-10-29T15:00:00.000Z');
    const b = row({ status: 'arriving', date: new Date('2026-10-28T00:00:00Z') });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('arriving');
  });

  it('archives a booking from EARLIER TODAY once end_time + 2h grace has passed', async () => {
    at('2026-10-29T19:00:00.000Z'); // 14:00 Bogota; booking ended 10:00 → grace ended 12:00
    const b = row({ date: new Date('2026-10-29T00:00:00Z') });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('no_show');
  });

  it('respects the 2h grace in STORE time for a late-night booking (23:00–23:30 Bogota)', async () => {
    // Now: 00:30 Bogota on the 29th (05:30Z). Booking ended 23:30 Bogota on
    // the 28th (04:30Z) → grace ends 01:30 Bogota (06:30Z). Must NOT archive yet.
    at('2026-10-29T05:30:00.000Z');
    const b = row({
      date: new Date('2026-10-28T00:00:00Z'),
      start_time: '23:00',
      end_time: '23:30',
    });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('confirmed');
  });

  it('stale pending bookings beyond the 100 cap do not starve confirmed ones', async () => {
    at('2026-10-29T15:00:00.000Z');
    const rows: Row[] = Array.from({ length: 100 }, (_, i) =>
      row({ id: i + 1, status: 'pending', date: new Date('2026-10-20T00:00:00Z') }),
    );
    const confirmed = row({ id: 500, date: new Date('2026-10-28T00:00:00Z') });
    rows.push(confirmed);
    const { job } = build(rows);
    await job.archive();
    await job.archive();
    expect(confirmed.status).toBe('no_show');
  });

  it('today bookings still inside the grace do not starve an overdue one in the same tick', async () => {
    at('2026-10-29T15:00:00.000Z'); // 10:00 Bogota
    const rows: Row[] = Array.from({ length: 150 }, (_, i) =>
      row({ id: i + 1, date: new Date('2026-10-29T00:00:00Z'), start_time: '16:00', end_time: '17:00' }),
    );
    const overdue = row({ id: 500, date: new Date('2026-10-28T00:00:00Z') });
    rows.push(overdue);
    const { job } = build(rows);
    await job.archive();
    expect(overdue.status).toBe('no_show');
    expect(rows.filter((b) => b.status === 'confirmed')).toHaveLength(150);
  });

  it('does not archive a future booking', async () => {
    at('2026-10-29T15:00:00.000Z');
    const b = row({ date: new Date('2026-10-30T00:00:00Z'), start_time: '08:00', end_time: '09:00' });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('confirmed');
  });

  it('closes an overdue expired ecommerce hold as cancelled, not no_show', async () => {
    at('2026-10-29T15:00:00.000Z');
    const b = row({
      status: 'pending',
      date: new Date('2026-10-28T00:00:00Z'),
      expires_at: new Date('2026-10-27T20:15:00Z'),
    });
    const { job } = build([b]);
    await job.archive();
    expect(b.status).toBe('cancelled');
  });
});
