import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../../../common/errors';
import { CrmTagsService } from './crm-tags.service';

const STORE = 10;

const VIP = {
  id: 1,
  store_id: STORE,
  name: 'VIP',
  color: null,
  group_name: 'Valor',
  description: 'Gasta más de 1M al mes.',
};

function setup() {
  const prisma = {
    crm_tags: {
      findMany: jest.fn(async () => [{ ...VIP, _count: { customer_tags: 3 } }]),
      findFirst: jest.fn(async ({ where }: any) => (where.id === 1 ? { ...VIP } : null)),
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
  it('lists tags with how many customers carry each, grouped then by name', async () => {
    const { service, prisma } = setup();
    expect(await service.list()).toEqual([
      {
        id: 1,
        store_id: STORE,
        name: 'VIP',
        color: null,
        group_name: 'Valor',
        description: 'Gasta más de 1M al mes.',
        customers_count: 3,
      },
    ]);
    // ASC deja los NULL al final en Postgres: las etiquetas sin grupo cierran.
    expect(prisma.crm_tags.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ group_name: 'asc' }, { name: 'asc' }],
      }),
    );
  });

  it('creates a trimmed tag in the store of the request, without group or note', async () => {
    const { service, prisma } = setup();
    await service.create({ name: '  Mayorista ', color: '#0a0' });
    expect(prisma.crm_tags.create).toHaveBeenCalledWith({
      data: {
        store_id: STORE,
        name: 'Mayorista',
        color: '#0a0',
        group_name: null,
        description: null,
      },
    });
  });

  it('creates a tag with its group and its «cuándo se pone»', async () => {
    const { service, prisma } = setup();
    await service.create({
      name: 'Frío',
      group_name: 'Temperatura',
      description: '  No compra desde hace 90 días.  ',
    });
    expect(prisma.crm_tags.create).toHaveBeenCalledWith({
      data: {
        store_id: STORE,
        name: 'Frío',
        color: null,
        group_name: 'Temperatura',
        description: 'No compra desde hace 90 días.',
      },
    });
  });

  it('an empty note is stored as null, never as blank text', async () => {
    const { service, prisma } = setup();
    await service.create({ name: 'Nueva', description: '   ' });
    expect(prisma.crm_tags.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ description: null }),
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

  it('updates only the fields that came in the patch', async () => {
    const { service, prisma } = setup();
    await service.update(1, { name: '  VIP oro ' });
    expect(prisma.crm_tags.updateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { name: 'VIP oro' },
    });
  });

  it('moves a tag to another group and rewrites its note, trimmed', async () => {
    const { service, prisma } = setup();
    await service.update(1, {
      group_name: 'Prioridad',
      description: '  Llamar antes de cada campaña.  ',
    });
    expect(prisma.crm_tags.updateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        group_name: 'Prioridad',
        description: 'Llamar antes de cada campaña.',
      },
    });
  });

  it('clearing the group and the note sends null, not an empty string', async () => {
    const { service, prisma } = setup();
    await service.update(1, { group_name: null, description: null });
    expect(prisma.crm_tags.updateMany).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { group_name: null, description: null },
    });
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
