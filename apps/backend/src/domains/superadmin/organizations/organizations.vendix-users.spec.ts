import { OrganizationsService } from './organizations.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import {
  vendixUserWhere,
  withVendixUser,
} from '@common/utils/vendix-user.util';

const USERS_COUNT = { where: vendixUserWhere() };

const organizationRow = {
  id: 3,
  name: 'Org',
  slug: 'org',
  organization_settings: null,
  addresses: [],
  _count: { stores: 2, users: 4, addresses: 0, suppliers: 0, employees: 1 },
};

/**
 * Regla: las cifras de "usuarios" de una organización cuentan usuarios de
 * Vendix (personal), nunca a los clientes finales de sus tiendas.
 */
describe('Superadmin OrganizationsService — users are Vendix users only', () => {
  const prisma = createPrismaMock({
    organizations: ['findMany', 'findUnique', 'count'],
    users: ['count'],
    stores: ['count', 'findMany'],
    orders: ['count', 'aggregate', 'findMany'],
  });
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organizations.findMany.mockResolvedValue([]);
    prisma.organizations.findUnique.mockResolvedValue(organizationRow);
    prisma.organizations.count.mockResolvedValue(0);
    prisma.users.count.mockResolvedValue(0);
    prisma.stores.count.mockResolvedValue(0);
    prisma.stores.findMany.mockResolvedValue([]);
    prisma.orders.count.mockResolvedValue(0);
    prisma.orders.aggregate.mockResolvedValue({ _sum: { grand_total: 0 } });
    prisma.orders.findMany.mockResolvedValue([]);
    service = new OrganizationsService(prisma as never, {} as never);
  });

  it('list: the users column counts only Vendix users', async () => {
    await service.findAll({ page: 1, limit: 10 } as never);

    const [args] = prisma.organizations.findMany.mock.calls[0];
    expect(args.include._count.select).toEqual({
      users: USERS_COUNT,
      stores: true,
    });
  });

  it('detail: the "Usuarios" card counts only Vendix users', async () => {
    const result = await service.findOne(3);

    const [args] = prisma.organizations.findUnique.mock.calls[0];
    expect(args.include._count.select.users).toEqual(USERS_COUNT);
    expect(result._count?.users).toBe(4);
  });

  it('stats: recent organizations carry the Vendix-user count', async () => {
    await service.getDashboardStats();

    const [args] = prisma.organizations.findMany.mock.calls[0];
    expect(args.select._count.select).toEqual({
      stores: true,
      users: USERS_COUNT,
    });
  });

  it('organization dashboard: total/active users and top stores exclude end customers', async () => {
    prisma.users.count.mockResolvedValueOnce(4).mockResolvedValueOnce(3);

    const result = await service.getDashboard(3, {} as never);

    expect(prisma.users.count.mock.calls.map(([a]) => a.where)).toEqual([
      withVendixUser({ organization_id: 3 }),
      withVendixUser({ organization_id: 3, state: 'active' }),
    ]);
    expect(result.stats).toEqual(
      expect.objectContaining({ totalUsers: 4, activeUsers: 3 }),
    );
    const [topStoresArgs] = prisma.stores.findMany.mock.calls[0];
    expect(topStoresArgs.include._count.select.store_users).toEqual({
      where: { user: vendixUserWhere() },
    });
  });

  it('delete guard still counts every user (customers included) and blocks', async () => {
    prisma.organizations.findUnique.mockResolvedValue({
      ...organizationRow,
      _count: { stores: 0, users: 1 },
    });

    await expect(service.remove(3)).rejects.toThrow(
      'Cannot delete organization with existing stores or users',
    );
    const [args] = prisma.organizations.findUnique.mock.calls[0];
    expect(args.include._count.select).toEqual({ stores: true, users: true });
  });
});
