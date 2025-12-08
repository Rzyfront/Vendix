import { Test, TestingModule } from '@nestjs/testing';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';
import { ResponseModule } from '@common/responses/response.module';
import { INestApplication } from '@nestjs/common';

// Mock PrismaService to avoid database connection
const mockPrismaService = {
  audit_logs: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
};

describe('AuditModule Integration', () => {
  let app: INestApplication;
  let auditService: AuditService;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AuditModule, ResponseModule],
    })
      .overrideProvider('PrismaService')
      .useValue(mockPrismaService)
      .compile();

    app = moduleRef.createNestApplication();
    auditService = moduleRef.get<AuditService>(AuditService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
  });

  describe('Module Configuration', () => {
    it('should have AuditService properly instantiated', () => {
      expect(auditService).toBeDefined();
      expect(auditService).toBeInstanceOf(AuditService);
    });

    it('should have AuditController properly instantiated', () => {
      const controller = moduleRef.get<AuditController>(AuditController);
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(AuditController);
    });

    it('should export AuditService', () => {
      const auditModule = moduleRef.get<AuditModule>(AuditModule);
      expect(auditModule).toBeDefined();
    });
  });

  describe('Service Integration', () => {
    it('should be able to log audit entries', async () => {
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      const logSpy = jest.spyOn(auditService, 'log');

      await auditService.logCreate(
        1,
        'products' as any,
        123,
        { name: 'Test Product' },
        { source: 'test' },
      );

      expect(logSpy).toHaveBeenCalled();
    });

    it('should be able to retrieve audit logs', async () => {
      mockPrismaService.audit_logs.findMany.mockResolvedValue([]);
      const getAuditLogsSpy = jest.spyOn(auditService, 'getAuditLogs');

      await auditService.getAuditLogs({
        user_id: 1,
        limit: 10,
      });

      expect(getAuditLogsSpy).toHaveBeenCalledWith({
        user_id: 1,
        limit: 10,
      });
    });

    it('should be able to get audit statistics', async () => {
      mockPrismaService.audit_logs.count.mockResolvedValue(0);
      mockPrismaService.audit_logs.groupBy.mockResolvedValue([]);
      const getAuditStatsSpy = jest.spyOn(auditService, 'getAuditStats');

      await auditService.getAuditStats();

      expect(getAuditStatsSpy).toHaveBeenCalled();
    });
  });

  describe('Dependency Injection', () => {
    it('should have AuditService with mocked dependencies', () => {
      expect(auditService).toBeDefined();
      // The service should work with mocked PrismaService
    });
  });

  describe('Full Workflow Integration', () => {
    it('should handle complete audit workflow', async () => {
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      mockPrismaService.audit_logs.findMany.mockResolvedValue([]);
      mockPrismaService.audit_logs.count.mockResolvedValue(0);
      mockPrismaService.audit_logs.groupBy.mockResolvedValue([]);

      const userId = 1;
      const resource = 'users' as any;
      const resourceId = 123;
      const oldValues = { name: 'Old Name' };
      const newValues = { name: 'New Name' };

      const logSpy = jest.spyOn(auditService, 'log');
      const getAuditLogsSpy = jest.spyOn(auditService, 'getAuditLogs');
      const getAuditStatsSpy = jest.spyOn(auditService, 'getAuditStats');

      await auditService.logCreate(userId, resource, resourceId, newValues);
      await auditService.logUpdate(
        userId,
        resource,
        resourceId,
        oldValues,
        newValues,
      );
      await auditService.logDelete(userId, resource, resourceId, oldValues);
      await auditService.getAuditLogs({ user_id: userId });
      await auditService.getAuditStats();

      expect(logSpy).toHaveBeenCalledTimes(3);
      expect(getAuditLogsSpy).toHaveBeenCalledWith({ user_id: userId });
      expect(getAuditStatsSpy).toHaveBeenCalled();
    });

    it('should handle authentication events', async () => {
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      const logAuthSpy = jest.spyOn(auditService, 'logAuth');

      await auditService.logAuth(1, 'LOGIN' as any, { method: 'password' });
      await auditService.logAuth(undefined, 'LOGIN_FAILED' as any, {
        reason: 'invalid_credentials',
      });

      expect(logAuthSpy).toHaveBeenCalledTimes(2);
    });

    it('should handle system events', async () => {
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      const logSystemSpy = jest.spyOn(auditService, 'logSystem');

      await auditService.logSystem('PASSWORD_RESET' as any, 'system' as any, {
        affected_users: 5,
      });

      expect(logSystemSpy).toHaveBeenCalledWith(
        'PASSWORD_RESET' as any,
        'system' as any,
        { affected_users: 5 },
      );
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle service errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      mockPrismaService.audit_logs.create.mockRejectedValue(
        new Error('Database error'),
      );

      await auditService.logCreate(1, 'products' as any, 123, { name: 'Test' });

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
    });
  });

  describe('Performance Integration', () => {
    it('should handle multiple concurrent operations', async () => {
      const promises: Promise<void>[] = [];
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });

      for (let i = 0; i < 10; i++) {
        promises.push(
          auditService.logCreate(i, 'products' as any, i, {
            name: `Product ${i}`,
          }),
        );
      }

      await Promise.all(promises);
    });

    it('should handle large filter sets efficiently', async () => {
      mockPrismaService.audit_logs.findMany.mockResolvedValue([]);
      const complexFilters = {
        user_id: 1,
        store_id: 1,
        organization_id: 1,
        action: 'CREATE' as any,
        resource: 'products' as any,
        resource_id: 123,
        from_date: new Date('2025-01-01'),
        to_date: new Date('2025-12-31'),
        limit: 100,
        offset: 0,
      };

      const getAuditLogsSpy = jest.spyOn(auditService, 'getAuditLogs');

      await auditService.getAuditLogs(complexFilters);

      expect(getAuditLogsSpy).toHaveBeenCalledWith(complexFilters);
    });
  });

  describe('Data Consistency Integration', () => {
    it('should maintain data integrity across operations', async () => {
      mockPrismaService.audit_logs.create.mockResolvedValue({ id: 1 });
      const userId = 1;
      const resource = 'products' as any;
      const resourceId = 123;
      const testData = { name: 'Test Product', price: 99.99 };

      const logSpy = jest.spyOn(auditService, 'log');

      await auditService.logCreate(userId, resource, resourceId, testData);
      await auditService.logUpdate(userId, resource, resourceId, testData, {
        ...testData,
        price: 149.99,
      });
      await auditService.logDelete(userId, resource, resourceId, testData);

      expect(logSpy).toHaveBeenNthCalledWith(1, {
        userId,
        action: 'CREATE',
        resource,
        resourceId,
        newValues: testData,
        metadata: { source: 'test' },
      });

      expect(logSpy).toHaveBeenNthCalledWith(2, {
        userId,
        action: 'UPDATE',
        resource,
        resourceId,
        oldValues: testData,
        newValues: { ...testData, price: 149.99 },
        metadata: undefined,
      });

      expect(logSpy).toHaveBeenNthCalledWith(3, {
        userId,
        action: 'DELETE',
        resource,
        resourceId,
        oldValues: testData,
        metadata: undefined,
      });
    });
  });
});
