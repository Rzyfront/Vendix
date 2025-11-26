import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService, AuditAction, AuditResource } from './audit.service';
import { ResponseService } from '../../common/responses/response.service';
import { UserRole } from '../auth/enums/user-role.enum';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: AuditService;
  let responseService: ResponseService;

  const mockAuditService = {
    getAuditLogs: jest.fn(),
    getAuditStats: jest.fn(),
  };

  const mockResponseService = {
    success: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    auditService = module.get<AuditService>(AuditService);
    responseService = module.get<ResponseService>(ResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAuditLogs', () => {
    it('should return audit logs with all filters', async () => {
      const query = {
        user_id: '1',
        store_id: '1',
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
        resource_id: '123',
        from_date: '2025-01-01',
        to_date: '2025-12-31',
        limit: '10',
        offset: '0',
        organization_id: '1',
      };

      const expectedFilters = {
        user_id: 1,
        store_id: 1,
        action: AuditAction.CREATE,
        resource: AuditResource.PRODUCTS,
        resource_id: 123,
        from_date: new Date('2025-01-01'),
        to_date: new Date('2025-12-31'),
        limit: 10,
        offset: 0,
        organization_id: 1,
      };

      const mockLogs = [
        {
          id: 1,
          action: AuditAction.CREATE,
          resource: AuditResource.PRODUCTS,
          users: { id: 1, email: 'test@example.com' },
        },
      ];

      mockAuditService.getAuditLogs.mockResolvedValue(mockLogs);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });

      const result = await controller.getAuditLogs(
        query.user_id,
        query.store_id,
        query.action,
        query.resource,
        query.resource_id,
        query.from_date,
        query.to_date,
        query.limit,
        query.offset,
        query.organization_id,
      );

      expect(mockAuditService.getAuditLogs).toHaveBeenCalledWith(
        expectedFilters,
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        mockLogs,
        'Audit logs retrieved successfully',
      );
      expect(result).toEqual({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });
    });

    it('should return audit logs with no filters', async () => {
      const mockLogs = [{ id: 1, action: AuditAction.LOGIN }];
      mockAuditService.getAuditLogs.mockResolvedValue(mockLogs);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });

      const result = await controller.getAuditLogs();

      expect(mockAuditService.getAuditLogs).toHaveBeenCalledWith({});
      expect(mockResponseService.success).toHaveBeenCalledWith(
        mockLogs,
        'Audit logs retrieved successfully',
      );
      expect(result).toEqual({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });
    });

    it('should handle partial filters', async () => {
      const query = {
        user_id: '1',
        action: AuditAction.DELETE,
        limit: '20',
      };

      const expectedFilters = {
        user_id: 1,
        action: AuditAction.DELETE,
        limit: 20,
      };

      const mockLogs = [{ id: 1, action: AuditAction.DELETE }];
      mockAuditService.getAuditLogs.mockResolvedValue(mockLogs);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });

      await controller.getAuditLogs(
        query.user_id,
        undefined,
        query.action,
        undefined,
        undefined,
        undefined,
        undefined,
        query.limit,
      );

      expect(mockAuditService.getAuditLogs).toHaveBeenCalledWith(
        expectedFilters,
      );
    });

    it('should handle invalid date strings gracefully', async () => {
      const query = {
        from_date: 'invalid-date',
        to_date: 'also-invalid',
      };

      const mockLogs = [{ id: 1 }];
      mockAuditService.getAuditLogs.mockResolvedValue(mockLogs);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockLogs,
        message: 'Audit logs retrieved successfully',
      });

      await controller.getAuditLogs(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        query.from_date,
        query.to_date,
      );

      const expectedFromDate = new Date('invalid-date');
      const expectedToDate = new Date('also-invalid');

      expect(mockAuditService.getAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({
          from_date: expect.any(Date),
          to_date: expect.any(Date),
        }),
      );
    });

    it('should handle numeric string filters', async () => {
      const query = {
        user_id: '42',
        store_id: '100',
        resource_id: '999',
        limit: '25',
        offset: '5',
        organization_id: '7',
      };

      const expectedFilters = {
        user_id: 42,
        store_id: 100,
        resource_id: 999,
        limit: 25,
        offset: 5,
        organization_id: 7,
      };

      mockAuditService.getAuditLogs.mockResolvedValue([]);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: [],
        message: 'Audit logs retrieved successfully',
      });

      await controller.getAuditLogs(
        query.user_id,
        query.store_id,
        undefined,
        undefined,
        query.resource_id,
        undefined,
        undefined,
        query.limit,
        query.offset,
        query.organization_id,
      );

      expect(mockAuditService.getAuditLogs).toHaveBeenCalledWith(
        expectedFilters,
      );
    });
  });

  describe('getAuditStats', () => {
    it('should return audit statistics with date range', async () => {
      const query = {
        fromDate: '2025-01-01',
        toDate: '2025-12-31',
      };

      const expectedFromDate = new Date('2025-01-01');
      const expectedToDate = new Date('2025-12-31');

      const mockStats = {
        total_logs: 100,
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
      };

      mockAuditService.getAuditStats.mockResolvedValue(mockStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });

      const result = await controller.getAuditStats(
        query.fromDate,
        query.toDate,
      );

      expect(mockAuditService.getAuditStats).toHaveBeenCalledWith(
        expectedFromDate,
        expectedToDate,
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        mockStats,
        'Audit statistics retrieved successfully',
      );
      expect(result).toEqual({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });
    });

    it('should return audit statistics without date range', async () => {
      const mockStats = {
        total_logs: 50,
        logs_by_action: {
          LOGIN: 25,
          LOGOUT: 25,
        },
        logs_by_resource: {
          auth: 50,
        },
      };

      mockAuditService.getAuditStats.mockResolvedValue(mockStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });

      const result = await controller.getAuditStats();

      expect(mockAuditService.getAuditStats).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(mockResponseService.success).toHaveBeenCalledWith(
        mockStats,
        'Audit statistics retrieved successfully',
      );
      expect(result).toEqual({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });
    });

    it('should handle only one date parameter', async () => {
      const query = {
        fromDate: '2025-06-01',
      };

      const expectedFromDate = new Date('2025-06-01');

      const mockStats = {
        total_logs: 75,
        logs_by_action: {},
        logs_by_resource: {},
      };

      mockAuditService.getAuditStats.mockResolvedValue(mockStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });

      await controller.getAuditStats(query.fromDate);

      expect(mockAuditService.getAuditStats).toHaveBeenCalledWith(
        expect.any(Date),
        undefined,
      );
    });

    it('should handle only toDate parameter', async () => {
      const query = {
        toDate: '2025-06-30',
      };

      const expectedToDate = new Date('2025-06-30');

      const mockStats = {
        total_logs: 60,
        logs_by_action: {},
        logs_by_resource: {},
      };

      mockAuditService.getAuditStats.mockResolvedValue(mockStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });

      await controller.getAuditStats(undefined, query.toDate);

      expect(mockAuditService.getAuditStats).toHaveBeenCalledWith(
        undefined,
        expect.any(Date),
      );
    });

    it('should handle invalid date strings in stats', async () => {
      const query = {
        fromDate: 'not-a-date',
        toDate: 'also-not-a-date',
      };

      const mockStats = {
        total_logs: 0,
        logs_by_action: {},
        logs_by_resource: {},
      };

      mockAuditService.getAuditStats.mockResolvedValue(mockStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockStats,
        message: 'Audit statistics retrieved successfully',
      });

      await controller.getAuditStats(query.fromDate, query.toDate);

      await controller.getAuditStats(query.fromDate, query.toDate);

      expect(mockAuditService.getAuditStats).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
    });
  });

  describe('Controller Configuration', () => {
    it('should be properly configured with decorators', () => {
      expect(controller).toBeDefined();
    });

    it('should have correct route prefix', () => {
      const controllerMetadata = Reflect.getMetadata('path', AuditController);
      expect(controllerMetadata).toBe('admin/audit');
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors in getAuditLogs', async () => {
      const error = new Error('Database error');
      mockAuditService.getAuditLogs.mockRejectedValue(error);

      await expect(controller.getAuditLogs()).rejects.toThrow('Database error');
      expect(mockResponseService.success).not.toHaveBeenCalled();
    });

    it('should handle service errors in getAuditStats', async () => {
      const error = new Error('Stats service error');
      mockAuditService.getAuditStats.mockRejectedValue(error);

      await expect(controller.getAuditStats()).rejects.toThrow(
        'Stats service error',
      );
      expect(mockResponseService.success).not.toHaveBeenCalled();
    });
  });
});
