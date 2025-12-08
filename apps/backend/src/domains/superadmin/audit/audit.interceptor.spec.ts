import { Test, TestingModule } from '@nestjs/testing';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService, AuditResource } from './audit.service';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let auditService: AuditService;
  let mockContext: ExecutionContext;
  let mockCallHandler: CallHandler;

  const mockAuditService = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logDelete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    interceptor = module.get<AuditInterceptor>(AuditInterceptor);
    auditService = module.get<AuditService>(AuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('intercept', () => {
    beforeEach(() => {
      mockCallHandler = {
        handle: jest.fn(),
      };
    });

    it('should skip audit when no user is authenticated', async () => {
      const mockRequest = {
        user: null,
        method: 'POST',
        url: '/api/products',
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 1, name: 'Test Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      const result = await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(auditService.logCreate).not.toHaveBeenCalled();
      expect(auditService.logUpdate).not.toHaveBeenCalled();
      expect(auditService.logDelete).not.toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it('should audit POST create operation', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/products/create',
        body: { name: 'New Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 123, name: 'New Product', price: 99.99 };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      const result = await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(mockCallHandler.handle).toHaveBeenCalled();
      expect(auditService.logCreate).toHaveBeenCalledWith(
        1,
        AuditResource.PRODUCTS,
        123,
        mockData,
      );
      expect(result).toEqual(mockData);
    });

    it('should audit POST register operation', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/users/register',
        body: { email: 'test@example.com' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 456, email: 'test@example.com' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logCreate).toHaveBeenCalledWith(
        1,
        AuditResource.USERS,
        456,
        mockData,
      );
    });

    it('should audit POST operation without create in URL', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/products',
        body: { name: 'New Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 789, name: 'New Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logCreate).toHaveBeenCalledWith(
        1,
        AuditResource.PRODUCTS,
        789,
        mockData,
      );
    });

    it('should audit PUT update operation', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'PUT',
        url: '/api/products/update/123',
        body: { name: 'Updated Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 123, name: 'Updated Product', price: 149.99 };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        1,
        AuditResource.PRODUCTS,
        123,
        { name: 'Updated Product' },
        mockData,
      );
    });

    it('should audit PUT edit operation', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'PUT',
        url: '/api/users/edit/456',
        body: { email: 'updated@example.com' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 456, email: 'updated@example.com' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        1,
        AuditResource.USERS,
        456,
        { email: 'updated@example.com' },
        mockData,
      );
    });

    it('should audit PUT operation without update in URL', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'PUT',
        url: '/api/products/123',
        body: { name: 'Updated Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 123, name: 'Updated Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logUpdate).toHaveBeenCalledWith(
        1,
        AuditResource.PRODUCTS,
        123,
        { name: 'Updated Product' },
        mockData,
      );
    });

    it('should audit DELETE operation', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'DELETE',
        url: '/api/products/123',
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { success: true };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logDelete).toHaveBeenCalledWith(
        1,
        AuditResource.PRODUCTS,
        123,
        {},
      );
    });

    it('should not audit when response has no ID for create/update', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/products/create',
        body: { name: 'New Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { message: 'Created successfully' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('should not audit when resource cannot be determined', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/unknown-resource/create',
        body: { name: 'Something' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 1, name: 'Something' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logCreate).not.toHaveBeenCalled();
    });

    it('should not audit DELETE when resource ID cannot be extracted', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'DELETE',
        url: '/api/products/delete',
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { success: true };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('should handle audit service errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/products/create',
        body: { name: 'New Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const mockData = { id: 123, name: 'New Product' };
      (mockCallHandler.handle as jest.Mock).mockReturnValue(of(mockData));
      mockAuditService.logCreate.mockRejectedValue(
        new Error('Audit service error'),
      );

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      // Wait a tick for the tap operator to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error en AuditInterceptor:',
        expect.any(Error),
      );

      await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      // Wait a tick for the tap operator to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error en AuditInterceptor:',
        expect.any(Error),
      );

      const result = await interceptor
        .intercept(mockExecutionContext, mockCallHandler)
        .toPromise();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error en AuditInterceptor:',
        expect.any(Error),
      );
      expect(result).toEqual(mockData);

      consoleErrorSpy.mockRestore();
    });

    it('should handle HTTP errors without auditing', async () => {
      const mockRequest = {
        user: { id: 1 },
        method: 'POST',
        url: '/api/products/create',
        body: { name: 'New Product' },
      };

      const mockResponse = {};
      const mockExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const error = new Error('HTTP Error');
      (mockCallHandler.handle as jest.Mock).mockReturnValue(throwError(error));

      await expect(
        interceptor
          .intercept(mockExecutionContext, mockCallHandler)
          .toPromise(),
      ).rejects.toThrow('HTTP Error');

      expect(auditService.logCreate).not.toHaveBeenCalled();
    });
  });

  describe('Helper Methods', () => {
    describe('isCreateOperation', () => {
      it('should return true for create URLs', () => {
        expect(
          (interceptor as any).isCreateOperation('/api/products/create'),
        ).toBe(true);
        expect(
          (interceptor as any).isCreateOperation('/api/users/register'),
        ).toBe(true);
        expect((interceptor as any).isCreateOperation('/api/products')).toBe(
          true,
        );
        expect((interceptor as any).isCreateOperation('/api/items')).toBe(true);
      });

      it('should return false for non-create URLs', () => {
        expect(
          (interceptor as any).isCreateOperation('/api/products/update/1'),
        ).toBe(false);
        expect(
          (interceptor as any).isCreateOperation('/api/products/delete/1'),
        ).toBe(false);
        expect(
          (interceptor as any).isCreateOperation('/api/products/edit/1'),
        ).toBe(false);
      });
    });

    describe('isUpdateOperation', () => {
      it('should return true for update URLs', () => {
        expect(
          (interceptor as any).isUpdateOperation(
            '/api/products/update/1',
            'PUT',
          ),
        ).toBe(true);
        expect(
          (interceptor as any).isUpdateOperation('/api/users/edit/1', 'PUT'),
        ).toBe(true);
        expect(
          (interceptor as any).isUpdateOperation('/api/items/1', 'PUT'),
        ).toBe(true);
      });

      it('should return false for non-update URLs', () => {
        expect(
          (interceptor as any).isUpdateOperation('/api/products/create', 'PUT'),
        ).toBe(false);
        expect(
          (interceptor as any).isUpdateOperation(
            '/api/products/delete/1',
            'PUT',
          ),
        ).toBe(false);
        expect(
          (interceptor as any).isUpdateOperation('/api/products/1', 'POST'),
        ).toBe(false);
      });
    });

    describe('isDeleteOperation', () => {
      it('should return true for DELETE method', () => {
        expect(
          (interceptor as any).isDeleteOperation('/api/products/1', 'DELETE'),
        ).toBe(true);
      });

      it('should return false for non-DELETE methods', () => {
        expect(
          (interceptor as any).isDeleteOperation('/api/products/1', 'GET'),
        ).toBe(false);
        expect(
          (interceptor as any).isDeleteOperation('/api/products/1', 'POST'),
        ).toBe(false);
        expect(
          (interceptor as any).isDeleteOperation('/api/products/1', 'PUT'),
        ).toBe(false);
      });
    });

    describe('extractResourceFromUrl', () => {
      it('should extract known resources', () => {
        expect(
          (interceptor as any).extractResourceFromUrl('/api/users/1'),
        ).toBe(AuditResource.USERS);
        expect(
          (interceptor as any).extractResourceFromUrl('/api/organizations/1'),
        ).toBe(AuditResource.ORGANIZATIONS);
        expect(
          (interceptor as any).extractResourceFromUrl('/api/stores/1'),
        ).toBe(AuditResource.STORES);
        expect(
          (interceptor as any).extractResourceFromUrl('/api/products/1'),
        ).toBe(AuditResource.PRODUCTS);
        expect(
          (interceptor as any).extractResourceFromUrl('/api/orders/1'),
        ).toBe(AuditResource.ORDERS);
      });

      it('should return null for unknown resources', () => {
        expect(
          (interceptor as any).extractResourceFromUrl('/api/unknown/1'),
        ).toBeNull();
        expect(
          (interceptor as any).extractResourceFromUrl(
            '/api/invalid-resource/1',
          ),
        ).toBeNull();
      });
    });

    describe('extractIdFromUrl', () => {
      it('should extract numeric IDs from URLs', () => {
        expect((interceptor as any).extractIdFromUrl('/api/products/123')).toBe(
          123,
        );
        expect(
          (interceptor as any).extractIdFromUrl('/api/users/456/update'),
        ).toBe(456);
        expect(
          (interceptor as any).extractIdFromUrl('/api/items/789/delete'),
        ).toBe(789);
      });

      it('should return null when no numeric ID found', () => {
        expect(
          (interceptor as any).extractIdFromUrl('/api/products/create'),
        ).toBeNull();
        expect(
          (interceptor as any).extractIdFromUrl('/api/users/list'),
        ).toBeNull();
        expect(
          (interceptor as any).extractIdFromUrl('/api/items/abc'),
        ).toBeNull();
        expect(
          (interceptor as any).extractIdFromUrl('/api/products/delete'),
        ).toBeNull();
      });
    });
  });
});
