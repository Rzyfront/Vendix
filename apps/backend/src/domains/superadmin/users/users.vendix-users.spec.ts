import { UsersService } from './users.service';
import { VendixHttpException } from 'src/common/errors';
import { vendixUserWhere, withVendixUser } from '@common/utils/vendix-user.util';

/**
 * Regla de negocio: el Super Admin solo lista y cuenta usuarios de Vendix
 * (al menos un rol distinto de `customer`); nunca clientes finales.
 */
describe('Superadmin UsersService — only Vendix users', () => {
  const prisma = {
    users: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    user_roles: { groupBy: jest.fn() },
    roles: { findMany: jest.fn() },
  };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.users.findMany.mockResolvedValue([]);
    prisma.users.count.mockResolvedValue(0);
    prisma.user_roles.groupBy.mockResolvedValue([]);
    prisma.roles.findMany.mockResolvedValue([]);
    service = new UsersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      // UsernameService stub: username always free, P2002 rethrown untouched.
      {
        assertAvailable: jest.fn(),
        generateUnique: jest.fn().mockResolvedValue('generated_user'),
        rethrowAsConflict: jest.fn((error: unknown) => {
          throw error;
        }),
      } as never,
    );
  });

  describe('findAll', () => {
    it('lists and counts only Vendix users, keeping the caller filters', async () => {
      await service.findAll({ page: 1, limit: 10, search: 'ana', state: 'active' as never });

      const filters = {
        OR: [
          { first_name: { contains: 'ana', mode: 'insensitive' } },
          { last_name: { contains: 'ana', mode: 'insensitive' } },
          { email: { contains: 'ana', mode: 'insensitive' } },
        ],
        state: 'active',
        organizations: { mode: 'production' },
      };
      const expectedWhere = withVendixUser(filters as never);
      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.users.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('ignores a role=customer query param: the criterion still applies', async () => {
      await service.findAll({ page: 1, limit: 10, role: 'customer' });

      const where = prisma.users.findMany.mock.calls[0][0].where;
      expect(where).toEqual(
        withVendixUser({ organizations: { mode: 'production' } }),
      );
      expect(JSON.stringify(where)).not.toContain('"equals":"customer"');
    });
  });

  describe('findOne', () => {
    it('answers 404 for a user that is not a Vendix user (pure customer)', async () => {
      prisma.users.findFirst.mockResolvedValue(null);

      const error = await service.findOne(42).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VendixHttpException);
      expect((error as VendixHttpException).errorCode).toBe('SUP_ADMIN_USER_001');
      expect((error as VendixHttpException).getStatus()).toBe(404);
      expect(prisma.users.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: withVendixUser({ id: 42 }) }),
      );
    });

    it('returns a Vendix user without the password', async () => {
      prisma.users.findFirst.mockResolvedValue({
        id: 7,
        email: 'staff@example.com',
        password: 'hashed',
        user_roles: [{ roles: { name: 'employee' } }],
      });

      const result = await service.findOne(7);

      expect(result).toEqual({
        id: 7,
        email: 'staff@example.com',
        user_roles: [{ roles: { name: 'employee' } }],
      });
    });
  });

  describe('getDashboardStats', () => {
    it('counts every KPI over Vendix users only', async () => {
      await service.getDashboardStats();

      const countWheres = prisma.users.count.mock.calls.map(([args]) => args.where);
      expect(countWheres).toEqual([
        withVendixUser(),
        withVendixUser({ state: 'active' }),
        withVendixUser({ state: 'inactive' }),
        withVendixUser({ state: 'pending_verification' }),
        withVendixUser({ state: 'suspended' }),
        withVendixUser({ state: 'archived' }),
        withVendixUser({ two_factor_enabled: true }),
        withVendixUser({ email_verified: true }),
      ]);
      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: withVendixUser(), take: 5 }),
      );
    });

    it('segments by role without the customer bucket and only over Vendix users', async () => {
      prisma.user_roles.groupBy.mockResolvedValue([{ role_id: 2, _count: 3 }]);
      prisma.roles.findMany.mockResolvedValue([{ id: 2, name: 'employee' }]);
      prisma.users.count.mockResolvedValue(3);

      const result = await service.getDashboardStats();

      expect(prisma.user_roles.groupBy).toHaveBeenCalledWith({
        by: ['role_id'],
        where: {
          users: vendixUserWhere(),
          roles: { name: { not: 'customer' } },
        },
        _count: true,
      });
      expect(result.usersByRole).toEqual([{ roleName: 'employee', count: 3 }]);
      expect(result.total_usuarios).toBe(3);
    });
  });
});
