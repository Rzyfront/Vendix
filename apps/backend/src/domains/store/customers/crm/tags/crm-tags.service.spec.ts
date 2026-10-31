import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmTagsService } from './crm-tags.service';

const STORE = 10;

function setup() {
  const prisma = {
    crm_tags: {
      findMany: jest.fn(async () => [
        { id: 1, store_id: STORE, name: 'VIP', color: null, _count: { customer_tags: 3 } },
      ]),
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 1 ? { id: 1, store_id: STORE, name: 'VIP', color: null } : null,
      ),
      create: jest.fn(async ({ data }: any) => ({ id: 2, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return { service: new CrmTagsService(prisma as any), prisma };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(VendixHttpException);
  return (error as VendixHttpException).errorCode;
}

beforeEach(() => {
  jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
    store_id: STORE,
    user_id: 1,
    is_super_admin: false,
    is_owner: true,
  });
});
afterEach(() => jest.restoreAllMocks());

describe('CrmTagsService', () => {
  it('lists tags with how many customers carry each', async () => {
    const { service } = setup();
    expect(await service.list()).toEqual([
      { id: 1, store_id: STORE, name: 'VIP', color: null, customers_count: 3 },
    ]);
  });

  it('creates a trimmed tag in the store of the request', async () => {
    const { service, prisma } = setup();
    await service.create({ name: '  Mayorista ', color: '#0a0' });
    expect(prisma.crm_tags.create).toHaveBeenCalledWith({
      data: { store_id: STORE, name: 'Mayorista', color: '#0a0' },
    });
  });

  it('a duplicated name answers CRM_TAG_002', async () => {
    const { service, prisma } = setup();
    prisma.crm_tags.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(await codeOf(service.create({ name: 'VIP' }))).toBe('CRM_TAG_002');
  });

  it('a tag of another store is not found and is never deleted', async () => {
    const { service, prisma } = setup();
    expect(await codeOf(service.remove(99))).toBe('CRM_TAG_001');
    expect(prisma.crm_tags.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes only the tag (its assignments cascade, never customers)', async () => {
    const { service, prisma } = setup();
    expect(await service.remove(1)).toEqual({ id: 1 });
    expect(prisma.crm_tags.deleteMany).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
