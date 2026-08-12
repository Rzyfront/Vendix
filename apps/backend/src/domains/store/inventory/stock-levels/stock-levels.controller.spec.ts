import { Test, TestingModule } from '@nestjs/testing';
import { InventoryBatchesService } from '../batches/inventory-batches.service';
import { StockLevelsController } from './stock-levels.controller';
import { StockLevelsService } from './stock-levels.service';
import { ResponseService } from '@common/responses/response.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';

/**
 * CONTRATO DE ERROR — no revertir a `responseService.error`.
 *
 * `ResponseService.error()` RETORNA el sobre en vez de lanzarlo. Un controlador
 * que atrapa la excepción y llama a ese método responde HTTP 200/201 con
 * `success:false` en el cuerpo, y el frontend —que sólo mira el status— lo lee
 * como éxito: el usuario ve el toast de "guardado" de una operación que falló.
 *
 * Por eso los handlers de este controlador NO llevan try/catch: la excepción
 * sube al `AllExceptionsFilter`, que la traduce a status real + `error_code`
 * tipado. Los tests de error afirman esa propagación y que `responseService.error`
 * NO se invoca. Un test que espera un sobre con `success:false` está afirmando
 * el defecto, no el contrato.
 */
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
          provide: InventoryBatchesService,
          useValue: { getBatches: jest.fn().mockResolvedValue([]) },
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

    it('propaga el error al filtro global en vez de responder 200 con success:false', async () => {
      const query: StockLevelQueryDto = {};
      const error = new Error('Database error');

      stockLevelsService.findAll.mockRejectedValue(error);

      await expect(controller.findAll(query)).rejects.toThrow('Database error');
      expect(responseService.error).not.toHaveBeenCalled();
    });

    it('preserva el error original con su status en vez de aplanarlo a 400', async () => {
      const query: StockLevelQueryDto = {};
      const error = {
        message: 'Not found',
        response: { message: 'Stock level not found' },
        status: 404,
      };

      stockLevelsService.findAll.mockRejectedValue(error);

      await expect(controller.findAll(query)).rejects.toMatchObject({
        message: 'Not found',
        status: 404,
      });
      expect(responseService.error).not.toHaveBeenCalled();
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

    it('propaga el error al filtro global cuando el producto no existe', async () => {
      const productId = '999';
      const query: StockLevelQueryDto = {};
      const error = new Error('Product not found');

      stockLevelsService.findByProduct.mockRejectedValue(error);

      await expect(controller.findByProduct(productId, query)).rejects.toThrow(
        'Product not found',
      );
      expect(responseService.error).not.toHaveBeenCalled();
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

    it('propaga el error al filtro global cuando la ubicación no existe', async () => {
      const locationId = '999';
      const query: StockLevelQueryDto = {};
      const error = new Error('Location not found');

      stockLevelsService.findByLocation.mockRejectedValue(error);

      await expect(
        controller.findByLocation(locationId, query),
      ).rejects.toThrow('Location not found');
      expect(responseService.error).not.toHaveBeenCalled();
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

    it('propaga el error al filtro global cuando fallan las alertas', async () => {
      const query: StockLevelQueryDto = {};
      const error = new Error('Failed to get alerts');

      stockLevelsService.getStockAlerts.mockRejectedValue(error);

      await expect(controller.getStockAlerts(query)).rejects.toThrow(
        'Failed to get alerts',
      );
      expect(responseService.error).not.toHaveBeenCalled();
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

    it('propaga el error al filtro global cuando el nivel no existe', async () => {
      const id = '999';
      const error = new Error('Stock level not found');

      stockLevelsService.findOne.mockRejectedValue(error);

      await expect(controller.findOne(id)).rejects.toThrow(
        'Stock level not found',
      );
      expect(responseService.error).not.toHaveBeenCalled();
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
    it('propaga el error de id de producto inválido', async () => {
      const productId = 'invalid';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByProduct.mockRejectedValue(
        new Error('Invalid ID'),
      );

      await expect(controller.findByProduct(productId, query)).rejects.toThrow(
        'Invalid ID',
      );
      expect(responseService.error).not.toHaveBeenCalled();
    });

    it('propaga el error de id de ubicación inválido', async () => {
      const locationId = 'invalid';
      const query: StockLevelQueryDto = {};

      stockLevelsService.findByLocation.mockRejectedValue(
        new Error('Invalid ID'),
      );

      await expect(
        controller.findByLocation(locationId, query),
      ).rejects.toThrow('Invalid ID');
      expect(responseService.error).not.toHaveBeenCalled();
    });

    it('propaga el error de id inválido en findOne', async () => {
      const id = 'invalid';

      stockLevelsService.findOne.mockRejectedValue(new Error('Invalid ID'));

      await expect(controller.findOne(id)).rejects.toThrow('Invalid ID');
      expect(responseService.error).not.toHaveBeenCalled();
    });

    it('propaga el timeout del servicio en vez de disfrazarlo de 400', async () => {
      const query: StockLevelQueryDto = {};
      const timeoutError = new Error('Service timeout');

      stockLevelsService.findAll.mockRejectedValue(timeoutError);

      await expect(controller.findAll(query)).rejects.toThrow(
        'Service timeout',
      );
      expect(responseService.error).not.toHaveBeenCalled();
    });
  });
});
