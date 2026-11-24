import { ClaimedReminder } from '../../../notifications/reminders/reminder-source.registry';
import { CRM_TASK_DIGEST_SOURCE, CrmTaskReminderSource } from './crm-task-reminders.source';

const STORE = 10;
const OTHER_STORE = 20;
const SELLER = 2;
const CREATOR = 1;
const LUIS = 5;
const MARTA = 6;
const NOW = new Date('2026-11-24T19:00:00Z');
const DUE = new Date('2026-11-24T20:00:00Z'); // 3:00 p. m. en Bogotá
const HOUR = 60 * 60 * 1000;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    store_id: STORE,
    title: 'Llamar a Laura',
    status: 'pending',
    due_at: DUE,
    assigned_user_id: SELLER,
    created_by_user_id: CREATOR,
    customer: { first_name: 'Laura', last_name: 'Pérez' },
    supporters: [{ user_id: LUIS }],
    ...overrides,
  };
}

function reminder(overrides: Partial<ClaimedReminder> = {}): ClaimedReminder {
  return {
    id: 1,
    store_id: STORE,
    source_type: 'crm_task',
    source_id: 50,
    kind: 'due',
    fire_at: DUE,
    attempts: 1,
    ...overrides,
  };
}

function setup(
  options: {
    task?: Record<string, unknown> | null;
    tasks?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown>;
    timezone?: string;
    emailOn?: number[];
  } = {},
) {
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async (..._args: any[]) => ({
        settings: options.settings ?? {},
        stores: { timezone: options.timezone ?? 'America/Bogota' },
      })),
    },
    crm_tasks: {
      findFirst: jest.fn(async (..._args: any[]) =>
        options.task === null ? null : task(options.task),
      ),
      findMany: jest.fn(async (..._args: any[]) => options.tasks ?? []),
    },
  };
  const preferences = {
    resolveForUsers: jest.fn(async (_store: number, users: number[]) => {
      const on = new Set(options.emailOn ?? []);
      return new Map(users.map((user) => [user, { push: true, email: on.has(user) }]));
    }),
  };
  const source = new CrmTaskReminderSource(prisma as any, preferences as any);
  return { source, prisma, preferences };
}

describe('CrmTaskReminderSource · task reminders', () => {
  it('looks the task up by id AND the store of the reminder', async () => {
    const { source, prisma } = setup({ task: null });
    const result = await source.resolve(reminder({ store_id: OTHER_STORE }), NOW);
    expect(prisma.crm_tasks.findFirst.mock.calls[0][0].where).toEqual({
      id: 50,
      store_id: OTHER_STORE,
    });
    expect(result).toEqual({ action: 'skip', reason: 'Task no longer exists' });
  });

  it('"vencida" goes to the assignee and support people, with a stable dedupe key', async () => {
    const { source } = setup();
    const result = await source.resolve(reminder(), NOW);
    expect(result).toEqual({
      action: 'notify',
      notifications: [
        {
          store_id: STORE,
          user_ids: [SELLER, LUIS],
          type: 'crm_task_due',
          title: 'Tarea vencida',
          body: 'Llamar a Laura · Laura Pérez',
          data: {
            kind: 'crm_task',
            task_id: 50,
            url: '/admin/customers/tasks',
            reminder: 'due',
          },
          dedupe_key: `crm_task:50:due:${DUE.toISOString()}`,
        },
      ],
    });
  });

  it('"por vencer" says the time in the store timezone', async () => {
    const { source } = setup();
    const result = await source.resolve(
      reminder({ kind: 'due_soon', fire_at: new Date(DUE.getTime() - HOUR) }),
      NOW,
    );
    expect(result.action).toBe('notify');
    if (result.action !== 'notify') return;
    expect(result.notifications[0]).toMatchObject({
      type: 'crm_task_due_soon',
      title: 'Tarea por vencer',
      user_ids: [SELLER, LUIS],
    });
    expect(result.notifications[0].body).toMatch(
      /^Llamar a Laura · Laura Pérez · vence a las 03:00\sp/,
    );
  });

  it('"sigue vencida" 24 h later goes only to the creator', async () => {
    const { source } = setup();
    const result = await source.resolve(
      reminder({ kind: 'overdue_escalation', fire_at: new Date(DUE.getTime() + 24 * HOUR) }),
      new Date(DUE.getTime() + 24 * HOUR),
    );
    expect(result.action).toBe('notify');
    if (result.action !== 'notify') return;
    expect(result.notifications[0]).toMatchObject({
      user_ids: [CREATOR],
      type: 'crm_task_due',
      title: 'Tarea vencida hace 24 h',
      body: 'Sigue sin completarse: Llamar a Laura · Laura Pérez',
    });
  });

  it('an unassigned task reminds its creator', async () => {
    const { source } = setup({ task: { assigned_user_id: null, supporters: [] } });
    const result = await source.resolve(reminder(), NOW);
    expect(result.action === 'notify' && result.notifications[0].user_ids).toEqual([CREATOR]);
  });

  it.each([
    ['done', 'Task is done'],
    ['cancelled', 'Task is cancelled'],
  ])('a %s task is skipped', async (status, reason) => {
    const { source } = setup({ task: { status } });
    expect(await source.resolve(reminder(), NOW)).toEqual({ action: 'skip', reason });
  });

  it('a task without date or with another date is skipped', async () => {
    const noDate = setup({ task: { due_at: null } });
    expect(await noDate.source.resolve(reminder(), NOW)).toEqual({
      action: 'skip',
      reason: 'Task has no due date',
    });
    const moved = setup({ task: { due_at: new Date(DUE.getTime() + 2 * HOUR) } });
    expect(await moved.source.resolve(reminder(), NOW)).toEqual({
      action: 'skip',
      reason: 'Due date changed',
    });
    const movedSoon = setup({ task: { due_at: new Date(DUE.getTime() + 2 * 24 * HOUR) } });
    expect(
      await movedSoon.source.resolve(
        reminder({ kind: 'due_soon', fire_at: new Date(DUE.getTime() - HOUR) }),
        NOW,
      ),
    ).toEqual({ action: 'skip', reason: 'Due date changed' });
  });

  it('nobody to escalate to (creator is the assignee) skips the escalation', async () => {
    const { source } = setup({ task: { created_by_user_id: SELLER } });
    const result = await source.resolve(
      reminder({ kind: 'overdue_escalation', fire_at: new Date(DUE.getTime() + 24 * HOUR) }),
      NOW,
    );
    expect(result).toEqual({ action: 'skip', reason: 'No recipients' });
  });
});

describe('CrmTaskReminderSource · morning digest', () => {
  const DIGEST_AT = new Date('2026-11-24T12:00:00Z'); // 7:00 a. m. en Bogotá
  const digest = (overrides: Partial<ClaimedReminder> = {}) =>
    reminder({
      source_type: CRM_TASK_DIGEST_SOURCE,
      source_id: STORE,
      kind: 'digest',
      fire_at: DIGEST_AT,
      ...overrides,
    });
  const dayTasks = [
    task({ id: 1, title: 'Llamar a Laura', due_at: new Date('2026-11-24T15:00:00Z') }),
    task({ id: 2, title: 'Visita', due_at: new Date('2026-11-24T20:30:00Z'), customer: null }),
    task({ id: 3, title: 'Cotizar', assigned_user_id: MARTA }),
    task({ id: 4, title: 'Sin responsable', assigned_user_id: null, created_by_user_id: LUIS }),
  ];

  it('reads the local day of the store, only its pending tasks', async () => {
    const { source, prisma } = setup({ tasks: dayTasks, emailOn: [SELLER] });
    await source.resolve(digest(), DIGEST_AT);
    expect(prisma.crm_tasks.findMany.mock.calls[0][0].where).toEqual({
      store_id: STORE,
      status: 'pending',
      due_at: {
        gte: new Date('2026-11-24T05:00:00Z'),
        lt: new Date('2026-11-25T05:00:00Z'),
      },
    });
  });

  it('one e-mail per person who turned it on, with their own tasks of the day', async () => {
    const { source, preferences } = setup({ tasks: dayTasks, emailOn: [SELLER, LUIS] });
    const result = await source.resolve(digest(), DIGEST_AT);
    expect(preferences.resolveForUsers).toHaveBeenCalledWith(
      STORE,
      [SELLER, MARTA, LUIS],
      'crm_task_digest',
    );
    expect(result.action).toBe('notify');
    if (result.action !== 'notify') return;
    expect(result.notifications.map((n) => n.user_ids)).toEqual([[SELLER], [LUIS]]);
    const seller = result.notifications[0];
    expect(seller).toMatchObject({
      store_id: STORE,
      type: 'crm_task_digest',
      title: 'Tus tareas de hoy',
      data: { kind: 'crm_task_digest', date: '2026-11-24', url: '/admin/customers/tasks' },
      dedupe_key: 'crm_task_digest:2026-11-24',
    });
    const lines = seller.body.split('\n');
    expect(lines[0]).toBe('Hoy vencen 2 tareas:');
    expect(lines[1]).toMatch(/^• 10:00\sa.*· Llamar a Laura · Laura Pérez$/);
    expect(lines[2]).toMatch(/^• 03:30\sp.*· Visita$/);
    expect(result.notifications[1].body.split('\n')[0]).toBe('Hoy vence 1 tarea:');
  });

  it('nobody with the e-mail on: no notice at all (not even the bell)', async () => {
    const { source } = setup({ tasks: dayTasks, emailOn: [] });
    expect(await source.resolve(digest(), DIGEST_AT)).toEqual({
      action: 'skip',
      reason: 'Nobody turned on the digest e-mail',
    });
  });

  it('a day without tasks is skipped', async () => {
    const { source } = setup({ tasks: [] });
    expect(await source.resolve(digest(), DIGEST_AT)).toEqual({
      action: 'skip',
      reason: 'No tasks due that day',
    });
  });

  it('if the store changed its hour or timezone, the old digest is skipped', async () => {
    const hour = setup({ tasks: dayTasks, settings: { notifications: { daily_digest_hour: 8 } } });
    expect(await hour.source.resolve(digest(), DIGEST_AT)).toEqual({
      action: 'skip',
      reason: 'Digest hour or timezone changed',
    });
    const zone = setup({ tasks: dayTasks, timezone: 'America/Mexico_City' });
    expect(await zone.source.resolve(digest(), DIGEST_AT)).toEqual({
      action: 'skip',
      reason: 'Digest hour or timezone changed',
    });
  });

  it('long days are cut at 15 lines and the rest is counted', async () => {
    const many = Array.from({ length: 18 }, (_, i) =>
      task({ id: 100 + i, title: `Tarea ${i + 1}`, customer: null }),
    );
    const { source } = setup({ tasks: many, emailOn: [SELLER] });
    const result = await source.resolve(digest(), DIGEST_AT);
    if (result.action !== 'notify') throw new Error('expected notify');
    const lines = result.notifications[0].body.split('\n');
    expect(lines[0]).toBe('Hoy vencen 18 tareas:');
    expect(lines).toHaveLength(17);
    expect(lines[16]).toBe('y 3 más.');
  });

  it('the dedupe key is per date: the same day never sends twice, the next day does', async () => {
    const { source } = setup({ tasks: dayTasks, emailOn: [SELLER] });
    const today = await source.resolve(digest(), DIGEST_AT);
    const tomorrowAt = new Date(DIGEST_AT.getTime() + 24 * HOUR);
    const tomorrow = await source.resolve(digest({ fire_at: tomorrowAt }), tomorrowAt);
    const key = (r: typeof today) => (r.action === 'notify' ? r.notifications[0].dedupe_key : null);
    expect(key(today)).toBe('crm_task_digest:2026-11-24');
    expect(key(tomorrow)).toBe('crm_task_digest:2026-11-25');
  });
});
