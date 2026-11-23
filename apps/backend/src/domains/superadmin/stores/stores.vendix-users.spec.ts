import { StoresService } from './stores.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

/**
 * `store_users` también vincula a los clientes de ecommerce. El Super Admin
 * cuenta como "Usuarios" de una tienda solo a su personal (usuarios de Vendix).
 */
const STAFF_COUNT = { where: { user: vendixUserWhere() } };

const storeRow = {
  id: 12,
  name: 'Tienda',
  slug: 'tienda',
  organization_id: 3,
  is_active: true,
  store_type: 'physical',
  organizations: { id: 3, name: 'Org', slug: 'org', state: 'active' },
  addresses: [],
  store_users: [],
  store_settings: null,
  _count: { store_users: 2, products: 5, orders: 9 },
};

describe('Superadmin StoresService — users are Vendix users only', () => {
  const prisma = createPrismaMock({
    stores: ['findMany', 'findFirst', 'findUnique', 'count', 'groupBy', 'delete'],
    currencies: ['findFirst'],
  });
  let service: StoresService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.stores.findMany.mockResolvedValue([]);
    prisma.stores.findFirst.mockResolvedValue(storeRow);
    prisma.stores.count.mockResolvedValue(0);
    prisma.stores.groupBy.mockResolvedValue([]);
    prisma.currencies.findFirst.mockResolvedValue(null);
    service = new StoresService(
      prisma as never,
      {} as never,
      {} as never,
      { signUrl: jest.fn() } as never,
    );
  });

  it('list: the "Usuarios" column counts only the store staff', async () => {
    await service.findAll({ page: 1, limit: 10 } as never);

    const [args] = prisma.stores.findMany.mock.calls[0];
    expect(args.include._count.select).toEqual({
      store_users: STAFF_COUNT,
      products: true,
      orders: true,
    });
  });

  it('detail: the "Usuarios" card counts only the store staff', async () => {
    const result = await service.findOne(12);

    const [args] = prisma.stores.findFirst.mock.calls[0];
    expect(args.include._count.select.store_users).toEqual(STAFF_COUNT);
    expect(result._count?.store_users).toBe(2);
  });

  it('stats: recent stores carry the staff count', async () => {
    await service.getDashboardStats();

    const [args] = prisma.stores.findMany.mock.calls[0];
    expect(args.include._count.select.store_users).toEqual(STAFF_COUNT);
  });

  it('delete guard still counts every link (customers included) and blocks', async () => {
    prisma.stores.findUnique.mockResolvedValue({
      ...storeRow,
      _count: { store_users: 1, products: 0, orders: 0 },
    });

    await expect(service.remove(12)).rejects.toThrow(
      'Cannot delete store with existing users, products, or orders',
    );
    const [args] = prisma.stores.findUnique.mock.calls[0];
    expect(args.include._count.select.store_users).toBe(true);
    expect(prisma.stores.delete).not.toHaveBeenCalled();
  });
});
