import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from '../organization/roles/roles.service';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import { RequestContextService } from '@common/context/request-context.service';
import { PLATFORM_CRM_LINK_PERMISSIONS } from '../../common/constants/platform-permissions.constant';

jest.mock('../../prisma/services/organization-prisma.service', () => ({
  OrganizationPrismaService: jest.fn(),
}));

/**
 * Candado 3 · test del §6 (odd/tasks/vendix-platform-crm-enlace.md).
 *
 * Como dueño de una organización cliente que edita sus roles en
 * Configuración → Roles, quiero que intentar darle a un rol mío el permiso
 * `platform:crm_link:manage` me responda con el error de "permiso de sistema"
 * para que la función de enlace del CRM de Vendix nunca se habilite en mi
 * organización.
 *
 * El doble de Prisma devuelve el permiso con el `is_system_permission` que
 * siembran la migración y el seed (true): si alguien lo vuelve false, el seed
 * spec falla; si alguien quita el chequeo, este falla.
 */
describe('RolesService.assignPermissions · platform:* no es asignable por organizaciones', () => {
  const ORGANIZATION_ID = 7;
  const ROLE = {
    id: 55,
    name: 'vendedor',
    description: null,
    is_system_role: false,
    organization_id: ORGANIZATION_ID,
    store_id: null,
    stores: null,
    role_permissions: [],
    user_roles: [],
    _count: { user_roles: 0 },
  };

  const prisma = {
    roles: { findFirst: jest.fn() },
    permissions: { findMany: jest.fn() },
    role_permissions: { createMany: jest.fn() },
  };
  const audit = { log: jest.fn() };
  let service: RolesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: OrganizationPrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: UserRoleAssignmentService, useValue: {} },
      ],
    }).compile();
    service = module.get(RolesService);

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: ORGANIZATION_ID,
      is_super_admin: false,
      is_owner: true,
    });
    prisma.roles.findFirst.mockResolvedValue(ROLE);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it.each(Object.values(PLATFORM_CRM_LINK_PERMISSIONS))(
    'rejects %s with ORG_PERM_001 and writes nothing',
    async (name) => {
      prisma.permissions.findMany.mockResolvedValue([
        { id: 901, name, is_system_permission: true },
      ]);

      await expect(
        service.assignPermissions(ROLE.id, { permission_ids: [901] }, 3),
      ).rejects.toMatchObject({ errorCode: 'ORG_PERM_001' });

      expect(prisma.role_permissions.createMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    },
  );
});
