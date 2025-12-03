import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { AuditService } from '../audit/audit.service';

// Mock the problematic import
jest.mock('../../../prisma/services/organization-prisma.service', () => ({
  OrganizationPrismaService: jest.fn(),
}));

describe('RolesService', () => {
  let service: RolesService;

  const mockPrismaService = {
    user_roles: {
      findMany: jest.fn(),
    },
    roles: {
      findMany: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn(),
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
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    const mockUserRoles = [
      {
        id: 1,
        user_id: 1,
        role_id: 1,
        roles: {
          id: 1,
          name: 'user',
          description: 'User role',
          is_system_role: false,
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
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          role_permissions: { include: { permissions: true } },
          _count: { select: { user_roles: true } },
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('admin');
      expect(result[1].name).toBe('super_admin');
    });

    it('should return roles excluding owner/admin for non-owner user', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue(mockUserRoles);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(mockPrismaService.user_roles.findMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        include: { roles: true },
      });
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith({
        where: { name: { notIn: ['owner', 'admin'] } },
        include: {
          role_permissions: { include: { permissions: true } },
          _count: { select: { user_roles: true } },
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('admin');
    });

    it('should return roles excluding owner/admin for user with no roles', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue([]);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(mockPrismaService.user_roles.findMany).toHaveBeenCalledWith({
        where: { user_id: 1 },
        include: { roles: true },
      });
      expect(mockPrismaService.roles.findMany).toHaveBeenCalledWith({
        where: { name: { notIn: ['owner', 'admin'] } },
        include: {
          role_permissions: { include: { permissions: true } },
          _count: { select: { user_roles: true } },
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should transform roles correctly', async () => {
      mockPrismaService.user_roles.findMany.mockResolvedValue(mockUserRoles);
      mockPrismaService.roles.findMany.mockResolvedValue([mockRoles[0]]);

      const result = await service.findAll(1);

      expect(result[0]).toEqual({
        id: 1,
        name: 'admin',
        description: 'Administrator role',
        system_role: false,
        created_at: mockRoles[0].created_at,
        updated_at: mockRoles[0].updated_at,
        permissions: [],
        user_roles: undefined,
        _count: { user_roles: 1 },
      });
    });
  });
});
