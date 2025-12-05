import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsController } from '../organizations.controller';
import { OrganizationsService } from '../organizations.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { NotFoundException } from '@nestjs/common';
import { UpdateOrganizationDto, OrganizationDashboardDto } from '../dto';

// Mock types
type MockOrganizationsService = jest.Mocked<OrganizationsService> & {
  getProfile: jest.MockedFunction<any>;
  updateProfile: jest.MockedFunction<any>;
  getDashboard: jest.MockedFunction<any>;
};

type MockResponseService = jest.Mocked<ResponseService> & {
  success: jest.MockedFunction<any>;
  error: jest.MockedFunction<any>;
};

describe('OrganizationsController', () => {
  let controller: OrganizationsController;
  let mock_service: MockOrganizationsService;
  let mock_response_service: MockResponseService;

  const mock_organization_data = {
    id: 1,
    name: 'Test Organization',
    slug: 'test-organization',
    email: 'test@org.com',
    legal_name: null,
    tax_id: null,
    phone: null,
    website: null,
    logo_url: null,
    description: null,
    state: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    addresses: [],
    onboarding: {
      is_completed: false,
      setup_progress: 0,
    },
  };

  const mock_dashboard_data = {
    organization_id: 1,
    store_filter: undefined,
    stats: {
      total_stores: { value: 5, sub_value: 2, sub_label: 'new this month' },
      active_users: { value: 50, sub_value: null, sub_label: 'active users' },
      monthly_orders: { value: 100, sub_value: 10, sub_label: 'orders today' },
      revenue: { value: 5000, sub_value: 500, sub_label: 'vs last month' },
    },
  };

  beforeEach(async () => {
    const mock_service_provider = {
      provide: OrganizationsService,
      useValue: {
        getProfile: jest.fn(),
        updateProfile: jest.fn(),
        getDashboard: jest.fn(),
      },
    };

    const mock_response_provider = {
      provide: ResponseService,
      useValue: {
        success: jest.fn().mockImplementation((data, message) => ({
          success: true,
          data,
          message,
        })),
        error: jest.fn().mockImplementation((message, error) => ({
          success: false,
          message,
          error,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [mock_service_provider, mock_response_provider],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
    mock_service = module.get(OrganizationsService) as MockOrganizationsService;
    mock_response_service = module.get(ResponseService) as MockResponseService;
  });

  describe('getProfile', () => {
    it('should return organization profile successfully', async () => {
      // Arrange
      mock_service.getProfile.mockResolvedValue(mock_organization_data);
      mock_response_service.success.mockReturnValue({
        success: true,
        data: mock_organization_data,
        message: 'Perfil de organización obtenido exitosamente',
      });

      // Act
      const result = await controller.getProfile();

      // Assert
      expect(mock_service.getProfile).toHaveBeenCalled();
      expect(mock_response_service.success).toHaveBeenCalledWith(
        mock_organization_data,
        'Perfil de organización obtenido exitosamente',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return error when service throws NotFoundException', async () => {
      // Arrange
      const error = new NotFoundException('Organization not found');
      mock_service.getProfile.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el perfil de la organización',
        error: 'Organization not found',
      });

      // Act
      const result = await controller.getProfile();

      // Assert
      expect(mock_service.getProfile).toHaveBeenCalled();
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al obtener el perfil de la organización',
        'Organization not found',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should return error when service throws any exception', async () => {
      // Arrange
      const error = new Error('Database error');
      mock_service.getProfile.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el perfil de la organización',
        error: 'Database error',
      });

      // Act
      const result = await controller.getProfile();

      // Assert
      expect(mock_service.getProfile).toHaveBeenCalled();
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al obtener el perfil de la organización',
        'Database error',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  describe('updateProfile', () => {
    const update_dto: UpdateOrganizationDto = {
      name: 'Updated Organization Name',
      email: 'updated@testorg.com',
    };

    it('should update organization profile successfully', async () => {
      // Arrange
      const updated_data = { ...mock_organization_data, ...update_dto };
      mock_service.updateProfile.mockResolvedValue(updated_data);
      mock_response_service.success.mockReturnValue({
        success: true,
        data: updated_data,
        message: 'Perfil de organización actualizado exitosamente',
      });

      // Act
      const result = await controller.updateProfile(update_dto);

      // Assert
      expect(mock_service.updateProfile).toHaveBeenCalledWith(update_dto);
      expect(mock_response_service.success).toHaveBeenCalledWith(
        updated_data,
        'Perfil de organización actualizado exitosamente',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return error when service throws NotFoundException', async () => {
      // Arrange
      const error = new NotFoundException('Organization not found');
      mock_service.updateProfile.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al actualizar el perfil de la organización',
        error: 'Organization not found',
      });

      // Act
      const result = await controller.updateProfile(update_dto);

      // Assert
      expect(mock_service.updateProfile).toHaveBeenCalledWith(update_dto);
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al actualizar el perfil de la organización',
        'Organization not found',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should return error when service throws validation error', async () => {
      // Arrange
      const error = new Error('Invalid email format');
      mock_service.updateProfile.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al actualizar el perfil de la organización',
        error: 'Invalid email format',
      });

      // Act
      const result = await controller.updateProfile(update_dto);

      // Assert
      expect(mock_service.updateProfile).toHaveBeenCalledWith(update_dto);
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al actualizar el perfil de la organización',
        'Invalid email format',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  describe('getDashboard', () => {
    const dashboard_query: OrganizationDashboardDto = {
      store_id: 123,
    };

    it('should return dashboard statistics successfully', async () => {
      // Arrange
      mock_service.getDashboard.mockResolvedValue(mock_dashboard_data);
      mock_response_service.success.mockReturnValue({
        success: true,
        data: mock_dashboard_data,
        message: 'Dashboard de organización obtenido exitosamente',
      });

      // Act
      const result = await controller.getDashboard(dashboard_query);

      // Assert
      expect(mock_service.getDashboard).toHaveBeenCalledWith(dashboard_query);
      expect(mock_response_service.success).toHaveBeenCalledWith(
        mock_dashboard_data,
        'Dashboard de organización obtenido exitosamente',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return dashboard statistics without store filter', async () => {
      // Arrange
      const query_without_store: OrganizationDashboardDto = {};
      mock_service.getDashboard.mockResolvedValue(mock_dashboard_data);
      mock_response_service.success.mockReturnValue({
        success: true,
        data: mock_dashboard_data,
        message: 'Dashboard de organización obtenido exitosamente',
      });

      // Act
      const result = await controller.getDashboard(query_without_store);

      // Assert
      expect(mock_service.getDashboard).toHaveBeenCalledWith(query_without_store);
      expect(mock_response_service.success).toHaveBeenCalledWith(
        mock_dashboard_data,
        'Dashboard de organización obtenido exitosamente',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should return error when service throws NotFoundException', async () => {
      // Arrange
      const error = new NotFoundException('Organization context not found');
      mock_service.getDashboard.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el dashboard de la organización',
        error: 'Organization context not found',
      });

      // Act
      const result = await controller.getDashboard({});

      // Assert
      expect(mock_service.getDashboard).toHaveBeenCalledWith({});
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al obtener el dashboard de la organización',
        'Organization context not found',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });

    it('should return error when service throws database error', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      mock_service.getDashboard.mockRejectedValue(error);
      mock_response_service.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el dashboard de la organización',
        error: 'Database connection failed',
      });

      // Act
      const result = await controller.getDashboard({});

      // Assert
      expect(mock_service.getDashboard).toHaveBeenCalledWith({});
      expect(mock_response_service.error).toHaveBeenCalledWith(
        'Error al obtener el dashboard de la organización',
        'Database connection failed',
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  describe('Controller Initialization', () => {
    it('should be defined', () => {
      // Assert
      expect(controller).toBeDefined();
    });

    it('should have required dependencies injected', () => {
      // Assert
      expect(mock_service).toBeDefined();
      expect(mock_response_service).toBeDefined();
    });
  });
});