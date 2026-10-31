import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CustomerCrmService } from './customer-crm.service';

const STORE = 10;
const OWNER = 1;
const SELLER = 2;
const STAFF = 3;
const CUSTOMER = 4;
const DAY = 86_400_000;

function as(user: 'owner' | 'seller') {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: STORE,
    user_id: user === 'owner' ? OWNER : SELLER,
    is_super_admin: false,
    is_owner: false,
    permissions:
      user === 'owner'
        ? ['store:customers:read', 'store:customers:update', 'store:crm_inbox:assign']
        : ['store:customers:read', 'store:customers:update'],
  });
}

function membershipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    crm_source: 'pos',
    crm_last_contact_at: null,
    whatsapp_consent: 'unknown',
    sms_consent: 'unknown',
    email_consent: 'opted_in',
    consent_updated_at: null,
    crm_owner: null,
    crm_stage: null,
    ...overrides,
  };
}

function setup(options: { member?: boolean; staff?: boolean } = {}) {
  const now = Date.now();
  const prisma = {
    store_users: {
      // 1st call: membership of the customer; others: staff lookup.
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.user_id === CUSTOMER) {
          return options.member === false ? null : membershipRow();
        }
        return options.staff === false ? null : { id: 5 };
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    users: {
      findUnique: jest.fn(async () => ({
        id: CUSTOMER,
        first_name: 'Laura',
        last_name: 'Pérez',
      })),
    },
    crm_customer_tags: {
      findMany: jest.fn(async () => [
        { tag: { id: 1, name: 'VIP', color: '#f00' } },
      ]),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 1 })),
    },
    crm_tags: { count: jest.fn(async () => 1) },
    crm_tasks: { count: jest.fn(async () => 2) },
    crm_opportunities: {
      aggregate: jest.fn(async () => ({
        _count: { _all: 1 },
        _sum: { amount: new Prisma.Decimal('300000') },
      })),
    },
    crm_pipeline_stages: { findFirst: jest.fn(async () => ({ id: 7 })) },
    crm_notes: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(),
    },
  };
  // Five buyers: the customer bought yesterday, often and the most.
  const population = [
    { customer_id: CUSTOMER, orders: 12, spent: '900000', days: 1 },
    { customer_id: 20, orders: 1, spent: '10000', days: 300 },
    { customer_id: 21, orders: 2, spent: '20000', days: 200 },
    { customer_id: 22, orders: 3, spent: '30000', days: 100 },
    { customer_id: 23, orders: 4, spent: '40000', days: 50 },
  ].map((row) => ({
    customer_id: row.customer_id,
    _count: { _all: row.orders },
    _sum: { grand_total: new Prisma.Decimal(row.spent) },
    _max: { created_at: new Date(now - row.days * DAY) },
  }));
  const customers = {
    getSegmentPopulationForAgent: jest.fn(async () => population),
  };
  const history = { getCrmTimeline: jest.fn(async () => ({ data: [], meta: {} })) };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new CustomerCrmService(
    prisma as any,
    audit as any,
    customers as any,
    history as any,
  );
  return { service, prisma, audit, customers, history };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(VendixHttpException);
  expect((error as VendixHttpException).errorCode).toBe(code);
}

afterEach(() => jest.restoreAllMocks());

describe('CustomerCrmService', () => {
  it('returns the CRM profile with tags, counters and RFM', async () => {
    as('owner');
    const { service } = setup();
    const profile = await service.getProfile(CUSTOMER);

    expect(profile).toMatchObject({
      customer: { id: CUSTOMER, first_name: 'Laura' },
      owner: null,
      source: 'pos',
      stage: null,
      consents: { whatsapp: 'unknown', sms: 'unknown', email: 'opted_in' },
      tags: [{ id: 1, name: 'VIP', color: '#f00' }],
      open_tasks: 2,
      open_opportunities: { count: 1, amount: '300000' },
    });
    expect(profile.rfm).toMatchObject({
      period_days: 365,
      recency_days: 1,
      frequency: 12,
      monetary: '900000.00',
      segment: 'Campeones',
    });
    expect(profile.rfm.scores).toEqual({ r: 5, f: 5, m: 5 });
  });

  it('a customer of another store answers 404', async () => {
    as('owner');
    const { service } = setup({ member: false });
    await rejectsWith(service.getProfile(CUSTOMER), 'CRM_CUSTOMER_001');
  });

  it('without assign a seller cannot change the owner', async () => {
    as('seller');
    const { service, prisma } = setup();
    await rejectsWith(
      service.updateProfile(CUSTOMER, { owner_user_id: SELLER }),
      'CRM_PROFILE_001',
    );
    expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
  });

  it('the owner must be active staff of the store', async () => {
    as('owner');
    const { service, prisma } = setup({ staff: false });
    await rejectsWith(
      service.updateProfile(CUSTOMER, { owner_user_id: STAFF }),
      'CRM_STAFF_001',
    );
    expect(prisma.store_users.updateMany).not.toHaveBeenCalled();
  });

  it('updates owner, source, stage and consents and audits the change', async () => {
    as('owner');
    const { service, prisma, audit } = setup();
    await service.updateProfile(CUSTOMER, {
      owner_user_id: STAFF,
      source: 'whatsapp',
      stage_id: 7,
      consents: { whatsapp: 'opted_in' },
    });

    const call = (prisma.store_users.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: 99 });
    expect(call.data).toMatchObject({
      crm_owner_user_id: STAFF,
      crm_source: 'whatsapp',
      crm_stage_id: 7,
      whatsapp_consent: 'opted_in',
    });
    expect(call.data.consent_updated_at).toBeInstanceOf(Date);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'customer_crm_profile',
        resourceId: CUSTOMER,
        oldValues: expect.objectContaining({ crm_owner_user_id: null }),
      }),
    );
  });

  it('a seller can change source and stage (no owner)', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.updateProfile(CUSTOMER, { source: 'referral', stage_id: null });
    expect((prisma.store_users.updateMany as jest.Mock).mock.calls[0][0].data).toEqual({
      crm_source: 'referral',
      crm_stage_id: null,
    });
  });

  it('rejects a stage that does not exist in the store', async () => {
    as('owner');
    const { service, prisma } = setup();
    (prisma.crm_pipeline_stages.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await rejectsWith(
      service.updateProfile(CUSTOMER, { stage_id: 123 }),
      'CRM_PIPELINE_001',
    );
  });

  it('setTags rejects a tag of another store and writes nothing', async () => {
    as('owner');
    const { service, prisma } = setup();
    (prisma.crm_tags.count as jest.Mock).mockResolvedValueOnce(1);
    await rejectsWith(service.setTags(CUSTOMER, [1, 2]), 'CRM_TAG_001');
    expect(prisma.crm_customer_tags.deleteMany).not.toHaveBeenCalled();
  });

  it('setTags replaces the set: removes the rest, adds the missing', async () => {
    as('owner');
    const { service, prisma } = setup();
    const tags = await service.setTags(CUSTOMER, [1, 1]);

    expect(prisma.crm_customer_tags.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: CUSTOMER, tag_id: { notIn: [1] } },
    });
    expect(prisma.crm_customer_tags.createMany).toHaveBeenCalledWith({
      data: [
        { store_id: STORE, customer_id: CUSTOMER, tag_id: 1, created_by_user_id: OWNER },
      ],
      skipDuplicates: true,
    });
    expect(tags).toEqual([{ id: 1, name: 'VIP', color: '#f00' }]);
  });

  it('notes: creates with the author and trims the body', async () => {
    as('seller');
    const { service, prisma } = setup();
    await service.createNote(CUSTOMER, { body: '  Llamar el lunes  ' });
    expect(prisma.crm_notes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          store_id: STORE,
          customer_id: CUSTOMER,
          body: 'Llamar el lunes',
          is_pinned: false,
          created_by_user_id: SELLER,
        },
      }),
    );
  });

  it('notes: a seller cannot edit someone else’s note', async () => {
    as('seller');
    const { service, prisma } = setup();
    await rejectsWith(
      service.updateNote(CUSTOMER, 5, { is_pinned: true }),
      'CRM_NOTE_001',
    );
    expect(prisma.crm_notes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5, customer_id: CUSTOMER, created_by_user_id: SELLER },
      }),
    );
  });

  it('timeline passes the viewer so a seller sees only their own', async () => {
    as('seller');
    const { service, history } = setup();
    await service.timeline(CUSTOMER, {
      types: ['message'],
      before: '2026-10-29T12:00:00.000Z',
    });
    expect(history.getCrmTimeline).toHaveBeenCalledWith(CUSTOMER, {
      types: ['message'],
      before: new Date('2026-10-29T12:00:00.000Z'),
      limit: 20,
      viewer: { store_id: STORE, user_id: SELLER, can_see_all: false },
    });
  });
});

