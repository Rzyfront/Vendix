import { Test, TestingModule } from '@nestjs/testing';
import { AuditService, AuditAction, AuditResource } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    audit_logs: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create an audit log successfully', async () => {
      const auditData = {
        userId: 1,
        storeId: 1,
        organizationId: 1,
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
        resourceId: 123,
        oldValues: { name: 'Old Product' },
        newValues: { name: 'New Product' },
        metadata: { source: 'api' },
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      const expectedCreateData = {
        user_id: 1,
        store_id: 1,
        organization_id: 1,
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
        resource_id: 123,
        old_values: { name: 'Old Product' },
        new_values: { name: 'New Product' },
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0',
      };

      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });

      await service.log(auditData);

      expect(mockPrismaService.audit_logs.create).toHaveBeenCalledWith({
        data: expectedCreateData,
      });
    });

    it('should handle null values correctly', async () => {
      const auditData = {
        action: AuditAction.DELETE,
        resource: AuditResource.USERS,
        resourceId: 456,
      };

      const expectedCreateData = {
        user_id: undefined,
        store_id: undefined,
        organization_id: undefined,
        action: AuditAction.DELETE,
        resource: AuditResource.USERS,
        resource_id: 456,
        old_values: null,
        new_values: null,
        ip_address: undefined,
        user_agent: undefined,
      };

      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });

      await service.log(auditData);

      expect(mockPrismaService.audit_logs.create).toHaveBeenCalledWith({
        data: expectedCreateData,
      });
    });

    it('should not throw error when prisma fails', async () => {
      const auditData = {
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
      };

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockPrismaService.audit_logs.create.mockRejectedValue(
        new Error('Database error'),
      );

      await service.log(auditData);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Error registrando auditoría:',
        expect.any(Error),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('logCreate', () => {
    it('should call log with CREATE action', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const userId = 1;
      const resource = AuditResource.PRODUCTS;
      const resourceId = 123;
      const newValues = { name: 'New Product' };
      const metadata = { source: 'api' };

      await service.logCreate(
        userId,
        resource,
        resourceId,
        newValues,
        metadata,
      );

      expect(logSpy).toHaveBeenCalledWith({
        userId,
        action: AuditAction.CREATE,
        resource,
        resourceId,
        newValues,
        metadata,
      });
    });
  });

  describe('logUpdate', () => {
    it('should call log with UPDATE action', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const userId = 1;
      const resource = AuditResource.PRODUCTS;
      const resourceId = 123;
      const oldValues = { name: 'Old Product' };
      const newValues = { name: 'New Product' };
      const metadata = { updated_fields: ['name'] };

      await service.logUpdate(
        userId,
        resource,
        resourceId,
        oldValues,
        newValues,
        metadata,
      );

      expect(logSpy).toHaveBeenCalledWith({
        userId,
        action: AuditAction.UPDATE,
        resource,
        resourceId,
        oldValues,
        newValues,
        metadata,
      });
    });
  });

  describe('logDelete', () => {
    it('should call log with DELETE action', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const userId = 1;
      const resource = AuditResource.PRODUCTS;
      const resourceId = 123;
      const oldValues = { name: 'Deleted Product' };
      const metadata = { reason: 'obsolete' };

      await service.logDelete(
        userId,
        resource,
        resourceId,
        oldValues,
        metadata,
      );

      expect(logSpy).toHaveBeenCalledWith({
        userId,
        action: AuditAction.DELETE,
        resource,
        resourceId,
        oldValues,
        metadata,
      });
    });
  });

  describe('logAuth', () => {
    it('should call log with AUTH resource', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const userId = 1;
      const action = AuditAction.LOGIN;
      const metadata = { method: 'password' };
      const ipAddress = '192.168.1.1';
      const userAgent = 'Mozilla/5.0';

      await service.logAuth(userId, action, metadata, ipAddress, userAgent);

      expect(logSpy).toHaveBeenCalledWith({
        userId,
        action,
        resource: AuditResource.AUTH,
        metadata,
        ipAddress,
        userAgent,
      });
    });

    it('should work with undefined userId', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const action = AuditAction.LOGIN_FAILED;
      const metadata = { reason: 'invalid_credentials' };

      await service.logAuth(undefined, action, metadata);

      expect(logSpy).toHaveBeenCalledWith({
        userId: undefined,
        action,
        resource: AuditResource.AUTH,
        metadata,
        ipAddress: undefined,
        userAgent: undefined,
      });
    });
  });

  describe('logSystem', () => {
    it('should call log with system action', async () => {
      const logSpy = jest.spyOn(service, 'log');
      const action = AuditAction.PASSWORD_RESET;
      const resource = AuditResource.SYSTEM;
      const metadata = { affected_users: 10 };

      await service.logSystem(action, resource, metadata);

      expect(logSpy).toHaveBeenCalledWith({
        action,
        resource,
        metadata,
      });
    });
  });

  describe('getAuditLogs', () => {
    it('should return audit logs with filters', async () => {
      const filters = {
        user_id: 1,
        store_id: 1,
        organization_id: 1,
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
        resource_id: 123,
        from_date: new Date('2025-01-01'),
        to_date: new Date('2025-12-31'),
        limit: 10,
        offset: 0,
      };

      const expectedLogs = [
        {
          id: 1,
          action: AuditAction.CREATE,
          resource: AuditResource.PRODUCTS,
          users: { id: 1, email: 'test@example.com' },
          stores: { id: 1, name: 'Test Store' },
          organizations: { id: 1, name: 'Test Org' },
        },
      ];

      mockPrismaService.audit_logs.findMany.mockResolvedValue(expectedLogs);

      const result = await service.getAuditLogs(filters);

      expect(mockPrismaService.audit_logs.findMany).toHaveBeenCalledWith({
        where: {
          user_id: 1,
          store_id: 1,
          organization_id: 1,
          action: AuditAction.CREATE,
          resource: AuditResource.PRODUCTS,
          resource_id: 123,
          created_at: {
            gte: new Date('2025-01-01'),
            lte: new Date('2025-12-31'),
          },
        },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              organization_id: true,
            },
          },
          stores: {
            select: {
              id: true,
              name: true,
              slug: true,
              organization_id: true,
            },
          },
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 10,
        skip: 0,
      });

      expect(result).toEqual(expectedLogs);
    });

    it('should use default values when no filters provided', async () => {
      const expectedLogs = [{ id: 1 }];
      mockPrismaService.audit_logs.findMany.mockResolvedValue(expectedLogs);

      const result = await service.getAuditLogs();

      expect(mockPrismaService.audit_logs.findMany).toHaveBeenCalledWith({
        where: {},
        include: {
          users: {
            select: {
              id: true,
              email: true,
              first_name: true,
              last_name: true,
              organization_id: true,
            },
          },
          stores: {
            select: {
              id: true,
              name: true,
              slug: true,
              organization_id: true,
            },
          },
          organizations: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
        skip: 0,
      });

      expect(result).toEqual(expectedLogs);
    });
  });

  describe('getAuditStats', () => {
    it('should return audit statistics', async () => {
      const fromDate = new Date('2025-01-01');
      const toDate = new Date('2025-12-31');

      const mockTotalLogs = 100;
      const mockLogsByAction = [
        { action: AuditAction.CREATE, _count: { id: 40 } },
        { action: AuditAction.UPDATE, _count: { id: 35 } },
        { action: AuditAction.DELETE, _count: { id: 25 } },
      ];
      const mockLogsByResource = [
        { resource: AuditResource.PRODUCTS, _count: { id: 50 } },
        { resource: AuditResource.USERS, _count: { id: 30 } },
        { resource: AuditResource.ORDERS, _count: { id: 20 } },
      ];

      mockPrismaService.audit_logs.count.mockResolvedValue(mockTotalLogs);
      mockPrismaService.audit_logs.groupBy
        .mockResolvedValueOnce(mockLogsByAction)
        .mockResolvedValueOnce(mockLogsByResource);

      const result = await service.getAuditStats(fromDate, toDate);

      expect(mockPrismaService.audit_logs.count).toHaveBeenCalledWith({
        where: {
          created_at: {
            gte: fromDate,
            lte: toDate,
          },
        },
      });

      expect(mockPrismaService.audit_logs.groupBy).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        total_logs: mockTotalLogs,
        logs_by_action: {
          CREATE: 40,
          UPDATE: 35,
          DELETE: 25,
        },
        logs_by_resource: {
          products: 50,
          users: 30,
          orders: 20,
        },
      });
    });

    it('should work without date filters', async () => {
      mockPrismaService.audit_logs.count.mockResolvedValue(50);
      mockPrismaService.audit_logs.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getAuditStats();

      expect(mockPrismaService.audit_logs.count).toHaveBeenCalledWith({
        where: {},
      });

      expect(result).toEqual({
        total_logs: 50,
        logs_by_action: {},
        logs_by_resource: {},
      });
    });
  });

  describe('Enums', () => {
    it('should have correct AuditAction values', () => {
      expect(AuditAction.CREATE).toBe('CREATE');
      expect(AuditAction.UPDATE).toBe('UPDATE');
      expect(AuditAction.DELETE).toBe('DELETE');
      expect(AuditAction.LOGIN).toBe('LOGIN');
      expect(AuditAction.LOGOUT).toBe('LOGOUT');
      expect(AuditAction.PASSWORD_CHANGE).toBe('PASSWORD_CHANGE');
      expect(AuditAction.EMAIL_VERIFY).toBe('EMAIL_VERIFY');
      expect(AuditAction.ONBOARDING_COMPLETE).toBe('ONBOARDING_COMPLETE');
      expect(AuditAction.PERMISSION_CHANGE).toBe('PERMISSION_CHANGE');
      expect(AuditAction.LOGIN_FAILED).toBe('LOGIN_FAILED');
      expect(AuditAction.ACCOUNT_LOCKED).toBe('ACCOUNT_LOCKED');
      expect(AuditAction.ACCOUNT_UNLOCKED).toBe('ACCOUNT_UNLOCKED');
      expect(AuditAction.SUSPICIOUS_ACTIVITY).toBe('SUSPICIOUS_ACTIVITY');
      expect(AuditAction.PASSWORD_RESET).toBe('PASSWORD_RESET');
    });

    it('should have correct AuditResource values', () => {
      expect(AuditResource.USERS).toBe('users');
      expect(AuditResource.ORGANIZATIONS).toBe('organizations');
      expect(AuditResource.STORES).toBe('stores');
      expect(AuditResource.DOMAIN_SETTINGS).toBe('domain_settings');
      expect(AuditResource.PRODUCTS).toBe('products');
      expect(AuditResource.ORDERS).toBe('orders');
      expect(AuditResource.AUTH).toBe('auth');
      expect(AuditResource.ROLES).toBe('roles');
      expect(AuditResource.PERMISSIONS).toBe('permissions');
      expect(AuditResource.SYSTEM).toBe('system');
    });
  });
});
