import { Logger } from '@nestjs/common';
import { createScheduledRemindersFake } from '../../../../testing/scheduled-reminders.fake';
import { REMINDER_LOOKBACK_MS } from './reminder-scheduler.service';
import {
  ClaimedReminder,
  ReminderResolution,
  ReminderSourceRegistry,
} from './reminder-source.registry';
import {
  REMINDER_BATCH,
  REMINDER_LEASE_MINUTES,
  REMINDER_MAX_ATTEMPTS,
  ScheduledRemindersJob,
} from './scheduled-reminders.job';

const STORE = 10;
const NOW = new Date('2026-11-23T14:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

function setup(resolve?: (reminder: ClaimedReminder) => Promise<ReminderResolution>) {
  let clock = NOW;
  const fake = createScheduledRemindersFake(() => clock);
  const queries: Array<{ sql: string }> = [];
  const prisma = {
    scheduled_reminders: fake.table,
    $queryRaw: jest.fn(async (query: { sql: string }) => {
      queries.push(query);
      return fake.claim(clock, {
        lookbackMs: REMINDER_LOOKBACK_MS,
        maxAttempts: REMINDER_MAX_ATTEMPTS,
        leaseMs: REMINDER_LEASE_MINUTES * MINUTE,
        batch: REMINDER_BATCH,
      });
    }),
  };
  const handler = {
    source_types: ['crm_task'] as const,
    resolve: jest.fn(
      resolve ??
        (async (reminder: ClaimedReminder): Promise<ReminderResolution> => ({
          action: 'notify',
          notifications: [
            {
              store_id: reminder.store_id,
              user_ids: [2],
              type: 'crm_task_due',
              title: 'Tarea vencida',
              body: 'Llamar a Laura',
              dedupe_key: `crm_task:${reminder.source_id}:${reminder.kind}:${reminder.fire_at.toISOString()}`,
            },
          ],
        })),
    ),
  };
  const registry = new ReminderSourceRegistry();
  registry.register(handler);
  const dispatcher = { notify: jest.fn(async (..._args: any[]) => undefined) };
  const job = new ScheduledRemindersJob(prisma as any, registry, dispatcher as any);

  const add = (fire_at: Date, overrides: Record<string, unknown> = {}) =>
    fake.table.createMany({
      data: [
        {
          store_id: STORE,
          source_type: 'crm_task',
          source_id: 50,
          kind: 'due',
          fire_at,
          ...overrides,
        },
      ],
    });
  const run = (when: Date) => {
    clock = when;
    return job.run(when);
  };
  return { job, run, add, rows: fake.rows, handler, dispatcher, queries };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('ScheduledRemindersJob', () => {
  it('fires what is due through the dispatcher and marks it sent', async () => {
    const { run, add, rows, dispatcher } = setup();
    await add(at(-MINUTE));
    const result = await run(NOW);
    expect(result).toEqual({ sent: 1, skipped: 0, retried: 0, expired: 0 });
    expect(dispatcher.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE,
        user_ids: [2],
        dedupe_key: `crm_task:50:due:${at(-MINUTE).toISOString()}`,
      }),
    );
    expect(rows[0].status).toBe('sent');
  });

  it('leaves the future alone', async () => {
    const { run, add, rows, handler } = setup();
    await add(at(5 * MINUTE));
    await run(NOW);
    expect(handler.resolve).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('a task already resolved or re-dated is skipped, with no notice', async () => {
    const { run, add, rows, dispatcher } = setup(async () => ({
      action: 'skip',
      reason: 'Due date changed',
    }));
    await add(at(-MINUTE));
    const result = await run(NOW);
    expect(result.skipped).toBe(1);
    expect(dispatcher.notify).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'skipped', last_error: 'Due date changed' });
  });

  it('only looks 24 h back: anything older is skipped, never sent', async () => {
    const { run, add, rows, handler, dispatcher } = setup();
    await add(at(-25 * HOUR), { source_id: 1 });
    await add(at(-23 * HOUR), { source_id: 2 });
    const result = await run(NOW);
    expect(result).toMatchObject({ expired: 1, sent: 1 });
    expect(rows.find((row) => row.source_id === 1)).toMatchObject({
      status: 'skipped',
      last_error: 'Missed the 24 h delivery window',
    });
    expect(handler.resolve).toHaveBeenCalledTimes(1);
    expect(dispatcher.notify).toHaveBeenCalledTimes(1);
  });

  it('two runs never send the same reminder twice', async () => {
    const { run, add, dispatcher } = setup();
    await add(at(-MINUTE), { source_id: 1 });
    await add(at(-2 * MINUTE), { source_id: 2 });
    await run(NOW);
    const second = await run(at(MINUTE));
    expect(second).toEqual({ sent: 0, skipped: 0, retried: 0, expired: 0 });
    expect(dispatcher.notify).toHaveBeenCalledTimes(2);
  });

  it('claims with FOR UPDATE SKIP LOCKED, bounded to the 24 h window', async () => {
    const { run, queries } = setup();
    await run(NOW);
    const sql = queries[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'pending'");
    expect(sql).toMatch(/fire_at <= .* AND fire_at >= /);
  });

  it('a failure retries after the lease and gives up after 3 attempts', async () => {
    const { run, add, rows, handler, dispatcher } = setup(async () => {
      throw new Error('db hiccup');
    });
    await add(at(-MINUTE));

    expect((await run(NOW)).retried).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'pending', attempts: 1, last_error: 'db hiccup' });

    // Inside the lease nobody takes it again.
    await run(at(MINUTE));
    expect(handler.resolve).toHaveBeenCalledTimes(1);

    await run(at(12 * MINUTE));
    expect(rows[0].attempts).toBe(2);
    const last = await run(at(24 * MINUTE));
    expect(last.skipped).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'skipped', attempts: 3, last_error: 'db hiccup' });
    expect(dispatcher.notify).not.toHaveBeenCalled();
  });

  it('a source without handler is skipped', async () => {
    const { run, add, rows } = setup();
    await add(at(-MINUTE), { source_type: 'unknown_source' });
    await run(NOW);
    expect(rows[0]).toMatchObject({
      status: 'skipped',
      last_error: 'No handler for unknown_source',
    });
  });

  it('a reminder cancelled while it was being processed stays cancelled', async () => {
    const fixture = setup(async (reminder) => {
      // The task was completed meanwhile: sync cancelled the row.
      fixture.rows.find((row) => row.id === reminder.id)!.status = 'cancelled';
      return { action: 'skip', reason: 'Task is done' };
    });
    await fixture.add(at(-MINUTE));
    await fixture.run(NOW);
    expect(fixture.rows[0].status).toBe('cancelled');
  });

  it('a reminder cancelled while it was being resolved sends no notice', async () => {
    const fixture = setup(async (reminder) => {
      fixture.rows.find((row) => row.id === reminder.id)!.status = 'cancelled';
      return {
        action: 'notify',
        notifications: [
          { store_id: reminder.store_id, user_ids: [2], type: 'crm_task_due', title: 't', body: 'b' },
        ],
      };
    });
    await fixture.add(at(-MINUTE));
    const result = await fixture.run(NOW);
    expect(result.sent).toBe(0);
    expect(fixture.dispatcher.notify).not.toHaveBeenCalled();
    expect(fixture.rows[0].status).toBe('cancelled');
  });

  it('marks the row sent before dispatching: a failed close retries without a duplicate notice', async () => {
    const fixture = setup();
    await fixture.add(at(-MINUTE));
    const table = (fixture.job as any).global_prisma.scheduled_reminders;
    const original = table.updateMany.bind(table);
    let failed = false;
    table.updateMany = jest.fn(async (args: { data: { status?: string } }) => {
      // Only the close that marks the row `sent` fails, once.
      if (!failed && args.data.status === 'sent') {
        failed = true;
        throw new Error('db down');
      }
      return original(args);
    });

    expect((await fixture.run(NOW)).retried).toBe(1);
    expect(fixture.dispatcher.notify).not.toHaveBeenCalled();
    expect(fixture.rows[0]).toMatchObject({ status: 'pending', last_error: 'db down' });

    expect((await fixture.run(at(12 * MINUTE))).sent).toBe(1);
    expect(fixture.dispatcher.notify).toHaveBeenCalledTimes(1);
    expect(fixture.rows[0].status).toBe('sent');
  });

  it('a dispatch error after marking sent is not retried', async () => {
    const fixture = setup();
    fixture.dispatcher.notify.mockRejectedValueOnce(new Error('boom'));
    await fixture.add(at(-MINUTE));
    expect((await fixture.run(NOW)).sent).toBe(1);
    await fixture.run(at(12 * MINUTE));
    expect(fixture.dispatcher.notify).toHaveBeenCalledTimes(1);
    expect(fixture.rows[0].status).toBe('sent');
  });

  it('each claimed row keeps its own store for the handler', async () => {
    const { run, add, handler } = setup();
    await add(at(-MINUTE), { store_id: 20, source_id: 7 });
    await run(NOW);
    expect(handler.resolve.mock.calls[0][0]).toMatchObject({ store_id: 20, source_id: 7 });
  });
});
