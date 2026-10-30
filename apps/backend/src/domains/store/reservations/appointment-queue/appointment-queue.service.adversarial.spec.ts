/**
 * Adversarial QA spec for AppointmentQueueService. Assertions describe the
 * CORRECT business behavior (per the service's own contract); a failing test
 * is a finding. Run with `TZ=UTC` to mirror the backend container.
 *
 * QUI-966 T6: `bookings` has no `starts_at` column (the original QA test
 * asserted it existed). The appointment start is `date` + `start_time` read
 * in the store timezone (America/Bogota here), so the fixtures carry those
 * columns and the queue filters by the store's civil `date`.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppointmentQueueService } from './appointment-queue.service';

type Row = Record<string, any>;

function build(rows: Row[]) {
  const findMany = jest.fn(({ where }: any) => {
    const out = rows.filter(
      (r) =>
        r.date.getTime() === where.date.getTime() &&
        where.status.in.includes(r.status) &&
        r.arrival_at != null,
    );
    // The service must rank in app; emulate a DB returning arrival order.
    return Promise.resolve(
      [...out].sort((a, b) => a.arrival_at.getTime() - b.arrival_at.getTime()),
    );
  });
  const prisma: any = {
    bookings: { findMany },
    store_settings: {
      findFirst: jest.fn().mockResolvedValue({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      }),
    },
  };
  const notifications: any = { createAndBroadcast: jest.fn() };
  return { svc: new AppointmentQueueService(prisma, notifications), findMany };
}

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const r = (o: Row) => ({
  booking_number: `BKG-${o.id}`,
  customer_id: o.id,
  provider_id: 5,
  status: 'arriving',
  priority: 0,
  date: day('2026-10-29'),
  created_at: new Date('2026-10-29T10:00:00Z'),
  ...o,
});

afterEach(() => jest.useRealTimers());

describe('AppointmentQueueService (adversarial)', () => {
  it('only queries columns that exist on the bookings model', async () => {
    const { svc, findMany } = build([]);
    await svc.computeQueueForStore(1, '2026-10-29');
    const columns = Object.keys(Prisma.BookingsScalarFieldEnum);
    const { where, select, orderBy } = findMany.mock.calls[0][0];
    for (const key of Object.keys(where)) expect(columns).toContain(key);
    for (const key of Object.keys(select)) expect(columns).toContain(key);
    for (const o of [orderBy ?? []].flat()) {
      for (const key of Object.keys(o)) expect(columns).toContain(key);
    }
    expect(columns).not.toContain('starts_at');
  });

  it('ranks by |appointment start - arrival_at| (contract), not by raw arrival order', async () => {
    const { svc } = build([
      // 11:00 Bogota (16:00Z) appointment that arrived 2h early (score 2h)
      r({ id: 1, start_time: '11:00', arrival_at: new Date('2026-10-29T14:00:00Z') }),
      // 09:30 Bogota (14:30Z) appointment that arrived 5 min early (score 5m)
      r({ id: 2, start_time: '09:30', arrival_at: new Date('2026-10-29T14:25:00Z') }),
    ]);
    const ranked = await svc.computeQueueForStore(1, '2026-10-29');
    expect(ranked.map((x) => x.booking_id)).toEqual([2, 1]);
    expect(ranked[0].starts_at.toISOString()).toBe('2026-10-29T14:30:00.000Z');
    expect(ranked[0].score).toBe(5 * 60_000);
  });

  it('manual priority breaks ties between equal scores (lower = sooner)', async () => {
    const { svc } = build([
      r({ id: 1, priority: 5, start_time: '10:00', arrival_at: new Date('2026-10-29T14:50:00Z') }),
      r({ id: 2, priority: 1, start_time: '10:30', arrival_at: new Date('2026-10-29T15:20:00Z') }),
    ]);
    const ranked = await svc.computeQueueForStore(1, '2026-10-29');
    expect(ranked.map((x) => x.booking_id)).toEqual([2, 1]);
  });

  it('equal score and priority keep a stable FIFO order (created_at, then id)', async () => {
    const { svc } = build([
      r({ id: 7, start_time: '10:00', arrival_at: new Date('2026-10-29T14:50:00Z'), created_at: new Date('2026-10-29T12:00:00Z') }),
      r({ id: 3, start_time: '10:30', arrival_at: new Date('2026-10-29T15:20:00Z'), created_at: new Date('2026-10-29T11:00:00Z') }),
      r({ id: 4, start_time: '10:30', arrival_at: new Date('2026-10-29T15:20:00Z'), created_at: new Date('2026-10-29T11:00:00Z') }),
    ]);
    const first = await svc.computeQueueForStore(1, '2026-10-29');
    const second = await svc.computeQueueForStore(1, '2026-10-29');
    expect(first.map((x) => x.booking_id)).toEqual([3, 4, 7]);
    expect(second.map((x) => x.booking_id)).toEqual([3, 4, 7]);
  });

  it('includes a 19:30 Bogota appointment (00:30Z next day) in that Bogota day queue', async () => {
    const { svc } = build([
      r({ id: 3, start_time: '19:30', arrival_at: new Date('2026-10-30T00:20:00Z') }),
    ]);
    const ranked = await svc.computeQueueForStore(1, '2026-10-29');
    expect(ranked.map((x) => x.booking_id)).toEqual([3]);
    expect(ranked[0].starts_at.toISOString()).toBe('2026-10-30T00:30:00.000Z');
  });

  it('without a day, uses the store day: at 20:00 Bogota (01:00Z) it is still the 29th', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-10-30T01:00:00.000Z'));
    const { svc, findMany } = build([]);
    await svc.computeQueueForStore(1);
    expect(findMany.mock.calls[0][0].where.date.toISOString()).toBe(
      '2026-10-29T00:00:00.000Z',
    );
  });

  it('rejects a malformed day with 400', async () => {
    const { svc } = build([]);
    await expect(svc.computeQueueForStore(1, '2026-10-29T05:00')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
