import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmSegmentMembersService } from './crm-segment-members.service';

const STORE = 1;
const ANA = 11;
const LUIS = 12;
const TAG_RULE = { op: 'and', rules: [{ field: 'tag', cmp: 'eq', value: 4 }] };
const DELETED_TAG_RULE = { op: 'and', rules: [{ field: 'tag', cmp: 'eq', value: 8 }] };

function setup() {
  const prisma = {
    store_users: { findFirst: jest.fn().mockResolvedValue({ id: 50 }) },
    crm_segments: {
      findMany: jest.fn().mockResolvedValue([
        { id: 3, name: 'Frecuentes', filter: TAG_RULE, is_dynamic: true },
        { id: 5, name: 'Mayoristas', filter: { op: 'and', rules: [] }, is_dynamic: false },
        { id: 7, name: 'Roto', filter: DELETED_TAG_RULE, is_dynamic: true },
      ]),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 5, filter: { op: 'and', rules: [] }, is_dynamic: false }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crm_segment_members: {
      findMany: jest.fn().mockResolvedValue([
        { segment_id: 5, customer_id: ANA },
        { segment_id: 3, customer_id: LUIS },
      ]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    crm_customer_tags: {
      findMany: jest.fn().mockResolvedValue([
        { customer_id: ANA, tag: { id: 4, name: 'VIP', color: null } },
      ]),
    },
  };
  const query = {
    ruleMembersOf: jest.fn(
      async (segments: Array<{ id: number; filter: unknown }>, _ids: number[], _now: Date) =>
        new Map<number, number[] | Error>(
          segments.map((segment) => [
            segment.id,
            segment.filter === DELETED_TAG_RULE
              ? new Error('La etiqueta 8 no existe en esta tienda')
              : [ANA, LUIS],
          ]),
        ),
    ),
    resolveSaved: jest.fn(async (saved: unknown) => ({ saved })),
    count: jest.fn().mockResolvedValue(3),
  };
  const service = new CrmSegmentMembersService(prisma as never, query as never);
  return { service, prisma, query };
}

const as = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id: STORE, user_id: 9, is_super_admin: false, is_owner: true, permissions: [] },
    fn,
  );

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as VendixHttpException).errorCode;
  }
  return null;
};

describe('CrmSegmentMembersService', () => {
  it('tells rule, manual and both memberships apart, with the tags of each customer', async () => {
    const { service, query } = setup();
    const result = await as(() => service.membershipsOf([ANA, LUIS, ANA]));

    // One batched call for every rule segment; the manual one is not compiled.
    expect(query.ruleMembersOf).toHaveBeenCalledTimes(1);
    expect(query.ruleMembersOf).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: 3, filter: TAG_RULE }),
        expect.objectContaining({ id: 7, filter: DELETED_TAG_RULE }),
      ],
      [ANA, LUIS],
      expect.any(Date),
    );
    expect(result).toEqual([
      {
        customer_id: ANA,
        tags: [{ id: 4, name: 'VIP', color: null }],
        segments: [
          { id: 3, name: 'Frecuentes', is_dynamic: true, via: 'rule' },
          { id: 5, name: 'Mayoristas', is_dynamic: false, via: 'manual' },
        ],
      },
      {
        customer_id: LUIS,
        tags: [],
        segments: [{ id: 3, name: 'Frecuentes', is_dynamic: true, via: 'both' }],
      },
    ]);
  });

  it('answers nothing without asking the database when there are no customers', async () => {
    const { service, prisma } = setup();
    await expect(as(() => service.membershipsOf([]))).resolves.toEqual([]);
    expect(prisma.crm_segments.findMany).not.toHaveBeenCalled();
  });

  it('adds by hand once, stamped with the store and the author', async () => {
    const { service, prisma } = setup();
    const result = await as(() => service.add(ANA, 5));
    expect(prisma.crm_segment_members.createMany).toHaveBeenCalledWith({
      data: [{ store_id: STORE, segment_id: 5, customer_id: ANA, created_by_user_id: 9 }],
      skipDuplicates: true,
    });
    expect(result.customer_id).toBe(ANA);
    // The segment list shows the new size right away.
    expect(prisma.crm_segments.updateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { last_count: 3, last_counted_at: expect.any(Date) },
    });
  });

  it('removing deletes only the manual row of that customer', async () => {
    const { service, prisma } = setup();
    await as(() => service.remove(LUIS, 3));
    expect(prisma.crm_segment_members.deleteMany).toHaveBeenCalledWith({
      where: { segment_id: 3, customer_id: LUIS },
    });
    expect(prisma.crm_segments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 } }),
    );
  });

  it('a count that cannot be refreshed does not undo the membership change', async () => {
    const { service, prisma, query } = setup();
    query.count.mockRejectedValueOnce(new Error('regla rota'));
    const result = await as(() => service.add(ANA, 5));
    expect(prisma.crm_segment_members.createMany).toHaveBeenCalled();
    expect(prisma.crm_segments.updateMany).not.toHaveBeenCalled();
    expect(result.customer_id).toBe(ANA);
  });

  it('reading the segments of a customer of another store answers 404', async () => {
    const { service, prisma } = setup();
    prisma.store_users.findFirst.mockResolvedValueOnce(null);
    await expect(code(as(() => service.ofCustomer(ANA)))).resolves.toBe('CRM_CUSTOMER_001');
    expect(prisma.crm_segments.findMany).not.toHaveBeenCalled();
  });

  it('a customer or segment of another store answers 404 and writes nothing', async () => {
    const { service, prisma } = setup();
    prisma.store_users.findFirst.mockResolvedValueOnce(null);
    await expect(code(as(() => service.add(ANA, 5)))).resolves.toBe('CRM_CUSTOMER_001');

    prisma.crm_segments.findFirst.mockResolvedValueOnce(null);
    await expect(code(as(() => service.add(ANA, 99)))).resolves.toBe('CRM_SEGMENT_002');

    prisma.crm_segments.findFirst.mockResolvedValueOnce(null);
    await expect(code(as(() => service.remove(ANA, 99)))).resolves.toBe('CRM_SEGMENT_002');

    expect(prisma.crm_segment_members.createMany).not.toHaveBeenCalled();
    expect(prisma.crm_segment_members.deleteMany).not.toHaveBeenCalled();
    expect(prisma.crm_segments.updateMany).not.toHaveBeenCalled();
  });
});
