import { CRM_TASK_DUE_LOOKBACK_MS, CrmTaskDueJob } from './crm-task-due.job';

const NOW = new Date('2026-10-30T15:00:00Z');

function setup(tasks: Record<string, unknown>[]) {
  const claimed = new Set<string>();
  const prisma = { crm_tasks: { findMany: jest.fn(async (..._args: any[]) => tasks) } };
  const notifications = { sendToUser: jest.fn(async (..._args: any[]) => null) };
  const redis = {
    set: jest.fn(async (key: string) => {
      if (claimed.has(key)) return null;
      claimed.add(key);
      return 'OK';
    }),
  };
  const job = new CrmTaskDueJob(
    prisma as any,
    notifications as any,
    redis as any,
  );
  return { job, prisma, notifications, redis };
}

const due = new Date('2026-10-30T14:58:00Z');

describe('CrmTaskDueJob', () => {
  it('reads pending tasks that fell due in the last 24 h only', async () => {
    const { job, prisma } = setup([]);
    await job.notifyDue(NOW);
    expect(prisma.crm_tasks.findMany.mock.calls[0][0].where).toEqual({
      status: 'pending',
      due_at: {
        gte: new Date(NOW.getTime() - CRM_TASK_DUE_LOOKBACK_MS),
        lte: NOW,
      },
    });
  });

  it('notifies the assignee once, even across runs and processes', async () => {
    const { job, notifications } = setup([
      {
        id: 7,
        store_id: 10,
        title: 'Llamar',
        due_at: due,
        assigned_user_id: 2,
        created_by_user_id: 1,
      },
    ]);
    expect(await job.notifyDue(NOW)).toBe(1);
    expect(await job.notifyDue(NOW)).toBe(0);
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      10,
      2,
      'crm_task_due',
      'Tarea vencida',
      'Llamar',
      { kind: 'crm_task', task_id: 7, url: '/admin/customers/tasks' },
    );
  });

  it('falls back to the creator when the task is unassigned', async () => {
    const { job, notifications } = setup([
      {
        id: 8,
        store_id: 10,
        title: 'Revisar',
        due_at: due,
        assigned_user_id: null,
        created_by_user_id: 1,
      },
    ]);
    await job.notifyDue(NOW);
    expect((notifications.sendToUser.mock.calls[0] as unknown[])[1]).toBe(1);
  });

  it('rescheduling re-arms the reminder (key includes the due instant)', async () => {
    const task = {
      id: 9,
      store_id: 10,
      title: 'X',
      due_at: due,
      assigned_user_id: 2,
      created_by_user_id: 2,
    };
    const { job, redis, prisma } = setup([task]);
    await job.notifyDue(NOW);
    prisma.crm_tasks.findMany.mockResolvedValueOnce([
      { ...task, due_at: new Date('2026-10-30T14:59:00Z') },
    ]);
    expect(await job.notifyDue(NOW)).toBe(1);
    expect(redis.set.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      `crm:task:due:9:${due.getTime()}`,
      `crm:task:due:9:${new Date('2026-10-30T14:59:00Z').getTime()}`,
    ]);
  });
});
