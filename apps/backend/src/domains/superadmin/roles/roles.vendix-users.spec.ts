import { RolesService } from './roles.service';
import { SuperadminRoleAssignmentService } from './superadmin-role-assignment.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

const VENDIX_ASSIGNMENTS = { where: { users: vendixUserWhere() } };

/**
 * Roles del Super Admin: la columna "Usuarios", la segmentación por tamaño y
 * la pestaña "Usuarios con este rol" cuentan/listan usuarios de Vendix. En el
 * rol `customer` eso evita exponer a los clientes finales de las tiendas.
 */
describe('Superadmin RolesService — role users are Vendix users only', () => {
  const prisma = createPrismaMock({
    roles: ['findMany', 'findUnique', 'count', 'delete'],
    permissions: ['count'],
  });
  let service: RolesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.roles.findMany.mockResolvedValue([]);
    prisma.roles.count.mockResolvedValue(0);
    prisma.permissions.count.mockResolvedValue(0);
    service = new RolesService(prisma as never, {} as never);
  });

  it('list: user count and embedded users only cover Vendix users', async () => {
    await service.findAll({} as never);

    const [args] = prisma.roles.findMany.mock.calls[0];
    expect(args.include._count.select).toEqual({
      role_permissions: true,
      user_roles: VENDIX_ASSIGNMENTS,
    });
    expect(args.include.user_roles.where).toEqual({ users: vendixUserWhere() });
  });

  it('stats: segments roles by their Vendix-user count', async () => {
    prisma.roles.findMany
      .mockResolvedValueOnce([
        { id: 1, _count: { user_roles: 0 } },
        { id: 2, _count: { user_roles: 3 } },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.getDashboardStats();

    for (const [args] of prisma.roles.findMany.mock.calls) {
      expect(args.include._count.select.user_roles).toEqual(VENDIX_ASSIGNMENTS);
    }
    expect(result.rolesByUserCountRanges).toEqual({
      empty: 1,
      small: 1,
      medium: 0,
      large: 0,
    });
  });

  it('delete guard still counts every assignment (customers included)', async () => {
    prisma.roles.findUnique.mockResolvedValue({
      id: 4,
      is_system_role: false,
      _count: { role_permissions: 0, user_roles: 1 },
    });

    await expect(service.remove(4)).rejects.toThrow(
      'Cannot delete role with existing permissions or users',
    );
    const [args] = prisma.roles.findUnique.mock.calls[0];
    expect(args.include._count.select).toEqual({
      role_permissions: true,
      user_roles: true,
    });
    expect(prisma.roles.delete).not.toHaveBeenCalled();
  });

  it('"Usuarios con este rol" asks the shared service for Vendix users only', async () => {
    const assignments = { listRoleUsers: jest.fn().mockResolvedValue([]) };
    const roleAssignments = new SuperadminRoleAssignmentService(
      prisma as never,
      assignments as never,
      {} as never,
    );

    await new RolesService(prisma as never, roleAssignments).listRoleUsers(9);

    expect(assignments.listRoleUsers).toHaveBeenCalledWith(
      9,
      { level: 'superadmin' },
      { userWhere: vendixUserWhere() },
    );
  });
});
