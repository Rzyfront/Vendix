import { Logger } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { CrmTasksService } from './crm-tasks.service';

const STORE = 10;
const OWNER = 1;
const SELLER = 2;
const STAFF = 3;
const CUSTOMER = 4;
const LUIS = 5;
const MARTA = 6;

/** Visibility of a seller: assignee, creator or support person. */
const sellerSees = (user: number) => ({
  OR: [
    { assigned_user_id: user },
    { created_by_user_id: user },
    { supporters: { some: { user_id: user } } },
  ],
});
/** `assigned=me` / a user id: the assignee or a support person. */
const involves = (user: number) => ({
  OR: [{ assigned_user_id: user }, { supporters: { some: { user_id: user } } }],
});
const person = (id: number, first_name = `U${id}`) => ({ id, first_name, last_name: null });

function as(user: 'owner' | 'seller') {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: STORE,
    user_id: user === 'owner' ? OWNER : SELLER,
    is_super_admin: false,
    is_owner: false,
    permissions:
      user === 'owner'
        ? ['store:crm_tasks:manage', 'store:crm_inbox:assign']
        : ['store:crm_tasks:manage'],
  });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 50,
    store_id: STORE,
    title: 'Llamar a Laura',
    description: null,
    status: 'pending',
    due_at: null,
    completed_at: null,
    assigned_user_id: SELLER,
    created_by_user_id: SELLER,
    customer_id: CUSTOMER,
    opportunity_id: null,
    conversation_id: null,
    move_to_stage_id: null,
    customer: { id: CUSTOMER, first_name: 'Laura', last_name: 'Pérez' },
    assigned_user: { id: SELLER, first_name: 'Sam', last_name: null },
    created_by: { id: SELLER, first_name: 'Sam', last_name: null },
    opportunity: null,
    move_to_stage: null,
    supporters: [] as { user: ReturnType<typeof person> }[],
    created_at: new Date('2026-10-30T12:00:00Z'),
    updated_at: new Date('2026-10-30T12:00:00Z'),
    ...overrides,
  };
}

function setup(
  options: { staff?: boolean; customer?: boolean; task?: Record<string, unknown> } = {},
) {
  let current = taskRow(options.task);
  const prisma = {
    store_settings: {
      findFirst: jest.fn(async (..._args: any[]) => ({
        settings: {},
        stores: { timezone: 'America/Bogota' },
      })),
    },
    store_users: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.user_id === CUSTOMER) {
          return options.customer === false ? null : { id: 9 };
        }
        return options.staff === false ? null : { id: 8 };
      }),
      findMany: jest.fn(async (..._args: any[]) => [
        { user: person(LUIS, 'Luis') },
        { user: person(MARTA, 'Marta') },
      ]),
    },
    crm_opportunities: { count: jest.fn(async (..._args: any[]) => 1) },
    crm_conversations: { count: jest.fn(async (..._args: any[]) => 1) },
    crm_tasks: {
      count: jest.fn(async (..._args: any[]) => 1),
      findMany: jest.fn(async (..._args: any[]) => [current]),
      findFirst: jest.fn(async (..._args: any[]) => current),
      create: jest.fn(async ({ data }: any) => {
        const { supporters, ...scalars } = data;
        current = taskRow({
          ...scalars,
          id: 51,
          assigned_user: data.assigned_user_id
            ? { id: data.assigned_user_id, first_name: 'X', last_name: null }
            : null,
          supporters: (supporters?.create ?? []).map((row: any) => ({
            user: person(row.user_id),
          })),
        });
        return current;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        // The completion guard: a task already done is not completed again.
        if (where.status?.not && current.status === where.status.not) {
          return { count: 0 };
        }
        current = { ...current, ...data };
        return { count: 1 };
      }),
    },
  };
  (prisma as any).crm_task_assignees = {
    deleteMany: jest.fn(async ({ where }: any) => {
      current = {
        ...current,
        supporters: current.supporters.filter(
          (row) => !where.user_id.in.includes(row.user.id),
        ),
      };
      return { count: where.user_id.in.length };
    }),
    createMany: jest.fn(async ({ data }: any) => {
      current = {
        ...current,
        supporters: [
          ...current.supporters,
          ...data.map((row: any) => ({ user: person(row.user_id) })),
        ],
      };
      return { count: data.length };
    }),
  };
  // The task writes run in a transaction; the mock hands itself as the tx.
  (prisma as any).$transaction = jest.fn(async (work: (tx: unknown) => unknown) =>
    work(prisma),
  );
  const notifications = { sendToUser: jest.fn(async (..._args: any[]) => null) };
  const pipeline = {
    assertTaskTargetStage: jest.fn(async (..._args: any[]) => undefined),
    moveForTask: jest.fn(async (..._args: any[]) => ({
      moved: true,
      reason: null,
      stage: { id: 102, name: 'Negociación', kind: 'open' },
    })),
  };
  const service = new CrmTasksService(
    prisma as any,
    notifications as any,
    pipeline as any,
  );
  return { service, prisma: prisma as typeof prisma & Record<string, any>, notifications, pipeline };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('CrmTasksService', () => {
  it('a seller only lists tasks assigned to them, created by them or where they are support', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.list({ assigned: 'all' });
    const where = prisma.crm_tasks.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual(sellerSees(SELLER));
  });

  it('owner lists the whole store; "me" is the default filter and includes support', async () => {
    as('owner');
    const { service, prisma } = setup();
    await service.list({});
    const where = prisma.crm_tasks.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{}, involves(OWNER)]);
  });

  it('filtering by a person matches assignee or support; "unassigned" stays "no assignee"', async () => {
    as('owner');
    const { service, prisma } = setup();
    await service.list({ assigned: String(LUIS) });
    await service.list({ assigned: 'unassigned' });
    expect(prisma.crm_tasks.findMany.mock.calls[0][0].where.AND[1]).toEqual(involves(LUIS));
    expect(prisma.crm_tasks.findMany.mock.calls[1][0].where.AND[1]).toEqual({
      assigned_user_id: null,
    });
  });

  it('"today" is the store-local day (Bogotá, UTC-5)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-31T03:00:00Z') }); // 30 Oct 22:00 local
    as('owner');
    const { service, prisma } = setup();
    await service.list({ due: 'today', assigned: 'all' });
    const where = prisma.crm_tasks.findMany.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({
      due_at: {
        gte: new Date('2026-10-30T05:00:00Z'),
        lt: new Date('2026-10-31T05:00:00Z'),
      },
    });
  });

  it('"mis tareas de hoy" splits my overdue and today pending tasks', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T15:00:00Z') });
    as('seller');
    const { service, prisma } = setup();
    const overdue = taskRow({ id: 1, due_at: new Date('2026-10-29T15:00:00Z') });
    const today = taskRow({ id: 2, due_at: new Date('2026-10-30T20:00:00Z') });
    prisma.crm_tasks.findMany
      .mockResolvedValueOnce([overdue])
      .mockResolvedValueOnce([today]);
    prisma.crm_tasks.count.mockResolvedValueOnce(4);

    const result = await service.today();

    expect(result.counts).toEqual({ overdue: 1, today: 1, upcoming_week: 4 });
    expect(result.overdue[0]).toMatchObject({ id: 1, is_overdue: true });
    expect(result.today[0]).toMatchObject({ id: 2, is_overdue: false });
    expect(prisma.crm_tasks.findMany.mock.calls[0][0].where).toEqual({
      ...involves(SELLER),
      status: 'pending',
      due_at: { lt: new Date('2026-10-30T15:00:00Z') },
    });
  });

  it('stats scoped to "me" count only my tasks, like the list', async () => {
    as('owner');
    const { service, prisma } = setup();
    await service.stats({ assigned: 'me' });
    for (const [args] of prisma.crm_tasks.count.mock.calls) {
      expect(args.where.AND).toContainEqual(involves(OWNER));
    }
  });

  it('stats "today" starts now, so an overdue task is never counted twice', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-30T15:00:00Z') });
    as('owner');
    const { service, prisma } = setup();
    await service.stats({ assigned: 'me' });
    const [overdue, today] = prisma.crm_tasks.count.mock.calls.map(([a]: any) => a.where.AND);
    expect(overdue).toContainEqual({ due_at: { lt: new Date('2026-10-30T15:00:00Z') } });
    expect(today).toContainEqual({
      due_at: {
        gte: new Date('2026-10-30T15:00:00Z'),
        lt: new Date('2026-10-31T05:00:00Z'),
      },
    });
  });

  it('stats without "assigned" keep counting everything the viewer can see', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.stats();
    const where = prisma.crm_tasks.count.mock.calls[2][0].where;
    expect(where.AND).toEqual([sellerSees(SELLER), { status: 'pending' }]);
  });

  it('a seller cannot assign a task to someone else', async () => {
    as('seller');
    const { service, prisma } = setup();
    expect(
      await codeOf(service.create({ title: 'X', assigned_user_id: STAFF })),
    ).toBe('CRM_ASSIGN_001');
    expect(prisma.crm_tasks.create).not.toHaveBeenCalled();
  });

  it('a task defaults to its creator and does not notify them', async () => {
    as('seller');
    const { service, prisma, notifications } = setup();
    const task = await service.create({
      title: '  Enviar catálogo ',
      due_at: '2026-11-02T15:00:00Z',
      customer_id: CUSTOMER,
    });
    expect(prisma.crm_tasks.create.mock.calls[0][0].data).toMatchObject({
      store_id: STORE,
      title: 'Enviar catálogo',
      assigned_user_id: SELLER,
      created_by_user_id: SELLER,
      customer_id: CUSTOMER,
      due_at: new Date('2026-11-02T15:00:00Z'),
    });
    expect(task.id).toBe(51);
    expect(notifications.sendToUser).not.toHaveBeenCalled();
  });

  it('owner assigning staff notifies the assignee through notifications', async () => {
    as('owner');
    const { service, notifications } = setup();
    await service.create({ title: 'Cerrar venta', assigned_user_id: STAFF });
    expect(notifications.sendToUser).toHaveBeenCalledWith(
      STORE,
      STAFF,
      'crm_task_assigned',
      'Nueva tarea asignada',
      'Cerrar venta · Laura Pérez',
      { kind: 'crm_task', task_id: 51, url: '/admin/customers/tasks' },
    );
  });

  it('the assignee must be active staff with tasks permission', async () => {
    as('owner');
    const { service } = setup({ staff: false });
    expect(
      await codeOf(service.create({ title: 'X', assigned_user_id: STAFF })),
    ).toBe('CRM_STAFF_001');
  });

  it('a customer of another store cannot be linked', async () => {
    as('owner');
    const { service } = setup({ customer: false });
    expect(
      await codeOf(service.create({ title: 'X', customer_id: CUSTOMER })),
    ).toBe('CRM_CUSTOMER_001');
  });

  it('complete stamps completed_at; reopen clears it', async () => {
    as('seller');
    const { service, prisma } = setup();
    const done = await service.complete(50);
    expect(prisma.crm_tasks.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 50, store_id: STORE, status: { not: 'done' } },
      data: { status: 'done', completed_at: expect.any(Date) },
    });
    expect(done.status).toBe('done');

    await service.reopen(50);
    expect(prisma.crm_tasks.updateMany.mock.calls[1][0]).toEqual({
      where: { id: 50, store_id: STORE },
      data: { status: 'pending', completed_at: null },
    });
  });

  it('a task not visible to the seller answers 404', async () => {
    as('seller');
    const { service, prisma } = setup();
    prisma.crm_tasks.findFirst.mockResolvedValueOnce(null as any);
    expect(await codeOf(service.update(77, { title: 'Y' }))).toBe('CRM_TASK_001');
    expect(prisma.crm_tasks.findFirst.mock.calls[0][0].where).toEqual({
      AND: [{ id: 77 }, sellerSees(SELLER)],
    });
  });

  it('a seller cannot leave a task without assignee', async () => {
    as('seller');
    const { service, prisma } = setup();
    expect(await codeOf(service.update(50, { assigned_user_id: null }))).toBe(
      'CRM_ASSIGN_001',
    );
    expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
  });

  it('a seller only links opportunities they own', async () => {
    as('seller');
    const { service, prisma } = setup();
    prisma.crm_opportunities.count.mockResolvedValueOnce(0);
    expect(await codeOf(service.create({ title: 'X', opportunity_id: 9 }))).toBe(
      'CRM_OPPORTUNITY_001',
    );
    expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
      where: { id: 9, owner_user_id: SELLER },
    });
  });

  it('reassigning notifies the new assignee only', async () => {
    as('owner');
    const { service, notifications } = setup();
    await service.update(50, { assigned_user_id: STAFF });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect((notifications.sendToUser.mock.calls[0] as unknown[])[1]).toBe(STAFF);
  });
  describe('support people', () => {
    it('are saved without the assignee nor duplicates, and each one is told', async () => {
      as('owner');
      const { service, prisma, notifications } = setup();
      const task = await service.create({
        title: 'Cerrar venta',
        assigned_user_id: STAFF,
        customer_id: CUSTOMER,
        support_user_ids: [LUIS, STAFF, MARTA, LUIS],
      });

      expect(prisma.crm_tasks.create.mock.calls[0][0].data.supporters).toEqual({
        create: [
          { store_id: STORE, user_id: LUIS },
          { store_id: STORE, user_id: MARTA },
        ],
      });
      expect(task.support_users).toEqual([person(LUIS), person(MARTA)]);
      expect(notifications.sendToUser).toHaveBeenCalledTimes(3);
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        STORE,
        LUIS,
        'crm_task_assigned',
        'Te sumaron como apoyo',
        'Te sumaron como apoyo en: Cerrar venta · Laura Pérez',
        { kind: 'crm_task', task_id: 51, url: '/admin/customers/tasks', role: 'support' },
      );
      expect((notifications.sendToUser.mock.calls[2] as unknown[])[1]).toBe(MARTA);
    });

    it('a seller keeps the task but can add support people', async () => {
      as('seller');
      const { service, prisma } = setup();
      await service.create({ title: 'Visita', support_user_ids: [LUIS] });
      expect(prisma.crm_tasks.create.mock.calls[0][0].data).toMatchObject({
        assigned_user_id: SELLER,
        supporters: { create: [{ store_id: STORE, user_id: LUIS }] },
      });
    });

    it('must be active staff with tasks permission', async () => {
      as('owner');
      const { service, prisma } = setup({ staff: false });
      expect(
        await codeOf(service.create({ title: 'X', support_user_ids: [LUIS] })),
      ).toBe('CRM_STAFF_001');
      expect(prisma.crm_tasks.create).not.toHaveBeenCalled();
    });

    it('an update replaces the set: only the new ones are told, the removed ones are not', async () => {
      as('owner');
      const { service, prisma, notifications } = setup({
        task: { supporters: [{ user: person(LUIS) }] },
      });
      const task = await service.update(50, { support_user_ids: [MARTA] });

      expect(prisma.crm_task_assignees.deleteMany).toHaveBeenCalledWith({
        where: { store_id: STORE, task_id: 50, user_id: { in: [LUIS] } },
      });
      expect(prisma.crm_task_assignees.createMany).toHaveBeenCalledWith({
        data: [{ store_id: STORE, task_id: 50, user_id: MARTA }],
        skipDuplicates: true,
      });
      expect(task.support_users).toEqual([person(MARTA)]);
      expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
      expect((notifications.sendToUser.mock.calls[0] as unknown[])[1]).toBe(MARTA);
    });

    it('a support person who becomes the assignee stops being support', async () => {
      as('owner');
      const { service, prisma } = setup({
        task: { supporters: [{ user: person(LUIS) }, { user: person(MARTA) }] },
      });
      await service.update(50, { assigned_user_id: LUIS });
      expect(prisma.crm_task_assignees.deleteMany).toHaveBeenCalledWith({
        where: { store_id: STORE, task_id: 50, user_id: { in: [LUIS] } },
      });
      expect(prisma.crm_task_assignees.createMany).not.toHaveBeenCalled();
    });

    it('an untouched set is left alone, even if someone in it is no longer active staff', async () => {
      as('owner');
      const { service, prisma } = setup({
        staff: false,
        task: { supporters: [{ user: person(LUIS) }] },
      });
      await service.update(50, { title: 'Otra', support_user_ids: [LUIS] });
      expect(prisma.store_users.findFirst).not.toHaveBeenCalled();
      expect(prisma.crm_task_assignees.deleteMany).not.toHaveBeenCalled();
      expect(prisma.crm_task_assignees.createMany).not.toHaveBeenCalled();
    });

    it('a support person can complete the task', async () => {
      as('seller');
      const { service, prisma } = setup({
        task: {
          assigned_user_id: STAFF,
          created_by_user_id: OWNER,
          supporters: [{ user: person(SELLER) }],
        },
      });
      const done = await service.complete(50);
      expect(prisma.crm_tasks.findFirst.mock.calls[0][0].where).toEqual({
        AND: [{ id: 50 }, sellerSees(SELLER)],
      });
      expect(done.status).toBe('done');
    });
  });

  describe('a task that moves its opportunity', () => {
    it('needs a linked opportunity and a stage of its board', async () => {
      as('seller');
      const { service, prisma, pipeline } = setup();
      expect(
        await codeOf(service.create({ title: 'X', move_to_stage_id: 102 })),
      ).toBe('CRM_TASK_002');
      expect(pipeline.assertTaskTargetStage).not.toHaveBeenCalled();

      await service.create({ title: 'X', opportunity_id: 500, move_to_stage_id: 102 });
      expect(pipeline.assertTaskTargetStage).toHaveBeenCalledWith(500, 102);
      expect(prisma.crm_tasks.create.mock.calls[0][0].data).toMatchObject({
        opportunity_id: 500,
        move_to_stage_id: 102,
      });
    });

    it('editing validates the new stage against the linked opportunity, and null clears it', async () => {
      as('seller');
      const { service, prisma, pipeline } = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102 },
      });
      await service.update(50, { move_to_stage_id: 103 });
      expect(pipeline.assertTaskTargetStage).toHaveBeenCalledWith(500, 103);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0].data).toEqual({
        move_to_stage_id: 103,
      });

      await service.update(50, { move_to_stage_id: null });
      expect(prisma.crm_tasks.updateMany.mock.calls[1][0].data).toEqual({
        move_to_stage_id: null,
      });
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('only who sees the opportunity on the board can choose where the task moves it', async () => {
      // The seller helps on a task linked to someone else's opportunity.
      as('seller');
      const { service, prisma, pipeline } = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102 },
      });
      prisma.crm_opportunities.count.mockResolvedValueOnce(0);

      expect(await codeOf(service.update(50, { move_to_stage_id: 104 }))).toBe(
        'CRM_OPPORTUNITY_001',
      );
      expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
        where: { id: 500, owner_user_id: SELLER },
      });
      expect(pipeline.assertTaskTargetStage).not.toHaveBeenCalled();
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();

      // Clearing the target moves nothing, so it stays open to them.
      await service.update(50, { move_to_stage_id: null });
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0].data).toEqual({
        move_to_stage_id: null,
      });
    });

    it('a task without opportunity cannot get a target stage on edit', async () => {
      as('seller');
      const { service, prisma } = setup();
      expect(await codeOf(service.update(50, { move_to_stage_id: 102 }))).toBe(
        'CRM_TASK_002',
      );
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
    });

    it('completing it moves the opportunity and says where; reopening does not move it back', async () => {
      as('seller');
      const { service, pipeline } = setup({
        task: {
          opportunity_id: 500,
          move_to_stage_id: 102,
          move_to_stage: { id: 102, name: 'Negociación', kind: 'open', color: null },
        },
      });
      const done = await service.complete(50);
      expect(pipeline.moveForTask).toHaveBeenCalledWith(500, 102);
      expect(done).toMatchObject({
        status: 'done',
        move_to_stage: { id: 102, name: 'Negociación' },
        opportunity_move: {
          moved: true,
          reason: null,
          stage: { id: 102, name: 'Negociación', kind: 'open' },
        },
      });

      const reopened = await service.reopen(50);
      expect(pipeline.moveForTask).toHaveBeenCalledTimes(1);
      expect(reopened).not.toHaveProperty('opportunity_move');
    });

    it('completing a task that moves nothing answers opportunity_move null', async () => {
      as('seller');
      const { service, pipeline } = setup();
      const done = await service.complete(50);
      expect(done).toMatchObject({ status: 'done', opportunity_move: null });
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('the task is completed even when the opportunity was deleted or the move fails', async () => {
      as('seller');
      const stage = { id: 102, name: 'Negociación', kind: 'open', color: null };
      const gone = setup({
        task: { opportunity_id: null, move_to_stage_id: 102, move_to_stage: stage },
      });
      expect(await gone.service.complete(50)).toMatchObject({
        status: 'done',
        opportunity_move: {
          moved: false,
          reason: 'opportunity_missing',
          stage: { id: 102, name: 'Negociación', kind: 'open' },
        },
      });

      const failing = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102, move_to_stage: stage },
      });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      failing.pipeline.moveForTask.mockRejectedValueOnce(new Error('boom'));
      expect(await failing.service.complete(50)).toMatchObject({
        status: 'done',
        opportunity_move: { moved: false, reason: 'failed' },
      });
      expect(failing.prisma.crm_tasks.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'done',
      });
    });
  });

  describe('a support person only changes the status', () => {
    /** The seller helps on a task of STAFF created by the owner. */
    const helping = (overrides: Record<string, unknown> = {}) => ({
      task: {
        title: 'Llamar a Laura',
        description: 'Confirmar la cotización',
        due_at: new Date('2026-11-20T15:00:00.000Z'),
        assigned_user_id: STAFF,
        created_by_user_id: OWNER,
        opportunity_id: 500,
        move_to_stage_id: 102,
        supporters: [{ user: person(SELLER) }, { user: person(LUIS) }],
        ...overrides,
      },
    });

    it('completes and reopens it', async () => {
      as('seller');
      const { service, prisma } = setup(helping());
      expect((await service.complete(50)).status).toBe('done');
      expect((await service.reopen(50)).status).toBe('pending');
      expect(prisma.crm_tasks.updateMany).toHaveBeenCalledTimes(2);
    });

    it('saving the form untouched is not an edit and answers the task', async () => {
      as('seller');
      const { service, prisma } = setup(helping());
      const task = await service.update(50, {
        title: '  Llamar a Laura ',
        description: 'Confirmar la cotización',
        due_at: '2026-11-20T10:00:00-05:00',
        support_user_ids: [LUIS, SELLER, STAFF],
        move_to_stage_id: 102,
        assigned_user_id: STAFF,
      });
      expect(task.id).toBe(50);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0].data).toEqual({
        title: 'Llamar a Laura',
        description: 'Confirmar la cotización',
        due_at: new Date('2026-11-20T15:00:00.000Z'),
      });
      expect(prisma.crm_task_assignees.deleteMany).not.toHaveBeenCalled();
      expect(prisma.crm_task_assignees.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['the title', { title: 'Otra cosa' }],
      ['the description', { description: null }],
      ['the due date', { due_at: '2026-11-21T10:00:00-05:00' }],
      ['the assignee', { assigned_user_id: SELLER }],
      ['the support people', { support_user_ids: [SELLER] }],
      ['the target stage', { move_to_stage_id: null }],
      ['the status together with the title', { status: 'done', title: 'X' }],
    ])('cannot change %s (CRM_TASK_003)', async (_what, dto) => {
      as('seller');
      const { service, prisma, pipeline } = setup(helping());
      expect(await codeOf(service.update(50, dto as any))).toBe('CRM_TASK_003');
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('the creator, the assignee and see-all still edit everything', async () => {
      as('seller');
      const creator = setup(helping({ created_by_user_id: SELLER }));
      await creator.service.update(50, { title: 'Otra' });
      expect(creator.prisma.crm_tasks.updateMany.mock.calls[0][0].data).toEqual({
        title: 'Otra',
      });

      const assignee = setup(helping({ assigned_user_id: SELLER }));
      await assignee.service.update(50, { title: 'Otra' });
      expect(assignee.prisma.crm_tasks.updateMany).toHaveBeenCalledTimes(1);

      jest.restoreAllMocks();
      as('owner');
      const owner = setup(helping({ created_by_user_id: STAFF }));
      await owner.service.update(50, { title: 'Otra', support_user_ids: [MARTA] });
      expect(owner.prisma.crm_tasks.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('writes and races', () => {
    it('the task and its support set are written in one transaction, naming the store', async () => {
      as('owner');
      const { service, prisma } = setup({
        task: { supporters: [{ user: person(LUIS) }] },
      });
      await service.update(50, { title: 'Otra', support_user_ids: [MARTA] });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0].where).toEqual({
        id: 50,
        store_id: STORE,
      });
      expect(prisma.crm_task_assignees.deleteMany.mock.calls[0][0].where).toMatchObject({
        store_id: STORE,
      });
      expect(prisma.crm_task_assignees.createMany.mock.calls[0][0].data[0]).toMatchObject({
        store_id: STORE,
      });
    });

    it('a failing support write leaves the error to the caller (the transaction rolls back)', async () => {
      as('owner');
      const { service, prisma, notifications } = setup();
      prisma.crm_task_assignees.createMany.mockRejectedValueOnce(new Error('fk'));
      await expect(
        service.update(50, { title: 'Otra', support_user_ids: [MARTA] }),
      ).rejects.toThrow('fk');
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it('nothing to write opens no transaction', async () => {
      as('seller');
      const { service, prisma } = setup();
      await service.update(50, {});
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('of two simultaneous completions only the one that completes moves the opportunity', async () => {
      as('seller');
      const { service, prisma, pipeline } = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102 },
      });
      // Both read it pending; the other request completed it first.
      prisma.crm_tasks.updateMany.mockResolvedValueOnce({ count: 0 });
      const done = await service.complete(50);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0].where).toEqual({
        id: 50,
        store_id: STORE,
        status: { not: 'done' },
      });
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
      expect(done).not.toHaveProperty('opportunity_move');

      await service.complete(50);
      expect(pipeline.moveForTask).toHaveBeenCalledTimes(1);
    });

    it('race: a PATCH with status and title saves the title and does not move the opportunity', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102 },
      });
      // Read pending; another request completes it before this one writes.
      const write = prisma.crm_tasks.updateMany.getMockImplementation()!;
      prisma.crm_tasks.updateMany.mockImplementation(async (args: any) =>
        args.where.status ? { count: 0 } : write(args),
      );
      const task = await service.update(50, { status: 'done', title: 'Nuevo título' });

      expect(prisma.crm_tasks.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 50, store_id: STORE },
        data: { title: 'Nuevo título' },
      });
      expect(prisma.crm_tasks.updateMany.mock.calls[1][0]).toEqual({
        where: { id: 50, store_id: STORE, status: { not: 'done' } },
        data: { status: 'done', completed_at: expect.any(Date) },
      });
      expect(task.title).toBe('Nuevo título');
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
      expect(task).not.toHaveProperty('opportunity_move');
    });
  });

  describe('choosing the opportunity to move when completing', () => {
    const chosen = { opportunity_id: 500, move_to_stage_id: 103 };

    it('without a body it completes as before and moves nothing', async () => {
      as('seller');
      const { service, prisma, pipeline } = setup();
      const done = await service.complete(50, {});
      expect(done).toMatchObject({ status: 'done', opportunity_move: null });
      expect(prisma.crm_opportunities.count).not.toHaveBeenCalled();
      expect(pipeline.assertTaskTargetStage).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('completes the task and moves the chosen open opportunity of its customer', async () => {
      as('seller');
      const { service, prisma, pipeline } = setup();
      const done = await service.complete(50, chosen);

      expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
        where: {
          id: 500,
          customer_id: CUSTOMER,
          status: 'open',
          owner_user_id: SELLER,
        },
      });
      expect(pipeline.assertTaskTargetStage).toHaveBeenCalledWith(500, 103);
      expect(prisma.crm_tasks.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 50, store_id: STORE, status: { not: 'done' } },
        data: { status: 'done', completed_at: expect.any(Date) },
      });
      expect(pipeline.moveForTask).toHaveBeenCalledWith(500, 103);
      expect(done).toMatchObject({
        status: 'done',
        opportunity_move: { moved: true, reason: null },
      });
      // The choice is not saved on the task: reopening and completing again
      // moves nothing.
      expect(done.move_to_stage).toBeNull();
    });

    it('an opportunity of another customer (or closed) is rejected and nothing is written', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup();
      prisma.crm_opportunities.count.mockResolvedValueOnce(0);
      expect(await codeOf(service.complete(50, chosen))).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
        where: { id: 500, customer_id: CUSTOMER, status: 'open' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('a stage of another board, inactive or lost is rejected and nothing is written', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup();
      pipeline.assertTaskTargetStage.mockRejectedValueOnce(
        new VendixHttpException(ErrorCodes.CRM_TASK_002),
      );
      expect(await codeOf(service.complete(50, chosen))).toBe('CRM_TASK_002');
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('who does not see the opportunity on the board cannot move it', async () => {
      // The seller helps on a task of STAFF; the opportunity is STAFF's.
      as('seller');
      const { service, prisma, pipeline } = setup({
        task: {
          assigned_user_id: STAFF,
          created_by_user_id: OWNER,
          supporters: [{ user: person(SELLER) }],
        },
      });
      prisma.crm_opportunities.count.mockResolvedValueOnce(0);
      expect(await codeOf(service.complete(50, chosen))).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.count.mock.calls[0][0].where).toMatchObject({
        owner_user_id: SELLER,
      });
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('a task without customer cannot move anything', async () => {
      as('owner');
      const { service, prisma } = setup({ task: { customer_id: null, customer: null } });
      expect(await codeOf(service.complete(50, chosen))).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.count).not.toHaveBeenCalled();
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
    });

    it('a task that already moves its opportunity does not take another choice', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup({
        task: { opportunity_id: 500, move_to_stage_id: 102 },
      });
      expect(await codeOf(service.complete(50, chosen))).toBe('CRM_TASK_004');
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('a task already done moves nothing', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup({
        task: { status: 'done', completed_at: new Date('2026-11-18T12:00:00Z') },
      });
      const task = await service.complete(50, chosen);
      expect(task.status).toBe('done');
      expect(task).not.toHaveProperty('opportunity_move');
      expect(prisma.crm_opportunities.count).not.toHaveBeenCalled();
      expect(prisma.crm_tasks.updateMany).not.toHaveBeenCalled();
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
    });

    it('completed by someone else meanwhile: the guard leaves it and nothing moves', async () => {
      as('owner');
      const { service, prisma, pipeline } = setup();
      prisma.crm_tasks.updateMany.mockResolvedValueOnce({ count: 0 });
      const task = await service.complete(50, chosen);
      expect(pipeline.assertTaskTargetStage).toHaveBeenCalledWith(500, 103);
      expect(pipeline.moveForTask).not.toHaveBeenCalled();
      expect(task).not.toHaveProperty('opportunity_move');
    });

    it('a failing move leaves the task completed and answers failed', async () => {
      as('owner');
      const { service, pipeline } = setup();
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      pipeline.moveForTask.mockRejectedValueOnce(new Error('boom'));
      expect(await service.complete(50, chosen)).toMatchObject({
        status: 'done',
        opportunity_move: { moved: false, reason: 'failed', stage: null },
      });
    });
  });

  describe('linked opportunity and customer', () => {
    it('the opportunity must be of the task customer', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_opportunities.count.mockResolvedValueOnce(0);
      expect(
        await codeOf(
          service.create({ title: 'X', customer_id: CUSTOMER, opportunity_id: 9 }),
        ),
      ).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
        where: { id: 9, customer_id: CUSTOMER },
      });
      expect(prisma.crm_tasks.create).not.toHaveBeenCalled();
    });

    it('a seller is checked by customer and ownership together', async () => {
      as('seller');
      const { service, prisma } = setup();
      await service.create({ title: 'X', customer_id: CUSTOMER, opportunity_id: 9 });
      expect(prisma.crm_opportunities.count).toHaveBeenCalledWith({
        where: { id: 9, customer_id: CUSTOMER, owner_user_id: SELLER },
      });
    });
  });

  describe('staff for the support picker', () => {
    const staffWhere = {
      state: 'active',
      user_roles: {
        some: {
          roles: {
            role_permissions: {
              some: {
                permissions: { name: 'store:crm_tasks:manage', status: 'active' },
              },
            },
          },
        },
      },
    };

    it('lists active staff with tasks permission, only id and name, up to 20', async () => {
      as('seller');
      const { service, prisma } = setup();
      expect(await service.staff({})).toEqual([person(LUIS, 'Luis'), person(MARTA, 'Marta')]);
      const args = prisma.store_users.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ user: staffWhere });
      expect(args.select).toEqual({
        user: { select: { id: true, first_name: true, last_name: true } },
      });
      expect(args.take).toBe(20);
    });

    it('every word of q matches the first or the last name', async () => {
      as('seller');
      const { service, prisma } = setup();
      await service.staff({ q: '  luis  pé ' });
      const name = (word: string) => ({
        OR: [
          { first_name: { contains: word, mode: 'insensitive' } },
          { last_name: { contains: word, mode: 'insensitive' } },
        ],
      });
      expect(prisma.store_users.findMany.mock.calls[0][0].where).toEqual({
        user: { ...staffWhere, AND: [name('luis'), name('pé')] },
      });
    });
  });
});
