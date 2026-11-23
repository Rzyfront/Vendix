import { UserRoleAssignmentService } from './user-role-assignment.service';
import { createPrismaMock } from '../../testing/prisma-mock';
import { vendixUserWhere } from '@common/utils/vendix-user.util';

/**
 * `listRoleUsers` acepta un filtro opcional de usuarios (el Super Admin lo usa
 * para no listar clientes finales). Sin él, el `where` es el de siempre; con
 * él, NO pisa el acotamiento por tenant del actor de tienda/organización.
 */
describe('UserRoleAssignmentService.listRoleUsers', () => {
  const prisma = createPrismaMock({
    roles: ['findUnique'],
    user_roles: ['findMany'],
  });
  const storeActor = { level: 'store' as const, organization_id: 3, store_id: 12 };
  let service: UserRoleAssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.roles.findUnique.mockResolvedValue({
      id: 9,
      name: 'cashier',
      is_system_role: true,
      organization_id: null,
      store_id: null,
    });
    prisma.user_roles.findMany.mockResolvedValue([
      {
        id: 1,
        store_id: 12,
        stores: { id: 12, name: 'Tienda' },
        users: { id: 5, email: 'ana@example.com' },
      },
    ]);
    service = new UserRoleAssignmentService(prisma as never);
  });

  it('keeps the previous where for a store actor when no user filter is given', async () => {
    const result = await service.listRoleUsers(9, storeActor);

    expect(prisma.user_roles.findMany.mock.calls[0][0].where).toEqual({
      role_id: 9,
      users: { store_users: { some: { store_id: 12 } } },
      OR: [{ store_id: null }, { store_id: 12 }],
    });
    expect(result).toEqual([
      {
        assignment_id: 1,
        store_id: 12,
        store_name: 'Tienda',
        user: { id: 5, email: 'ana@example.com' },
      },
    ]);
  });

  it('ANDs the user filter with the actor tenant filter instead of overwriting it', async () => {
    await service.listRoleUsers(9, storeActor, { userWhere: vendixUserWhere() });

    expect(prisma.user_roles.findMany.mock.calls[0][0].where).toEqual({
      role_id: 9,
      AND: [
        {
          users: { store_users: { some: { store_id: 12 } } },
          OR: [{ store_id: null }, { store_id: 12 }],
        },
        { users: vendixUserWhere() },
      ],
    });
  });
});
