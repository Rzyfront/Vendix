import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { canAssignRole } from '@common/utils/role-scope.util';

// Mock the problematic import
jest.mock('../../../prisma/services/organization-prisma.service', () => ({
  OrganizationPrismaService: jest.fn(),
}));

const ORGANIZATION_ID = 7;

/**
 * QUI-72: el filtro de visibilidad del nivel organización, tal cual lo produce
 * `buildRoleVisibilityWhere({ level: 'organization', organization_id })`.
 * Se declara aquí a propósito: si el contrato compartido cambia, este test debe
 * fallar y obligar a revisar las tres pantallas, no adaptarse en silencio.
 */
const ORG_VISIBILITY_WHERE = {
  OR: [
    { is_system_role: true, organization_id: null },
    { organization_id: ORGANIZATION_ID },
  ],
};

describe('RolesService', () => {
  let service: RolesService;

  const mockPrismaService = {
    user_roles: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    roles: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    stores: {
      findFirst: jest.fn(),
    },
    users: {
      findFirst: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  const mockUserRoleAssignment = {
    assign: jest.fn(),
    remove: jest.fn(),
    listUserRoles: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: OrganizationPrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: UserRoleAssignmentService,
          useValue: mockUserRoleAssignment,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);

    // Contexto de organización: sin él todo el dominio falla cerrado.
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: ORGANIZATION_ID,
      is_super_admin: false,
      is_owner: false,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    const mockUserRoles = [
      {
        id: 1,
        user_id: 1,
        role_id: 1,
        store_id: null,
        roles: {
          id: 1,
          name: 'user',
          description: 'User role',
          is_system_role: false,
          organization_id: ORGANIZATION_ID,
          store_id: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      },
    ];

    const mockRoles = [
      {
        id: 1,
        name: 'admin',
        description: 'Administrator role',
        is_system_role: false,
        organization_id: ORGANIZATION_ID,
        store_id: null,
        stores: null,
        created_at: new Date(),
        updated_at: new Date(),
        role_permissions: [],
        _count: { user_roles: 1 },
      },
      {
        id: 2,
        name: 'super_admin',
        description: 'Super Administrator role',
        is_system_role: true,
        organization_id: null,
        store_id: null,
        stores: null,
        created_at: new Date(),
        updated_at: new Date(),
        role_permissions: [],
        _count: { user_roles: 0 },
      },
    ];

    it('should return all roles including owner/admin for owner user', async () => {
      const ownerUserRoles = [
        {
          ...mockUserRoles[0],
          roles: { ...mockUserRoles[0].roles, name: 'owner' },
        },
      ];

      mockPrismaService.user_roles.findMany.mockResolvedValue(ownerUserRoles);
      mockPrismaService.roles.findMany.mockResolvedValue(mockRoles);

      const result = await service.findAll(1);

      expect(mockPrismaService.user_roles.findMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        include: { roles: true },
      });
      // El owner ve todo lo visible, sin el filtro extra de owner/admin.
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ORG_VISIBILITY_WHERE] },
          orderBy: { name: 'asc' },
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('admin');
      expect(result[1].name).toBe('super_admin');
    });

    it('should return roles excluding owner/admin for non-owner user', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue(mockUserRoles);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              ORG_VISIBILITY_WHERE,
              { name: { notIn: ['owner', 'admin'] } },
            ],
          },
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('admin');
    });

    it('should return roles excluding owner/admin for user with no roles', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue([]);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              ORG_VISIBILITY_WHERE,
              { name: { notIn: ['owner', 'admin'] } },
            ],
          },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should transform roles correctly', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue(mockUserRoles);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(result[0]).toEqual({
        id: 1,
        name: 'admin',
        organization_id: ORGANIZATION_ID,
        description: 'Administrator role',
        system_role: false,
        scope: 'organization',
        store_id: null,
        store_name: null,
        created_at: mockRoles[0].created_at,
        updated_at: mockRoles[0].updated_at,
        permissions: [],
        user_roles: undefined,
        _count: { user_roles: 1 },
      });
    });

    it('should derive scope=system for system roles and scope=store for store roles', async () => {
      const storeRole = {
        ...mockRoles[0],
        id: 9,
        name: 'cajero',
        store_id: 3,
        stores: { id: 3, name: 'Sucursal Centro' },
      };

      mockPrismaService.user_roles.findMany.mockResolvedValue([]);
      mockPrismaService.roles.findMany.mockResolvedValue([
        mockRoles[1],
        storeRole,
      ]);

      const result = await service.findAll(1);

      expect(result[0].scope).toBe('system');
      expect(result[0].store_id).toBeNull();
      expect(result[1].scope).toBe('store');
      expect(result[1].store_id).toBe(3);
      expect(result[1].store_name).toBe('Sucursal Centro');
    });

    it('should fail closed when there is no organization in context', async () => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue(undefined);

      // Sin organización el filtro colapsaría a "todas las organizaciones":
      // debe cortar ANTES de tocar la base.
      await expect(service.findAll(1)).rejects.toThrow(VendixHttpException);
      expect(mockPrismaService.roles.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should reject editing a system role with a typed 403 instead of a silent 200', async () => {
      mockPrismaService.roles.findFirst.mockResolvedValue({
        id: 2,
        name: 'super_admin',
        description: 'System role',
        is_system_role: true,
        organization_id: null,
        store_id: null,
        stores: null,
        role_permissions: [],
        user_roles: [],
        _count: { user_roles: 0 },
      });

      await expect(
        service.update(2, { name: 'hacked' }, 1),
      ).rejects.toMatchObject({ errorCode: 'ROLE_SCOPE_001' });

      expect(mockPrismaService.roles.update).not.toHaveBeenCalled();
    });

    it('should allow editing a role owned by the actor organization', async () => {
      const existing = {
        id: 5,
        name: 'preventista',
        description: 'Vendedor',
        is_system_role: false,
        organization_id: ORGANIZATION_ID,
        store_id: null,
        stores: null,
        role_permissions: [],
        user_roles: [],
        _count: { user_roles: 0 },
      };

      mockPrismaService.roles.findFirst
        .mockResolvedValueOnce(existing) // loadVisibleRoleRow
        .mockResolvedValueOnce(null); // pre-check de colisión de nombre
      mockPrismaService.roles.update.mockResolvedValue({
        ...existing,
        name: 'preventista_senior',
      });

      const result = await service.update(5, { name: 'preventista_senior' }, 1);

      expect(mockPrismaService.roles.update).toHaveBeenCalled();
      expect(result.name).toBe('preventista_senior');
      expect(result.scope).toBe('organization');
      // La auditoría estaba tras un `return` y nunca corría.
      expect(mockAuditService.log).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should reject a store_id that does not belong to the actor organization', async () => {
      // `stores` ya está org-scoped: una tienda ajena devuelve null.
      mockPrismaService.stores.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'cajero', store_id: 999 }, 1),
      ).rejects.toMatchObject({ errorCode: 'ROLE_ASSIGN_007' });

      expect(mockPrismaService.roles.create).not.toHaveBeenCalled();
    });

    it('should ignore system_role coming from the body (mass-assignment)', async () => {
      mockPrismaService.roles.findFirst.mockResolvedValue(null);
      mockPrismaService.roles.create.mockImplementation(({ data }: any) => ({
        id: 11,
        ...data,
        stores: null,
        role_permissions: [],
        _count: { user_roles: 0 },
      }));

      const result = await service.create(
        { name: 'auditor', system_role: true } as any,
        1,
      );

      expect(mockPrismaService.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            is_system_role: false,
            organization_id: ORGANIZATION_ID,
            store_id: null,
          }),
        }),
      );
      expect(result.scope).toBe('organization');
    });
  });

  describe('user role assignment', () => {
    it('should delegate assignment to the shared UserRoleAssignmentService', async () => {
      mockPrismaService.roles.findFirst
        .mockResolvedValueOnce({ id: 5, name: 'cajero' }) // assertSuperAdminGrantAllowed
        .mockResolvedValueOnce({ id: 5, name: 'cajero', stores: null }); // enriquecimiento
      mockPrismaService.users.findFirst.mockResolvedValue({
        id: 20,
        email: 'a@b.c',
      });
      mockUserRoleAssignment.assign.mockResolvedValue({
        assignment_id: 77,
        user_id: 20,
        role_id: 5,
        store_id: 3,
        scope: 'store',
      });

      const result = await service.assignRoleToUser(
        { user_id: 20, role_id: 5, store_id: 3 },
        1,
      );

      expect(mockUserRoleAssignment.assign).toHaveBeenCalledWith({
        user_id: 20,
        role_id: 5,
        // QUI-581 — el actor viaja con `actor_roles` (vacío aquí porque el mock de
        // RequestContextService no publica roles). Es lo que permite a
        // `canAssignRole` elevar a un `owner`; sin este campo el nivel tienda
        // quedaría restringido y los tenants de tienda única, bloqueados.
        actor: {
          level: 'organization',
          organization_id: ORGANIZATION_ID,
          actor_roles: [],
        },
        store_id: 3,
      });
      // Claves heredadas que el frontend actual ya consume.
      expect(result.id).toBe(77);
      expect(result.user_id).toBe(20);
      expect(result.role_id).toBe(5);
      // Aditivas de QUI-72.
      expect(result.store_id).toBe(3);
      expect(result.scope).toBe('store');
    });

    it('should delegate the user role listing so store_id travels to the UI', async () => {
      mockUserRoleAssignment.listUserRoles.mockResolvedValue([
        { assignment_id: 1, store_id: null, store_name: null, role: {} },
      ]);

      const result = await service.getUserRoles(20);

      expect(mockUserRoleAssignment.listUserRoles).toHaveBeenCalledWith(20, {
        level: 'organization',
        organization_id: ORGANIZATION_ID,
        actor_roles: [],
      });
      expect(result[0].store_id).toBeNull();
    });
  });

  describe('canAssignRole allowlist (QUI-727 A.1)', () => {
    // Actor STORE_ADMIN a nivel tienda. `mesero` y `cocina` son roles de
    // sistema (organization_id null, is_system_role true) que crea el seed;
    // la allowlist por INCLUSIÓN de `ASSIGNABLE_SYSTEM_ROLES.store` (que A.1
    // extiende) es lo que les permite nacer asignables. Si no estuvieran en la
    // lista, `canAssignRole` devolvería false y cualquier asignación daría 403
    // (UserRoleAssignmentService.validateAssignment paso 1).
    const storeActor = {
      level: 'store' as const,
      organization_id: ORGANIZATION_ID,
      store_id: 3,
      actor_roles: [],
    };

    it('should allow assigning the mesero system role to a store user', () => {
      expect(
        canAssignRole(
          {
            name: 'mesero',
            is_system_role: true,
            organization_id: null,
            store_id: null,
          },
          storeActor,
        ),
      ).toBe(true);
    });

    it('should allow assigning the cocina system role to a store user', () => {
      expect(
        canAssignRole(
          {
            name: 'cocina',
            is_system_role: true,
            organization_id: null,
            store_id: null,
          },
          storeActor,
        ),
      ).toBe(true);
    });
  });
});
