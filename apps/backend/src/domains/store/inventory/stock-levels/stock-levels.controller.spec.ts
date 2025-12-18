import { Test, TestingModule } from '@nestjs/testing';
import { StockLevelsController } from './stock-levels.controller';
import { StockLevelsService } from './stock-levels.service';
import { ResponseService } from '@common/responses/response.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';

describe('StockLevelsController', () => {
  let controller: StockLevelsController;
  let stockLevelsService: jest.Mocked<StockLevelsService>;
  let responseService: jest.Mocked<ResponseService>;

  const mockStockLevel = {
    id: 1,
    product_id: 1,
    location_id: 1,
    product_variant_id: null,
    quantity_available: 50,
    quantity_reserved: 10,
    quantity_on_hand: 60,
    reorder_point: 20,
    last_updated: new Date('2024-01-01T10:00:00Z'),
    created_at: new Date('2024-01-01T09:00:00Z'),
    updated_at: new Date('2024-01-01T10:00:00Z'),
    products: {
      id: 1,
      name: 'Test Product',
      sku: 'TEST-001',
    },
    product_variants: null,
    inventory_locations: {
      id: 1,
      name: 'Main Warehouse',
      type: 'warehouse',
      organization_id: 1,
    },
  };

  const mockStockLevels = [mockStockLevel];

  const mockPaginatedResult = {
    data: mockStockLevels,
    meta: {
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };

  beforeEach(async () => {
    const mockStockLevelsService = {
      findAll: jest.fn(),
      findByProduct: jest.fn(),
      findByLocation: jest.fn(),
      getStockAlerts: jest.fn(),
      findOne: jest.fn(),
    };

    const mockResponseService = {
      success: jest.fn(),
      error: jest.fn(),
      paginated: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StockLevelsController],
      providers: [
        {
          provide: StockLevelsService,
          useValue: mockStockLevelsService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    }).compile();

    controller = module.get<StockLevelsController>(StockLevelsController);
    stockLevelsService = module.get(StockLevelsService);
    responseService = module.get(ResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated stock levels', async () => {
      const query: StockLevelQueryDto = {
        product_id: 1,
        location_id: 1,
      };

      stockLevelsService.findAll.mockResolvedValue(mockPaginatedResult);
      responseService.paginated.mockReturnValue({
        success: true,
        message: 'Niveles de stock obtenidos exitosamente',
        data: mockStockLevels,
        meta: mockPaginatedResult.meta,
      });

      const result = await controller.findAll(query);

      expect(stockLevelsService.findAll).toHaveBeenCalledWith(query);
      expect(responseService.paginated).toHaveBeenCalledWith(
        mockStockLevels,
        1,
        1,
        10,
        'Niveles de stock obtenidos exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should return simple success response when no pagination', async () => {
      const query: StockLevelQueryDto = {};

      stockLevelsService.findAll.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock obtenidos exitosamente',
        data: mockStockLevels,
      });

      const result = await controller.findAll(query);

      expect(stockLevelsService.findAll).toHaveBeenCalledWith(query);
      expect(responseService.success).toHaveBeenCalledWith(
        mockStockLevels,
        'Niveles de stock obtenidos exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle errors and return error response', async () => {
      const query: StockLevelQueryDto = {};
      const error = new Error('Database error');

      stockLevelsService.findAll.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock',
        error: 'Database error',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findAll(query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Database error',
        'Database error',
        400,
      );
      expect(result.success).toBe(false);
    });

    it('should handle errors with custom status codes', async () => {
      const query: StockLevelQueryDto = {};
      const error = {
        message: 'Not found',
        response: { message: 'Stock level not found' },
        status: 404,
      };

      stockLevelsService.findAll.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock',
        error: 'Stock level not found',
        statusCode: 404,
        timestamp: expect.any(String),
      });

      await controller.findAll(query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Not found',
        'Stock level not found',
        404,
      );
    });
  });

  describe('findByProduct', () => {
    it('should return stock levels for a specific product', async () => {
      const productId = '1';
      const query: StockLevelQueryDto = {
        location_id: 1,
      };

      stockLevelsService.findByProduct.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock del producto obtenidos exitosamente',
        data: mockStockLevels,
      });

      const result = await controller.findByProduct(productId, query);

      expect(stockLevelsService.findByProduct).toHaveBeenCalledWith(1, query);
      expect(responseService.success).toHaveBeenCalledWith(
        mockStockLevels,
        'Niveles de stock del producto obtenidos exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle string productId conversion', async () => {
      const productId = '123';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByProduct.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock del producto obtenidos exitosamente',
        data: mockStockLevels,
      });

      await controller.findByProduct(productId, query);

      expect(stockLevelsService.findByProduct).toHaveBeenCalledWith(123, query);
    });

    it('should handle errors when finding by product', async () => {
      const productId = '999';
      const query: StockLevelQueryDto = {};
      const error = new Error('Product not found');

      stockLevelsService.findByProduct.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock del producto',
        error: 'Product not found',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findByProduct(productId, query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Product not found',
        'Product not found',
        400,
      );
      expect(result.success).toBe(false);
    });
  });

  describe('findByLocation', () => {
    it('should return stock levels for a specific location', async () => {
      const locationId = '1';
      const query: StockLevelQueryDto = {
        product_id: 1,
      };

      stockLevelsService.findByLocation.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock de la ubicación obtenidos exitosamente',
        data: mockStockLevels,
      });

      const result = await controller.findByLocation(locationId, query);

      expect(stockLevelsService.findByLocation).toHaveBeenCalledWith(1, query);
      expect(responseService.success).toHaveBeenCalledWith(
        mockStockLevels,
        'Niveles de stock de la ubicación obtenidos exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle string locationId conversion', async () => {
      const locationId = '456';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByLocation.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock de la ubicación obtenidos exitosamente',
        data: mockStockLevels,
      });

      await controller.findByLocation(locationId, query);

      expect(stockLevelsService.findByLocation).toHaveBeenCalledWith(
        456,
        query,
      );
    });

    it('should handle errors when finding by location', async () => {
      const locationId = '999';
      const query: StockLevelQueryDto = {};
      const error = new Error('Location not found');

      stockLevelsService.findByLocation.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock de la ubicación',
        error: 'Location not found',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findByLocation(locationId, query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Location not found',
        'Location not found',
        400,
      );
      expect(result.success).toBe(false);
    });
  });

  describe('getStockAlerts', () => {
    it('should return stock alerts', async () => {
      const query: StockLevelQueryDto = {
        product_id: 1,
      };

      const mockAlerts = [
        {
          ...mockStockLevel,
          quantity_available: 15, // Below reorder point
        },
      ];

      stockLevelsService.getStockAlerts.mockResolvedValue(mockAlerts);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Alertas de stock obtenidas exitosamente',
        data: mockAlerts,
      });

      const result = await controller.getStockAlerts(query);

      expect(stockLevelsService.getStockAlerts).toHaveBeenCalledWith(query);
      expect(responseService.success).toHaveBeenCalledWith(
        mockAlerts,
        'Alertas de stock obtenidas exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle empty alerts', async () => {
      const query: StockLevelQueryDto = {};

      stockLevelsService.getStockAlerts.mockResolvedValue([]);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Alertas de stock obtenidas exitosamente',
        data: [],
      });

      const result = await controller.getStockAlerts(query);

      expect(stockLevelsService.getStockAlerts).toHaveBeenCalledWith(query);
      expect(responseService.success).toHaveBeenCalledWith(
        [],
        'Alertas de stock obtenidas exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle errors when getting stock alerts', async () => {
      const query: StockLevelQueryDto = {};
      const error = new Error('Failed to get alerts');

      stockLevelsService.getStockAlerts.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener las alertas de stock',
        error: 'Failed to get alerts',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.getStockAlerts(query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Failed to get alerts',
        'Failed to get alerts',
        400,
      );
      expect(result.success).toBe(false);
    });
  });

  describe('findOne', () => {
    it('should return a single stock level', async () => {
      const id = '1';

      stockLevelsService.findOne.mockResolvedValue(mockStockLevel);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Nivel de stock obtenido exitosamente',
        data: mockStockLevel,
      });

      const result = await controller.findOne(id);

      expect(stockLevelsService.findOne).toHaveBeenCalledWith(1);
      expect(responseService.success).toHaveBeenCalledWith(
        mockStockLevel,
        'Nivel de stock obtenido exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle string id conversion', async () => {
      const id = '789';

      stockLevelsService.findOne.mockResolvedValue(mockStockLevel);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Nivel de stock obtenido exitosamente',
        data: mockStockLevel,
      });

      await controller.findOne(id);

      expect(stockLevelsService.findOne).toHaveBeenCalledWith(789);
    });

    it('should handle errors when finding one stock level', async () => {
      const id = '999';
      const error = new Error('Stock level not found');

      stockLevelsService.findOne.mockRejectedValue(error);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el nivel de stock',
        error: 'Stock level not found',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findOne(id);

      expect(responseService.error).toHaveBeenCalledWith(
        'Stock level not found',
        'Stock level not found',
        400,
      );
      expect(result.success).toBe(false);
    });
  });

  describe('Multi-tenant context and permissions', () => {
    it('should pass organization context through queries', async () => {
      const query: StockLevelQueryDto = {
        product_id: 1,
        location_id: 1,
      };

      stockLevelsService.findAll.mockResolvedValue(mockPaginatedResult);
      responseService.paginated.mockReturnValue({
        success: true,
        message: 'Niveles de stock obtenidos exitosamente',
        data: mockStockLevels,
        meta: mockPaginatedResult.meta,
      });

      await controller.findAll(query);

      expect(stockLevelsService.findAll).toHaveBeenCalledWith(query);
    });

    it('should handle queries with all filters', async () => {
      const productId = '1';
      const query: StockLevelQueryDto = {
        product_id: 1,
        product_variant_id: 2,
        location_id: 3,
      };

      stockLevelsService.findByProduct.mockResolvedValue(mockStockLevels);
      responseService.success.mockReturnValue({
        success: true,
        message: 'Niveles de stock del producto obtenidos exitosamente',
        data: mockStockLevels,
      });

      await controller.findByProduct(productId, query);

      expect(stockLevelsService.findByProduct).toHaveBeenCalledWith(1, query);
    });
  });

  describe('Edge cases and validation', () => {
    it('should handle invalid productId format', async () => {
      const productId = 'invalid';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByProduct.mockRejectedValue(
        new Error('Invalid ID'),
      );
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock del producto',
        error: 'Invalid ID',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findByProduct(productId, query);

      expect(result.success).toBe(false);
    });

    it('should handle invalid locationId format', async () => {
      const locationId = 'invalid';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByLocation.mockRejectedValue(
        new Error('Invalid ID'),
      );
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock de la ubicación',
        error: 'Invalid ID',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findByLocation(locationId, query);

      expect(result.success).toBe(false);
    });

    it('should handle invalid id format in findOne', async () => {
      const id = 'invalid';

      stockLevelsService.findOne.mockRejectedValue(new Error('Invalid ID'));
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener el nivel de stock',
        error: 'Invalid ID',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findOne(id);

      expect(result.success).toBe(false);
    });

    it('should handle service timeouts', async () => {
      const query: StockLevelQueryDto = {};
      const timeoutError = new Error('Service timeout');

      stockLevelsService.findAll.mockRejectedValue(timeoutError);
      responseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener los niveles de stock',
        error: 'Service timeout',
        statusCode: 400,
        timestamp: expect.any(String),
      });

      const result = await controller.findAll(query);

      expect(responseService.error).toHaveBeenCalledWith(
        'Service timeout',
        'Service timeout',
        400,
      );
      expect(result.success).toBe(false);
    });
  });
});
