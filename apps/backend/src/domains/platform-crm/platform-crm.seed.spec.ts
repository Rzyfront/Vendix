import {
  isPlatformPermission,
  seedPermissionsAndRoles,
} from '../../../prisma/seeds/permissions-roles.seed';
import {
  PLATFORM_CRM_ROLE_NAME,
  seedPlatformCrmRole,
} from '../../../prisma/seeds/platform-crm-role.seed';
import {
  PLATFORM_CRM_LINK_PERMISSIONS,
  PLATFORM_PERMISSION_PREFIX,
  isPlatformPermissionName,
} from '../../common/constants/platform-permissions.constant';

/**
 * Candado 3 (odd/tasks/vendix-platform-crm-enlace.md): `platform:crm_link:*`
 * es permiso de sistema y ningún rol compartido por los tenants lo hereda.
 *
 * Como dueño de una organización cliente, cuando Vendix siembra permisos en un
 * deploy, no quiero recibir permisos internos de Vendix en mis roles owner,
 * admin o gerente, para que la función de enlace nunca se habilite en mi
 * tienda ni por un error de asignación.
 *
 * Corre el seed REAL contra un cliente en memoria que registra qué permisos
 * recibe cada rol.
 */

type Row = Record<string, any>;

function fakeSeedClient(initial: { organizations?: Row[] } = {}) {
  const permissions: Row[] = [];
  const roles: Row[] = [];
  const organizations: Row[] = [...(initial.organizations ?? [])];
  const grants = new Map<number, Set<number>>();
  let nextPermissionId = 1;
  let nextRoleId = 1;

  const client = {
    organizations: {
      findFirst: jest.fn(async ({ where }: Row) =>
        organizations.find((o) => o.is_platform === where.is_platform) ?? null,
      ),
    },
    permissions: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const row = permissions.find((p) => p.name === where.name);
        return row ? { id: row.id } : null;
      }),
      create: jest.fn(async ({ data }: Row) => {
        const row = { ...data, id: nextPermissionId++, status: 'active' };
        permissions.push(row);
        return row;
      }),
      findMany: jest.fn(async (args: Row = {}) => {
        const names: string[] | undefined = args.where?.name?.in;
        return permissions
          .filter((p) => !names || names.includes(p.name))
          .map((p) => ({ ...p }));
      }),
    },
    roles: {
      findFirst: jest.fn(async ({ where }: Row) =>
        roles.find(
          (r) =>
            r.name === where.name &&
            (r.organization_id ?? null) === (where.organization_id ?? null) &&
            (where.store_id === undefined ||
              (r.store_id ?? null) === where.store_id),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: Row) => {
        const row = { ...data, id: nextRoleId++ };
        roles.push(row);
        return row;
      }),
    },
    role_permissions: {
      createMany: jest.fn(async ({ data }: Row) => {
        let count = 0;
        for (const { role_id, permission_id } of data as Row[]) {
          const set = grants.get(role_id) ?? new Set<number>();
          if (!set.has(permission_id)) count++;
          set.add(permission_id);
          grants.set(role_id, set);
        }
        return { count };
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };

  const permissionNamesOf = (roleName: string, organization_id: number | null = null) => {
    const role = roles.find(
      (r) => r.name === roleName && (r.organization_id ?? null) === organization_id,
    );
    if (!role) throw new Error(`role ${roleName} not seeded`);
    const ids = grants.get(role.id) ?? new Set<number>();
    return permissions.filter((p) => ids.has(p.id)).map((p) => p.name as string);
  };

  return { client, permissions, roles, organizations, grants, permissionNamesOf };
}

describe('Vendix Platform · seed de permisos platform:*', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('creates both platform:crm_link permissions as system permissions', async () => {
    const fake = fakeSeedClient();
    await seedPermissionsAndRoles(fake.client as any);

    const platform = fake.permissions.filter((p) => isPlatformPermission(p.name));
    expect(platform.map((p) => [p.name, p.is_system_permission, p.method, p.path]))
      .toEqual([
        [
          'platform:crm_link:manage',
          true,
          'POST',
          '/api/store/platform-crm/customers/:customerId/link',
        ],
        [
          'platform:crm_link:read',
          true,
          'GET',
          '/api/store/platform-crm/customers/:customerId/link',
        ],
      ]);
  });

  it('grants platform:* to super_admin only among the shared system roles', async () => {
    const fake = fakeSeedClient();
    await seedPermissionsAndRoles(fake.client as any);

    const holders = fake.roles
      .filter((r) => r.organization_id == null)
      .filter((r) =>
        fake.permissionNamesOf(r.name).some((name) => isPlatformPermission(name)),
      )
      .map((r) => r.name);
    expect(holders).toEqual(['super_admin']);

    // owner/admin/manager keep their broad catch-all (still get store:* etc.)
    expect(fake.permissionNamesOf('owner').length).toBeGreaterThan(100);
    expect(fake.permissionNamesOf('admin').length).toBeGreaterThan(100);
    expect(fake.permissionNamesOf('manager').length).toBeGreaterThan(100);
  });

  it('keeps the seed prefix and the backend constant in agreement', () => {
    expect(PLATFORM_PERMISSION_PREFIX).toBe('platform:');
    for (const name of Object.values(PLATFORM_CRM_LINK_PERMISSIONS)) {
      expect(isPlatformPermission(name)).toBe(true);
      expect(isPlatformPermissionName(name)).toBe(true);
    }
    expect(isPlatformPermission('store:customers:read')).toBe(false);
    expect(isPlatformPermission('superadmin:stores:read')).toBe(false);
  });
});

describe('Vendix Platform · seed del rol "Comercial Vendix"', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('creates an org-wide role of the platform org carrying only platform:crm_link:*', async () => {
    const fake = fakeSeedClient({
      organizations: [
        { id: 7, is_platform: false },
        { id: 1, is_platform: true },
      ],
    });
    await seedPermissionsAndRoles(fake.client as any);

    const result = await seedPlatformCrmRole(fake.client as any);

    const role = fake.roles.find((r) => r.name === PLATFORM_CRM_ROLE_NAME);
    expect(role).toMatchObject({
      organization_id: 1,
      store_id: null,
      is_system_role: false,
    });
    expect(result).toMatchObject({ role_id: role!.id, role_created: true, permissions_added: 2 });
    expect(fake.permissionNamesOf(PLATFORM_CRM_ROLE_NAME, 1).sort()).toEqual([
      'platform:crm_link:manage',
      'platform:crm_link:read',
    ]);
  });

  it('is idempotent: a second run creates nothing', async () => {
    const fake = fakeSeedClient({ organizations: [{ id: 1, is_platform: true }] });
    await seedPermissionsAndRoles(fake.client as any);
    await seedPlatformCrmRole(fake.client as any);

    const again = await seedPlatformCrmRole(fake.client as any);

    expect(again).toMatchObject({ role_created: false, permissions_added: 0 });
    expect(fake.roles.filter((r) => r.name === PLATFORM_CRM_ROLE_NAME)).toHaveLength(1);
  });

  it('does nothing when there is no platform organization', async () => {
    const fake = fakeSeedClient({ organizations: [{ id: 7, is_platform: false }] });

    const result = await seedPlatformCrmRole(fake.client as any);

    expect(result).toEqual({ role_id: null, role_created: false, permissions_added: 0 });
    expect(fake.client.roles.create).not.toHaveBeenCalled();
  });
});
