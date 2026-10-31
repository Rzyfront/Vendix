import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmTasksService } from './crm-tasks.service';

const STORE = 10;
const OWNER = 1;
const SELLER = 2;
const STAFF = 3;
const CUSTOMER = 4;

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
    customer: { id: CUSTOMER, first_name: 'Laura', last_name: 'Pérez' },
    assigned_user: { id: SELLER, first_name: 'Sam', last_name: null },
    created_by: { id: SELLER, first_name: 'Sam', last_name: null },
    opportunity: null,
    created_at: new Date('2026-10-30T12:00:00Z'),
    updated_at: new Date('2026-10-30T12:00:00Z'),
    ...overrides,
  };
}

function setup(options: { staff?: boolean; customer?: boolean } = {}) {
  let current = taskRow();
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
    },
    crm_opportunities: { count: jest.fn(async (..._args: any[]) => 1) },
    crm_conversations: { count: jest.fn(async (..._args: any[]) => 1) },
    crm_tasks: {
      count: jest.fn(async (..._args: any[]) => 1),
      findMany: jest.fn(async (..._args: any[]) => [current]),
      findFirst: jest.fn(async (..._args: any[]) => current),
      create: jest.fn(async ({ data }: any) => {
        current = taskRow({
          ...data,
          id: 51,
          assigned_user: data.assigned_user_id
            ? { id: data.assigned_user_id, first_name: 'X', last_name: null }
            : null,
        });
        return current;
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        current = { ...current, ...data };
        return { count: 1 };
      }),
    },
  };
  const notifications = { sendToUser: jest.fn(async (..._args: any[]) => null) };
  const service = new CrmTasksService(prisma as any, notifications as any);
  return { service, prisma, notifications };
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
  it('a seller only lists tasks assigned to or created by them', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.list({ assigned: 'all' });
    const where = prisma.crm_tasks.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({
      OR: [{ assigned_user_id: SELLER }, { created_by_user_id: SELLER }],
    });
  });

  it('owner lists the whole store; "me" is the default filter', async () => {
    as('owner');
    const { service, prisma } = setup();
    await service.list({});
    const where = prisma.crm_tasks.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{}, { assigned_user_id: OWNER }]);
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
      assigned_user_id: SELLER,
      status: 'pending',
      due_at: { lt: new Date('2026-10-30T15:00:00Z') },
    });
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
      where: { id: 50 },
      data: { status: 'done', completed_at: expect.any(Date) },
    });
    expect(done.status).toBe('done');

    await service.reopen(50);
    expect(prisma.crm_tasks.updateMany.mock.calls[1][0].data).toEqual({
      status: 'pending',
      completed_at: null,
    });
  });

  it('a task not visible to the seller answers 404', async () => {
    as('seller');
    const { service, prisma } = setup();
    prisma.crm_tasks.findFirst.mockResolvedValueOnce(null as any);
    expect(await codeOf(service.update(77, { title: 'Y' }))).toBe('CRM_TASK_001');
    expect(prisma.crm_tasks.findFirst.mock.calls[0][0].where).toEqual({
      AND: [
        { id: 77 },
        { OR: [{ assigned_user_id: SELLER }, { created_by_user_id: SELLER }] },
      ],
    });
  });

  it('reassigning notifies the new assignee only', async () => {
    as('owner');
    const { service, notifications } = setup();
    await service.update(50, { assigned_user_id: STAFF });
    expect(notifications.sendToUser).toHaveBeenCalledTimes(1);
    expect((notifications.sendToUser.mock.calls[0] as unknown[])[1]).toBe(STAFF);
  });
});
