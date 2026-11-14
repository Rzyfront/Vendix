import { UserReminderDueJob, REMINDER_DUE_LOOKBACK_MS } from './user-reminder-due.job';
import { createFakeRemindersPrisma } from './testing/fake-reminders-prisma';

const NOW = new Date('2026-11-14T22:00:00Z'); // 17:00 Bogota

function setup(seed: Record<string, any>[]) {
  const prisma = createFakeRemindersPrisma(seed);
  const notifications = { sendToUser: jest.fn(async (..._args: unknown[]) => null) };
  const job = new UserReminderDueJob(prisma as any, notifications as any);
  return { job, prisma, notifications };
}

describe('UserReminderDueJob (QUI-580)', () => {
  it('notifies only the owner (store and user) of each due reminder', async () => {
    const { job, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:59:00Z') },
      { id: 2, store_id: 1, user_id: 11, title: 'Beto', remind_at: new Date('2026-11-14T22:00:00Z'), link_label: 'Coca-Cola 1.5L' },
      { id: 3, store_id: 2, user_id: 20, title: 'Carla', remind_at: new Date('2026-11-14T20:00:00Z') },
    ]);
    expect(await job.notifyDue(NOW)).toBe(3);
    const calls = notifications.sendToUser.mock.calls.map((c) => c.slice(0, 5));
    expect(calls).toEqual(
      expect.arrayContaining([
        [1, 10, 'reminder_due', 'Recordatorio', 'Ana'],
        [1, 11, 'reminder_due', 'Recordatorio', 'Beto · Coca-Cola 1.5L'],
        [2, 20, 'reminder_due', 'Recordatorio', 'Carla'],
      ]),
    );
    expect(notifications.sendToUser.mock.calls[0][5]).toMatchObject({
      kind: 'user_reminder',
      url: '/admin/dashboard?tab=bitacora',
    });
  });

  it('notifies once: a second run (or the other process) sends nothing', async () => {
    const { job, prisma, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
    ]);
    await job.notifyDue(NOW);
    expect(await job.notifyDue(new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(prisma.rows[0].notified_at).toEqual(NOW);
  });

  it('skips done, future, undated and too old reminders', async () => {
    const { job, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'hecho', status: 'done', remind_at: new Date('2026-11-14T21:00:00Z') },
      { id: 2, store_id: 1, user_id: 10, title: 'futuro', remind_at: new Date('2026-11-14T22:01:00Z') },
      { id: 3, store_id: 1, user_id: 10, title: 'sin fecha' },
      { id: 4, store_id: 1, user_id: 10, title: 'viejo', remind_at: new Date(NOW.getTime() - REMINDER_DUE_LOOKBACK_MS - 1) },
    ]);
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('a claim lost to another process does not notify', async () => {
    const { job, prisma, notifications } = setup([
      { id: 1, store_id: 1, user_id: 10, title: 'Ana', remind_at: new Date('2026-11-14T21:00:00Z') },
    ]);
    prisma.user_reminders.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });
});
