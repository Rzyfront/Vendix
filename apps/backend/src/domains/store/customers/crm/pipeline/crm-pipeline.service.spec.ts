import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmPipelineService } from './crm-pipeline.service';
import { CrmQuotationListener } from './crm-quotation.listener';

const STORE = 10;
const OWNER = 1;
const SELLER = 2;
const STAFF = 3;
const CUSTOMER = 4;

const STAGES = [
  { id: 101, pipeline_id: 1, name: 'Nuevo', kind: 'open', probability: 10, color: null, sort_order: 0, is_active: true },
  { id: 102, pipeline_id: 1, name: 'Cotizado', kind: 'open', probability: 60, color: null, sort_order: 2, is_active: true },
  { id: 103, pipeline_id: 1, name: 'Ganado', kind: 'won', probability: 100, color: null, sort_order: 3, is_active: true },
  { id: 104, pipeline_id: 1, name: 'Perdido', kind: 'lost', probability: 0, color: null, sort_order: 4, is_active: true },
  { id: 201, pipeline_id: 2, name: 'Otro', kind: 'open', probability: null, color: null, sort_order: 0, is_active: true },
];

function as(user: 'owner' | 'seller') {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: STORE,
    user_id: user === 'owner' ? OWNER : SELLER,
    is_super_admin: false,
    is_owner: false,
    permissions:
      user === 'owner'
        ? ['store:crm_pipeline:read', 'store:crm_pipeline:manage', 'store:crm_inbox:assign']
        : ['store:crm_pipeline:read', 'store:crm_pipeline:manage'],
  });
}

function opportunity(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 500,
    store_id: STORE,
    customer_id: CUSTOMER,
    pipeline_id: 1,
    stage_id: 101,
    title: 'Dotación oficina',
    amount: new Prisma.Decimal('1500000'),
    currency: 'COP',
    status: 'open',
    owner_user_id: SELLER,
    quotation_id: null,
    order_id: null,
    expected_close_date: new Date('2026-11-15T00:00:00Z'),
    won_at: null,
    lost_at: null,
    lost_reason: null,
    sort_order: 0,
    created_at: new Date(),
    updated_at: new Date(),
    customer: { id: CUSTOMER, first_name: 'Laura', last_name: 'Pérez' },
    owner: { id: SELLER, first_name: 'Sam', last_name: null },
    quotation: null,
    ...overrides,
  };
  return { ...base, stage: STAGES.find((s) => s.id === base.stage_id) };
}

function setup(options: { staff?: boolean } = {}) {
  let current: any = opportunity();
  const prisma = {
    store_users: {
      findFirst: jest.fn(async (..._args: any[]) => (options.staff === false ? null : { id: 8 })),
      updateMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
    },
    quotations: { findFirst: jest.fn(async (..._args: any[]) => ({ customer_id: CUSTOMER })) },
    crm_pipelines: {
      findMany: jest.fn(async (..._args: any[]) => [
        { id: 1, name: 'Ventas', is_default: true, stages: STAGES.filter((s) => s.pipeline_id === 1) },
        { id: 2, name: 'Mayoristas', is_default: false, stages: STAGES.filter((s) => s.pipeline_id === 2) },
      ]),
      findFirst: jest.fn(async (..._args: any[]) => ({ id: 1 })),
    },
    crm_pipeline_stages: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        if (where.id) return STAGES.find((s) => s.id === where.id) ?? null;
        if (orderBy) {
          return (
            STAGES.find(
              (s) =>
                s.pipeline_id === where.pipeline_id &&
                (!where.kind || s.kind === where.kind) &&
                (where.is_active === undefined || s.is_active === where.is_active),
            ) ?? null
          );
        }
        return null;
      }),
      updateMany: jest.fn(async (..._args: any[]) => ({ count: 1 })),
      create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
    },
    crm_opportunities: {
      count: jest.fn(async (..._args: any[]) => 0),
      findMany: jest.fn(async (..._args: any[]) => [current]),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.stage_id !== undefined) return { sort_order: 4 };
        return current;
      }),
      create: jest.fn(async ({ data }: any) => {
        current = opportunity({ ...data, id: 501 });
        return current;
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        current = opportunity({ ...current, ...data });
        return { count: 1 };
      }),
    },
  } as Record<string, any>;
  prisma.withoutScope = () => prisma;
  const audit = { log: jest.fn(async (..._args: any[]) => undefined) };
  const bootstrap = { ensureDefaultCrmPipeline: jest.fn(async (..._args: any[]) => ({ id: 1 })) };
  const service = new CrmPipelineService(prisma as any, audit as any, bootstrap as any);
  return { service, prisma, audit, bootstrap };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

afterEach(() => jest.restoreAllMocks());

describe('CrmPipelineService', () => {
  it('creates the default pipeline when the store has none', async () => {
    as('owner');
    const { service, prisma, bootstrap } = setup();
    prisma.crm_pipelines.findMany.mockResolvedValueOnce([]);
    await service.listPipelines();
    expect(bootstrap.ensureDefaultCrmPipeline).toHaveBeenCalledWith({ store_id: STORE });
  });

  it('board groups cards by stage with count, total and stage probability', async () => {
    as('owner');
    const { service } = setup();
    const board = await service.board({});

    expect(board.pipeline).toEqual({ id: 1, name: 'Ventas', is_default: true });
    expect(board.stages.map((stage) => [stage.id, stage.count])).toEqual([
      [101, 1],
      [102, 0],
      [103, 0],
      [104, 0],
    ]);
    expect(board.stages[0].total_amount).toBe('1500000.00');
    expect(board.stages[0].opportunities[0]).toMatchObject({
      id: 500,
      amount: '1500000',
      probability: 10,
      expected_close_date: '2026-11-15',
      owner: { id: SELLER },
    });
  });

  it('a seller only sees the opportunities they own', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.board({});
    expect(prisma.crm_opportunities.findMany.mock.calls[0][0].where.AND).toEqual([
      { pipeline_id: 1 },
      { owner_user_id: SELLER },
    ]);
  });

  it('creates in the first open stage, owned by its creator', async () => {
    as('seller');
    const { service, prisma } = setup();
    const created = await service.create({
      customer_id: CUSTOMER,
      title: ' Uniformes ',
      amount: 800000,
      expected_close_date: '2026-12-01',
    });
    expect(prisma.crm_opportunities.create.mock.calls[0][0].data).toMatchObject({
      store_id: STORE,
      customer_id: CUSTOMER,
      pipeline_id: 1,
      stage_id: 101,
      title: 'Uniformes',
      amount: 800000,
      owner_user_id: SELLER,
      status: 'open',
      sort_order: 5,
      expected_close_date: new Date('2026-12-01T00:00:00.000Z'),
    });
    expect(created.id).toBe(501);
  });

  it('placing a customer on the board moves their profile stage too', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.create({ customer_id: CUSTOMER, title: 'Uniformes', stage_id: 102 });
    expect(prisma.store_users.updateMany).toHaveBeenLastCalledWith({
      where: { user_id: CUSTOMER },
      data: { crm_stage_id: 102 },
    });

    await service.move(501, { stage_id: 103 });
    expect(prisma.store_users.updateMany).toHaveBeenLastCalledWith({
      where: { user_id: CUSTOMER },
      data: { crm_stage_id: 103 },
    });
  });

  it('a rejected move leaves the profile stage alone', async () => {
    as('seller');
    const { service, prisma } = setup();
    await codeOf(service.move(500, { stage_id: 104 }));
    expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
  });

  it('a seller cannot give an opportunity to someone else', async () => {
    as('seller');
    const { service, prisma } = setup();
    expect(
      await codeOf(
        service.create({ customer_id: CUSTOMER, title: 'X', owner_user_id: STAFF }),
      ),
    ).toBe('CRM_ASSIGN_001');
    expect(prisma.crm_opportunities.create).not.toHaveBeenCalled();
  });

  it('rejects a quotation of another customer', async () => {
    as('owner');
    const { service, prisma } = setup();
    prisma.quotations.findFirst.mockResolvedValueOnce({ customer_id: 999 });
    expect(
      await codeOf(service.create({ customer_id: CUSTOMER, title: 'X', quotation_id: 7 })),
    ).toBe('CRM_OPPORTUNITY_002');
  });

  it('moving into a won stage wins it and stamps won_at', async () => {
    as('seller');
    const { service, prisma, audit } = setup();
    const moved = await service.move(500, { stage_id: 103 });
    expect(prisma.crm_opportunities.updateMany.mock.calls[0][0].data).toMatchObject({
      stage_id: 103,
      status: 'won',
      won_at: expect.any(Date),
      lost_at: null,
      lost_reason: null,
    });
    expect(moved.status).toBe('won');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'crm_opportunities',
        oldValues: { status: 'open', stage_id: 101 },
      }),
    );
  });

  it('moving into a lost stage needs a reason', async () => {
    as('seller');
    const { service, prisma } = setup();
    expect(await codeOf(service.move(500, { stage_id: 104 }))).toBe('CRM_PIPELINE_003');
    expect(prisma.crm_opportunities.updateMany).not.toHaveBeenCalled();

    const lost = await service.lose(500, 'Precio');
    expect(lost).toMatchObject({ status: 'lost', lost_reason: 'Precio', stage_id: 104 });
  });

  it('moving back to an open stage reopens and clears the close data', async () => {
    as('seller');
    const { service, prisma } = setup();
    prisma.crm_opportunities.findFirst.mockResolvedValueOnce(
      opportunity({ stage_id: 104, status: 'lost', lost_reason: 'Precio', lost_at: new Date() }),
    );
    await service.move(500, { stage_id: 102, sort_order: 0 });
    expect(prisma.crm_opportunities.updateMany.mock.calls[0][0].data).toEqual({
      stage_id: 102,
      sort_order: 0,
      status: 'open',
      won_at: null,
      lost_at: null,
      lost_reason: null,
    });
  });

  it('rejects a stage of another pipeline', async () => {
    as('owner');
    const { service } = setup();
    expect(await codeOf(service.move(500, { stage_id: 201 }))).toBe('CRM_PIPELINE_002');
  });

  it('an opportunity the seller does not own answers 404', async () => {
    as('seller');
    const { service, prisma } = setup();
    prisma.crm_opportunities.findFirst.mockResolvedValueOnce(null);
    expect(await codeOf(service.win(600))).toBe('CRM_OPPORTUNITY_001');
  });

  describe('remove (QUI-1043 H2)', () => {
    it('deletes the opportunity, audits its snapshot and the customer follows its latest remaining one', async () => {
      as('owner');
      const { service, prisma, audit } = setup();
      prisma.crm_opportunities.deleteMany = jest.fn(async (..._args: any[]) => ({ count: 1 }));
      prisma.crm_opportunities.findFirst
        .mockResolvedValueOnce(opportunity())
        .mockResolvedValueOnce({ stage_id: 102 });

      await expect(service.remove(500)).resolves.toEqual({ id: 500 });

      expect(prisma.crm_opportunities.deleteMany).toHaveBeenCalledWith({ where: { id: 500 } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: OWNER,
          storeId: STORE,
          action: 'DELETE',
          resource: 'crm_opportunities',
          resourceId: 500,
          oldValues: expect.objectContaining({
            id: 500,
            title: 'Dotación oficina',
            amount: '1500000',
            stage_id: 101,
            customer: expect.objectContaining({ id: CUSTOMER }),
          }),
        }),
      );
      expect(prisma.crm_opportunities.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { customer_id: CUSTOMER } }),
      );
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: { user_id: CUSTOMER },
        data: { crm_stage_id: 102 },
      });
    });

    it('with no opportunity left the customer keeps the stage it reached', async () => {
      as('owner');
      const { service, prisma } = setup();
      prisma.crm_opportunities.deleteMany = jest.fn(async (..._args: any[]) => ({ count: 1 }));
      prisma.crm_opportunities.findFirst
        .mockResolvedValueOnce(opportunity())
        .mockResolvedValueOnce(null);

      await service.remove(500);

      expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
    });

    it('an opportunity the seller cannot see answers 404 and nothing is deleted or audited', async () => {
      as('seller');
      const { service, prisma, audit } = setup();
      prisma.crm_opportunities.deleteMany = jest.fn(async (..._args: any[]) => ({ count: 1 }));
      prisma.crm_opportunities.findFirst.mockResolvedValueOnce(null);

      expect(await codeOf(service.remove(600))).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ id: 600 }, { owner_user_id: SELLER }] },
        }),
      );
      expect(prisma.crm_opportunities.deleteMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });
  });

  it('only see-all edits stages, and an active stage with open cards cannot be deactivated', async () => {
    as('seller');
    const seller = setup();
    expect(await codeOf(seller.service.updateStage(101, { is_active: false }))).toBe(
      'CRM_PIPELINE_007',
    );

    jest.restoreAllMocks();
    as('owner');
    const owner = setup();
    owner.prisma.crm_opportunities.count.mockResolvedValueOnce(2);
    expect(await codeOf(owner.service.updateStage(101, { is_active: false }))).toBe(
      'CRM_PIPELINE_006',
    );
    expect(owner.prisma.crm_pipeline_stages.updateMany).not.toHaveBeenCalled();
  });

  describe('tasks that move the opportunity', () => {
    it('lists the open opportunities of a customer with board, stage and active stages, seller only theirs', async () => {
      as('seller');
      const { service, prisma } = setup();
      prisma.crm_opportunities.findMany.mockResolvedValueOnce([
        {
          id: 500,
          title: 'Dotación oficina',
          stage: STAGES[0],
          pipeline: { id: 1, name: 'Ventas', stages: STAGES.slice(0, 4) },
        },
      ]);

      const rows = await service.openForCustomer({ customer_id: CUSTOMER });

      const args = prisma.crm_opportunities.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        AND: [{ customer_id: CUSTOMER, status: 'open' }, { owner_user_id: SELLER }],
      });
      expect(args.select.pipeline.select.stages.where).toEqual({ is_active: true });
      expect(rows).toEqual([
        {
          id: 500,
          title: 'Dotación oficina',
          pipeline: { id: 1, name: 'Ventas' },
          stage: STAGES[0],
          stages: STAGES.slice(0, 4),
        },
      ]);
    });

    it('a target stage must be an active, non-lost stage of the opportunity board', async () => {
      as('seller');
      const { service, prisma } = setup();
      await expect(service.assertTaskTargetStage(500, 102)).resolves.toBeUndefined();
      await expect(service.assertTaskTargetStage(500, 103)).resolves.toBeUndefined();
      expect(await codeOf(service.assertTaskTargetStage(500, 104))).toBe('CRM_TASK_002');
      expect(await codeOf(service.assertTaskTargetStage(500, 201))).toBe('CRM_TASK_002');
      expect(await codeOf(service.assertTaskTargetStage(500, 999))).toBe('CRM_TASK_002');
      prisma.crm_pipeline_stages.findFirst.mockResolvedValueOnce({ ...STAGES[1], is_active: false });
      expect(await codeOf(service.assertTaskTargetStage(500, 102))).toBe('CRM_TASK_002');
    });

    it('completing the task moves the opportunity like the board, even for someone who does not own it', async () => {
      as('owner');
      const { service, prisma, audit } = setup();
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: STORE,
        user_id: STAFF,
        is_super_admin: false,
        is_owner: false,
        permissions: ['store:crm_tasks:manage'],
      });

      const move = await service.moveForTask(500, 102);

      expect(move).toEqual({
        moved: true,
        reason: null,
        stage: { id: 102, name: 'Cotizado', kind: 'open' },
      });
      expect(prisma.crm_opportunities.findFirst.mock.calls[0][0].where).toEqual({ id: 500 });
      expect(prisma.crm_opportunities.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 500 },
        data: { stage_id: 102, status: 'open', sort_order: 5 },
      });
      expect(prisma.store_users.updateMany).toHaveBeenCalledWith({
        where: { user_id: CUSTOMER },
        data: { crm_stage_id: 102 },
      });
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('a won target stage wins the opportunity', async () => {
      as('seller');
      const { service, prisma, audit } = setup();
      const move = await service.moveForTask(500, 103);
      expect(move.moved).toBe(true);
      expect(prisma.crm_opportunities.updateMany.mock.calls[0][0].data).toMatchObject({
        stage_id: 103,
        status: 'won',
        won_at: expect.any(Date),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { reason: 'crm_opportunity_status' } }),
      );
    });

    it('nothing moves when the opportunity is closed, gone, already there or the stage is no longer valid', async () => {
      as('owner');
      const { service, prisma } = setup();

      prisma.crm_opportunities.findFirst.mockResolvedValueOnce(opportunity({ status: 'won', stage_id: 103 }));
      expect(await service.moveForTask(500, 102)).toEqual({
        moved: false,
        reason: 'opportunity_closed',
        stage: { id: 102, name: 'Cotizado', kind: 'open' },
      });

      prisma.crm_opportunities.findFirst.mockResolvedValueOnce(null);
      expect((await service.moveForTask(500, 102)).reason).toBe('opportunity_missing');

      expect((await service.moveForTask(500, 101)).reason).toBe('already_in_stage');
      expect((await service.moveForTask(500, 104)).reason).toBe('stage_unavailable');
      expect((await service.moveForTask(500, 201)).reason).toBe('stage_unavailable');

      expect(prisma.crm_opportunities.updateMany).not.toHaveBeenCalled();
    });

    it('the board still only lets a seller move what they own', async () => {
      as('seller');
      const { service, prisma } = setup();
      prisma.crm_opportunities.findFirst.mockResolvedValueOnce(null);
      expect(await codeOf(service.move(500, { stage_id: 102 }))).toBe('CRM_OPPORTUNITY_001');
      expect(prisma.crm_opportunities.findFirst.mock.calls[0][0].where).toEqual({
        AND: [{ id: 500 }, { owner_user_id: SELLER }],
      });
      expect(prisma.crm_opportunities.updateMany).not.toHaveBeenCalled();
    });
  });

  it('winByQuotation wins only open opportunities of the store and links the order', async () => {
    as('owner');
    const { service, prisma } = setup();
    prisma.crm_opportunities.findMany.mockResolvedValueOnce([
      { id: 500, pipeline_id: 1, customer_id: 42 },
    ]);
    const won = await service.winByQuotation(STORE, 7, 88);
    expect(won).toBe(1);
    expect(prisma.crm_opportunities.findMany.mock.calls[0][0].where).toEqual({
      store_id: STORE,
      quotation_id: 7,
      status: 'open',
    });
    expect(prisma.crm_opportunities.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 500, status: 'open' },
      data: expect.objectContaining({
        stage_id: 103,
        status: 'won',
        won_at: expect.any(Date),
        order_id: 88,
      }),
    });
    // The profile stage follows the won stage, in the store of the event.
    expect(prisma.store_users.updateMany).toHaveBeenLastCalledWith({
      where: { store_id: STORE, user_id: 42 },
      data: { crm_stage_id: 103 },
    });
  });
});

describe('CrmQuotationListener', () => {
  it('accepting or converting a linked quotation wins its opportunities', async () => {
    const pipeline = { winByQuotation: jest.fn(async (..._args: any[]) => 1) };
    const listener = new CrmQuotationListener(pipeline as any);
    await listener.handleAccepted({ store_id: STORE, quotation_id: 7 });
    await listener.handleConverted({ store_id: STORE, quotation_id: 7, order_id: 88 });
    expect(pipeline.winByQuotation.mock.calls).toEqual([
      [STORE, 7, null],
      [STORE, 7, 88],
    ]);
  });

  it('never throws back into the quotation flow', async () => {
    const pipeline = {
      winByQuotation: jest.fn(async (..._args: any[]) => {
        throw new Error('db down');
      }),
    };
    const listener = new CrmQuotationListener(pipeline as any);
    await expect(
      listener.handleAccepted({ store_id: STORE, quotation_id: 7 }),
    ).resolves.toBeUndefined();
  });

  it('ignores an event without store', async () => {
    const pipeline = { winByQuotation: jest.fn() };
    const listener = new CrmQuotationListener(pipeline as any);
    await listener.handleConverted({ quotation_id: 7 });
    expect(pipeline.winByQuotation).not.toHaveBeenCalled();
  });
});
