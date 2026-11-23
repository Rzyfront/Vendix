import { createScheduledRemindersFake } from '../../../../testing/scheduled-reminders.fake';
import {
  ReminderScheduler,
  ReminderSyncInput,
  digestInstantFor,
  planDueReminders,
} from './reminder-scheduler.service';

const STORE = 10;
const OTHER_STORE = 20;
const NOW = new Date('2026-11-23T14:00:00Z'); // 9:00 a. m. en Bogotá
const DUE = new Date('2026-11-24T20:00:00Z'); // mañana 3:00 p. m. en Bogotá
const HOUR = 60 * 60 * 1000;

function setup(settings: Record<string, unknown> = {}, timezone: string | null = 'America/Bogota') {
  const fake = createScheduledRemindersFake(() => NOW);
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async (..._args: any[]) => ({ settings, stores: { timezone } })),
    },
    scheduled_reminders: fake.table,
  };
  const scheduler = new ReminderScheduler(prisma as any);
  return { scheduler, prisma, rows: fake.rows };
}

function input(overrides: Partial<ReminderSyncInput> = {}): ReminderSyncInput {
  return {
    source_type: 'crm_task',
    source_id: 50,
    store_id: STORE,
    due_at: DUE,
    status: 'pending',
    recipients: { notify: [2], escalate: [1] },
    ...overrides,
  };
}

const live = (rows: ReturnType<typeof setup>['rows']) =>
  rows
    .filter((row) => row.status === 'pending')
    .map((row) => `${row.kind}@${row.fire_at.toISOString()}`)
    .sort();

describe('ReminderScheduler.sync', () => {
  it('a task with a date gets due soon (60 min before), due and the 24 h escalation', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input(), NOW);
    expect(live(rows)).toEqual([
      'due@2026-11-24T20:00:00.000Z',
      'due_soon@2026-11-24T19:00:00.000Z',
      'overdue_escalation@2026-11-25T20:00:00.000Z',
    ]);
    expect(rows.every((row) => row.store_id === STORE && row.source_id === 50)).toBe(true);
  });

  it('uses the store minutes; an out-of-range value falls back to 60', async () => {
    const custom = setup({ notifications: { task_due_soon_minutes: 30 } });
    await custom.scheduler.sync(input(), NOW);
    expect(live(custom.rows)).toContain('due_soon@2026-11-24T19:30:00.000Z');

    const broken = setup({ notifications: { task_due_soon_minutes: 2 } });
    await broken.scheduler.sync(input(), NOW);
    expect(live(broken.rows)).toContain('due_soon@2026-11-24T19:00:00.000Z');
  });

  it('a date whose "due soon" already passed only schedules due', async () => {
    const { scheduler, rows } = setup();
    const soon = new Date(NOW.getTime() + 20 * 60 * 1000);
    await scheduler.sync(input({ due_at: soon, recipients: { notify: [2], escalate: [] } }), NOW);
    expect(live(rows)).toEqual([`due@${soon.toISOString()}`]);
  });

  it('a date that expired more than 24 h ago schedules nothing (no avalanche)', async () => {
    const { scheduler, rows } = setup();
    const old = new Date(NOW.getTime() - 50 * HOUR);
    await scheduler.sync(input({ due_at: old }), NOW);
    expect(live(rows)).toEqual([]);
  });

  it('without a creator to escalate to there is no escalation', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input({ recipients: { notify: [2], escalate: [] } }), NOW);
    expect(live(rows).some((r) => r.startsWith('overdue_escalation'))).toBe(false);
  });

  it('changing the date cancels the old reminders and schedules the new ones', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input(), NOW);
    const moved = new Date('2026-11-26T15:00:00Z');
    const result = await scheduler.sync(input({ due_at: moved }), NOW);
    expect(result.cancelled).toBe(3);
    expect(live(rows)).toEqual([
      'due@2026-11-26T15:00:00.000Z',
      'due_soon@2026-11-26T14:00:00.000Z',
      'overdue_escalation@2026-11-27T15:00:00.000Z',
    ]);
    expect(rows.filter((row) => row.status === 'cancelled')).toHaveLength(3);
  });

  it.each(['done', 'cancelled', 'deleted'] as const)(
    'a %s task cancels its pending reminders',
    async (status) => {
      const { scheduler, rows } = setup();
      await scheduler.sync(input(), NOW);
      const result = await scheduler.sync(input({ status }), NOW);
      expect(result).toEqual({ scheduled: [], cancelled: 3 });
      expect(live(rows)).toEqual([]);
    },
  );

  it('removing the date cancels its pending reminders', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input(), NOW);
    await scheduler.sync(input({ due_at: null }), NOW);
    expect(live(rows)).toEqual([]);
  });

  it('closing never touches reminders already sent', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input(), NOW);
    rows[0].status = 'sent';
    await scheduler.sync(input({ status: 'done' }), NOW);
    expect(rows[0].status).toBe('sent');
  });

  it('reopening re-arms the cancelled reminders; a sent one is never repeated', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input(), NOW);
    const soon = rows.find((row) => row.kind === 'due_soon')!;
    soon.status = 'sent';
    await scheduler.sync(input({ status: 'done' }), NOW);
    await scheduler.sync(input(), NOW);
    expect(soon.status).toBe('sent');
    expect(live(rows)).toEqual([
      'due@2026-11-24T20:00:00.000Z',
      'overdue_escalation@2026-11-25T20:00:00.000Z',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.attempts === 0)).toBe(true);
  });

  it('running it twice with the same task changes nothing', async () => {
    const { scheduler, rows } = setup();
    await scheduler.sync(input({ digest: true }), NOW);
    const snapshot = rows.map((row) => ({ ...row }));
    const result = await scheduler.sync(input({ digest: true }), NOW);
    expect(result.cancelled).toBe(0);
    expect(rows).toEqual(snapshot);
  });

  it('the store of each row is the one of the source, read for its own settings', async () => {
    const { scheduler, prisma, rows } = setup();
    await scheduler.sync(input({ store_id: OTHER_STORE, digest: true }), NOW);
    expect(prisma.store_settings.findFirst.mock.calls[0][0]).toMatchObject({
      where: { store_id: OTHER_STORE },
    });
    expect(rows.every((row) => row.store_id === OTHER_STORE)).toBe(true);
  });

  describe('daily digest', () => {
    it('one row per store and local day, at the digest hour in the store timezone', async () => {
      const { scheduler, rows } = setup();
      await scheduler.sync(input({ digest: true }), NOW);
      await scheduler.sync(input({ source_id: 51, digest: true }), NOW);
      const digests = rows.filter((row) => row.kind === 'digest');
      expect(digests).toHaveLength(1);
      expect(digests[0]).toMatchObject({
        source_type: 'crm_task_digest',
        source_id: STORE,
        store_id: STORE,
        fire_at: new Date('2026-11-24T12:00:00Z'), // 7:00 a. m. en Bogotá
      });
    });

    it('follows the store hour and timezone', async () => {
      const { scheduler, rows } = setup({ notifications: { daily_digest_hour: 9 } }, 'Europe/Madrid');
      await scheduler.sync(input({ digest: true }), NOW);
      // 2026-11-24T20:00Z is 21:00 in Madrid (UTC+1) → 09:00 local = 08:00Z.
      expect(rows.find((row) => row.kind === 'digest')?.fire_at).toEqual(
        new Date('2026-11-24T08:00:00Z'),
      );
    });

    it('a task due today after the digest already went out does not create another one', async () => {
      const { scheduler, rows } = setup();
      await scheduler.sync(input({ due_at: new Date('2026-11-23T22:00:00Z'), digest: true }), NOW);
      expect(rows.some((row) => row.kind === 'digest')).toBe(false);
    });

    it('closing a task never cancels the shared digest of the day', async () => {
      const { scheduler, rows } = setup();
      await scheduler.sync(input({ digest: true }), NOW);
      await scheduler.sync(input({ status: 'done', digest: true }), NOW);
      expect(rows.find((row) => row.kind === 'digest')?.status).toBe('pending');
    });
  });
});

describe('planDueReminders', () => {
  it('nobody to notify plans no due soon nor due', () => {
    expect(
      planDueReminders(
        { due_at: DUE, recipients: { notify: [], escalate: [] } },
        { due_soon_minutes: 60 },
        NOW,
      ),
    ).toEqual([]);
  });

  it('a date that expired 30 h ago keeps only the escalation still in its window', () => {
    const due = new Date(NOW.getTime() - 30 * HOUR);
    expect(
      planDueReminders(
        { due_at: due, recipients: { notify: [2], escalate: [1] } },
        { due_soon_minutes: 60 },
        NOW,
      ),
    ).toEqual([{ kind: 'overdue_escalation', fire_at: new Date(due.getTime() + 24 * HOUR) }]);
  });
});

describe('digestInstantFor', () => {
  it('maps any instant of the local day to that day at the digest hour', () => {
    const settings = { digest_hour: 7, timezone: 'America/Bogota' };
    // 2026-11-24T03:00Z is still 23 Nov 10:00 p. m. in Bogotá.
    expect(digestInstantFor(new Date('2026-11-24T03:00:00Z'), settings)).toEqual(
      new Date('2026-11-23T12:00:00Z'),
    );
    expect(digestInstantFor(new Date('2026-11-24T20:00:00Z'), settings)).toEqual(
      new Date('2026-11-24T12:00:00Z'),
    );
  });
});
