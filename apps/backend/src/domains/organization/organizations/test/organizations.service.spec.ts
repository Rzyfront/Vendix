import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from '../organizations.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UpdateOrganizationDto, OrganizationDashboardDto } from '../dto';
import { NotFoundException } from '@nestjs/common';

// Mock types
type MockOrganizationPrismaService = jest.Mocked<OrganizationPrismaService> & {
  organizations: {
    findUnique: jest.MockedFunction<any>;
    update: jest.MockedFunction<any>;
  };
  stores: {
    count: jest.MockedFunction<any>;
  };
  users: {
    count: jest.MockedFunction<any>;
  };
  orders: {
    count: jest.MockedFunction<any>;
    aggregate: jest.MockedFunction<any>;
  };
  order_items: {
    aggregate: jest.MockedFunction<any>;
  };
};

type MockRequestContextService = jest.Mocked<RequestContextService> & {
  getContext: jest.MockedFunction<any>;
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let mock_prisma: MockOrganizationPrismaService;
  let mock_context_service: MockRequestContextService;

  const mock_organization_data = {
    id: 1,
    name: 'Test Organization',
    slug: 'test-organization',
    email: 'test@org.com',
    created_at: new Date(),
    updated_at: new Date(),
    addresses: [],
    onboarding: {
      is_completed: false,
      setup_progress: 0,
    },
  };

  const mock_context = {
    user_id: 1,
    organization_id: 1,
    store_id: null,
    roles: ['owner'],
    is_super_admin: false,
    is_owner: true,
    email: 'test@org.com',
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock services
    mock_prisma = {
      organizations: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      stores: {
        count: jest.fn(),
      },
      users: {
        count: jest.fn(),
      },
      orders: {
        count: jest.fn(),
        aggregate: jest.fn(),
      },
      order_items: {
        aggregate: jest.fn(),
      },
    } as any;

    mock_context_service = {
      getContext: jest.fn(),
    } as any;

    // Setup default return values
    mock_context_service.getContext.mockReturnValue(mock_context);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: OrganizationPrismaService,
          useValue: mock_prisma,
        },
        {
          provide: RequestContextService,
          useValue: mock_context_service,
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  describe('getProfile', () => {
    it('should return organization profile when context exists', async () => {
      // Arrange
      mock_prisma.organizations.findUnique.mockResolvedValue(mock_organization_data);

      // Act
      const result = await service.getProfile();

      // Assert
      expect(mock_context_service.getContext).toHaveBeenCalled();
      expect(mock_prisma.organizations.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          addresses: { where: { is_primary: true } },
        },
      });
      expect(result).toBeDefined();
      expect(result.id).toBe(1);
      expect(result.name).toBe('Test Organization');
    });

    it('should throw NotFoundException when no context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue(null);

      // Act & Assert
      try {
        await service.getProfile();
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });

    it('should throw NotFoundException when no organization_id in context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue({
        ...mock_context,
        organization_id: undefined,
      });

      // Act & Assert
      try {
        await service.getProfile();
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });

    it('should throw NotFoundException when organization not found', async () => {
      // Arrange
      mock_prisma.organizations.findUnique.mockResolvedValue(null);

      // Act & Assert
      try {
        await service.getProfile();
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization not found');
      }
    });
  });

  describe('updateProfile', () => {
    const update_dto: UpdateOrganizationDto = {
      name: 'Updated Organization',
      email: 'updated@org.com',
    };

    it('should update organization profile successfully', async () => {
      // Arrange
      const updated_data = { ...mock_organization_data, ...update_dto };
      mock_prisma.organizations.update.mockResolvedValue(updated_data);

      // Act
      const result = await service.updateProfile(update_dto);

      // Assert
      expect(mock_context_service.getContext).toHaveBeenCalled();
      expect(mock_prisma.organizations.update).toHaveBeenCalled();
      expect(result.id).toBe(1);
      expect(result.name).toBe('Updated Organization');
    });

    it('should throw NotFoundException when no context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue(null);

      // Act & Assert
      try {
        await service.updateProfile(update_dto);
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });

    it('should throw NotFoundException when no organization_id in context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue({
        ...mock_context,
        organization_id: undefined,
      });

      // Act & Assert
      try {
        await service.updateProfile(update_dto);
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });
  });

  describe('getDashboard', () => {
    const dashboard_query: OrganizationDashboardDto = {
      store_id: 123,
    };

    it('should return dashboard statistics with store filter', async () => {
      // Arrange
      mock_prisma.stores.count
        .mockResolvedValueOnce(5) // total_stores
        .mockResolvedValueOnce(2); // new_stores

      mock_prisma.users.count.mockResolvedValue(50); // active_users

      mock_prisma.orders.count
        .mockResolvedValueOnce(100) // monthly_orders
        .mockResolvedValueOnce(10);  // orders_today

      mock_prisma.orders.aggregate
        .mockResolvedValueOnce({ _sum: { grand_total: 6000, shipping_cost: 500 } })
        .mockResolvedValueOnce({ _sum: { grand_total: 5500, shipping_cost: 450 } });

      mock_prisma.order_items.aggregate
        .mockResolvedValueOnce({ _sum: { total_price: 1000 } })
        .mockResolvedValueOnce({ _sum: { total_price: 950 } });

      mock_prisma.orders.aggregate
        .mockResolvedValueOnce({ _sum: { grand_total: 5000, shipping_cost: 400 } })
        .mockResolvedValueOnce({ _sum: { grand_total: 4800, shipping_cost: 350 } });

      mock_prisma.order_items.aggregate
        .mockResolvedValueOnce({ _sum: { total_price: 800 } })
        .mockResolvedValueOnce({ _sum: { total_price: 750 } });

      // Act
      const result = await service.getDashboard(dashboard_query);

      // Assert
      expect(mock_context_service.getContext).toHaveBeenCalled();
      expect(mock_prisma.stores.count).toHaveBeenCalledWith({
        where: { organization_id: 1, is_active: true },
      });
      expect(mock_prisma.orders.count).toHaveBeenCalled();

      expect(result).toBeDefined();
      expect(result.organization_id).toBe(1);
      expect(result.store_filter).toBe(123);
      expect(result.stats).toBeDefined();
      expect(result.stats.total_stores).toBeDefined();
      expect(result.stats.active_users).toBeDefined();
      expect(result.stats.monthly_orders).toBeDefined();
      expect(result.stats.revenue).toBeDefined();
    });

    it('should return dashboard statistics without store filter', async () => {
      // Arrange
      mock_prisma.stores.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2);

      mock_prisma.users.count.mockResolvedValue(50);

      mock_prisma.orders.count
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(10);

      mock_prisma.orders.aggregate
        .mockResolvedValueOnce({ _sum: { grand_total: 6000, shipping_cost: 500 } })
        .mockResolvedValueOnce({ _sum: { grand_total: 5500, shipping_cost: 450 } });

      mock_prisma.order_items.aggregate
        .mockResolvedValueOnce({ _sum: { total_price: 1000 } })
        .mockResolvedValueOnce({ _sum: { total_price: 950 } });

      mock_prisma.orders.aggregate
        .mockResolvedValueOnce({ _sum: { grand_total: 5000, shipping_cost: 400 } })
        .mockResolvedValueOnce({ _sum: { grand_total: 4800, shipping_cost: 350 } });

      mock_prisma.order_items.aggregate
        .mockResolvedValueOnce({ _sum: { total_price: 800 } })
        .mockResolvedValueOnce({ _sum: { total_price: 750 } });

      const query_without_store: OrganizationDashboardDto = {};

      // Act
      const result = await service.getDashboard(query_without_store);

      // Assert
      expect(result).toBeDefined();
      expect(result.organization_id).toBe(1);
      expect(result.store_filter).toBeUndefined();
      expect(result.stats).toBeDefined();
    });

    it('should throw NotFoundException when no context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue(null);

      // Act & Assert
      try {
        await service.getDashboard({});
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });

    it('should throw NotFoundException when no organization_id in context', async () => {
      // Arrange
      mock_context_service.getContext.mockReturnValue({
        ...mock_context,
        organization_id: undefined,
      });

      // Act & Assert
      try {
        await service.getDashboard({});
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Organization context not found');
      }
    });
  });
});