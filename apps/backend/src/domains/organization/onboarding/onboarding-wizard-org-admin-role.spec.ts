import { OnboardingWizardService } from './onboarding-wizard.service';

/**
 * Candado 3 (odd/tasks/vendix-platform-crm-enlace.md).
 *
 * Como dueño de una organización nueva que termina el onboarding, quiero que
 * mi rol ORG_ADMIN reciba los permisos de organización de siempre pero ningún
 * permiso interno de Vendix (`platform:*`), para que la función de enlace del
 * CRM de Vendix nunca exista en mi cuenta.
 *
 * `createDefaultOrgAdminRole` copia TODOS los permisos de sistema al ORG_ADMIN;
 * `platform:*` también es de sistema, así que el filtro debe excluirlo. El doble
 * de Prisma interpreta el `where` real (y rechaza operadores que no conoce) en
 * vez de devolver una lista fija: así el test falla si el filtro desaparece.
 */
type Row = Record<string, any>;

function matchesWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'NOT') return !matchesWhere(row, expected as Row);
    if (expected !== null && typeof expected === 'object') {
      return Object.entries(expected as Row).every(([op, value]) => {
        if (op === 'startsWith') return String(row[key]).startsWith(value);
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return row[key] === expected;
  });
}

describe('OnboardingWizardService.createDefaultOrgAdminRole · sin platform:*', () => {
  const PERMISSIONS: Row[] = [
    { id: 1, name: 'system.config', is_system_permission: true },
    { id: 2, name: 'security.audit', is_system_permission: true },
    { id: 3, name: 'platform:crm_link:manage', is_system_permission: true },
    { id: 4, name: 'platform:crm_link:read', is_system_permission: true },
    { id: 5, name: 'store:customers:read', is_system_permission: false },
  ];

  function build() {
    const granted: Row[] = [];
    const prisma = {
      roles: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 900 }),
      },
      permissions: {
        findMany: jest.fn(async ({ where }: Row) =>
          PERMISSIONS.filter((p) => matchesWhere(p, where)),
        ),
      },
      role_permissions: {
        createMany: jest.fn(async ({ data }: Row) => {
          granted.push(...data);
          return { count: data.length };
        }),
      },
    };
    const userRoleAssignment = {
      ensureAssignmentUnchecked: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OnboardingWizardService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      userRoleAssignment as any,
    );
    return { service, granted, userRoleAssignment };
  }

  it('grants every other system permission and never a platform:* one', async () => {
    const { service, granted, userRoleAssignment } = build();

    await service.createDefaultOrgAdminRole(42, 7);

    expect(granted.map((g) => g.permission_id).sort()).toEqual([1, 2]);
    expect(granted.every((g) => g.role_id === 900)).toBe(true);
    expect(userRoleAssignment.ensureAssignmentUnchecked).toHaveBeenCalledWith({
      user_id: 7,
      role_id: 900,
      store_id: null,
    });
  });
});
