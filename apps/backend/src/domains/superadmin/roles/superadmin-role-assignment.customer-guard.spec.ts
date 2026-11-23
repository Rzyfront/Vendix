import { SuperadminRoleAssignmentService } from './superadmin-role-assignment.service';
import { createPrismaMock } from '../../../testing/prisma-mock';
import { VendixHttpException } from '@common/errors';

/**
 * El Super Admin administra usuarios de Vendix: el rol `customer` no se
 * ofrece ni se acepta al asignar, por ninguna de las dos direcciones
 * (`users/:id/roles/:roleId` y `roles/:id/users/:userId`), que convergen en
 * esta fachada. Quitar un `customer` que ya existe sigue permitido.
 */
describe('SuperadminRoleAssignmentService — customer role is not assignable', () => {
  const prisma = createPrismaMock({
    roles: ['findUnique'],
    users: ['findUnique'],
    user_roles: ['delete'],
  });
  const assignments = {
    assign: jest.fn(),
    remove: jest.fn(),
  };
  const staffProvisioning = {
    resolveStoreForStoreAdmin: jest.fn(),
    provisionStaffMembership: jest.fn(),
  };
  let service: SuperadminRoleAssignmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    assignments.assign.mockResolvedValue({ assignment_id: 90, store_id: 4 });
    assignments.remove.mockResolvedValue({ removed: true });
    prisma.users.findUnique.mockResolvedValue({
      id: 5,
      organization_id: 3,
      main_store_id: 4,
    });
    service = new SuperadminRoleAssignmentService(
      prisma as never,
      assignments as never,
      staffProvisioning as never,
    );
  });

  it('rejects assigning the customer role with SUP_ADMIN_ROLE_002 and writes nothing', async () => {
    prisma.roles.findUnique.mockResolvedValue({ id: 8, name: 'customer' });

    const attempt = service.assign({ user_id: 5, role_id: 8, store_id: 4 });

    await expect(attempt).rejects.toBeInstanceOf(VendixHttpException);
    await expect(attempt).rejects.toMatchObject({
      errorCode: 'SUP_ADMIN_ROLE_002',
    });
    await expect(attempt).rejects.toMatchObject({
      status: 403,
    });
    expect(assignments.assign).not.toHaveBeenCalled();
    expect(staffProvisioning.provisionStaffMembership).not.toHaveBeenCalled();
  });

  it('keeps assigning staff roles as before', async () => {
    prisma.roles.findUnique.mockResolvedValue({ id: 2, name: 'manager' });

    const result = await service.assign({ user_id: 5, role_id: 2, store_id: 4 });

    expect(assignments.assign).toHaveBeenCalledWith({
      user_id: 5,
      role_id: 2,
      actor: { level: 'superadmin' },
      store_id: 4,
    });
    expect(staffProvisioning.provisionStaffMembership).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ assignment_id: 90, store_id: 4 });
  });

  it('only blocks the exact customer role name, the same one that makes an end customer', async () => {
    prisma.roles.findUnique.mockResolvedValue({ id: 30, name: 'Customer Care' });

    await service.assign({ user_id: 5, role_id: 30, store_id: 4 });

    expect(assignments.assign).toHaveBeenCalledTimes(1);
  });

  it('still lets the Super Admin remove an existing customer role', async () => {
    prisma.roles.findUnique.mockResolvedValue({ id: 8, name: 'customer' });

    await service.remove({ user_id: 5, role_id: 8, store_id: null });

    expect(assignments.remove).toHaveBeenCalledWith({
      user_id: 5,
      role_id: 8,
      actor: { level: 'superadmin' },
      store_id: null,
    });
  });
});
