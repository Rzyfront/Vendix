import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductImageDto,
  ProductQueryDto,
  ProductState,
  CreateProductWithVariantsDto,
  StockByLocationDto,
} from './dto';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';

describe('ProductsController', () => {
  let controller: ProductsController;
  let service: ProductsService;
  let responseService: ResponseService;

  const mockProductsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    getProductsByStore: jest.fn(),
    findBySlug: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    remove: jest.fn(),
    createVariant: jest.fn(),
    updateVariant: jest.fn(),
    removeVariant: jest.fn(),
    addImage: jest.fn(),
    removeImage: jest.fn(),
    getProductStats: jest.fn(),
  };

  const mockResponseService = {
    created: jest.fn(),
    success: jest.fn(),
    paginated: jest.fn(),
    updated: jest.fn(),
    deleted: jest.fn(),
    error: jest.fn(),
  };

  const mockRequest = {
    user: {
      id: 1,
      email: 'test@example.com',
      organization_id: 1,
      store_id: 1,
    },
  } as AuthenticatedRequest;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
        {
          provide: ResponseService,
          useValue: mockResponseService,
        },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProductsController>(ProductsController);
    service = module.get<ProductsService>(ProductsService);
    responseService = module.get<ResponseService>(ResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('CREATE PRODUCT', () => {
    const createProductDto: CreateProductDto = {
      name: 'Test Product',
      base_price: 99.99,
      sku: 'TEST-001',
      description: 'Test product description',
    };

    it('should create a product successfully', async () => {
      const expectedProduct = {
        id: 1,
        ...createProductDto,
        state: ProductState.ACTIVE,
        created_at: new Date(),
      };

      mockProductsService.create.mockResolvedValue(expectedProduct);
      mockResponseService.created.mockReturnValue({
        success: true,
        data: expectedProduct,
        message: 'Producto creado exitosamente',
      });

      const result = await controller.create(createProductDto, mockRequest);

      expect(service.create).toHaveBeenCalledWith(createProductDto);
      expect(responseService.created).toHaveBeenCalledWith(
        expectedProduct,
        'Producto creado exitosamente',
      );
      expect(result).toEqual({
        success: true,
        data: expectedProduct,
        message: 'Producto creado exitosamente',
      });
    });

    it('should handle validation errors', async () => {
      const invalidDto = {
        name: 'A', // Too short
        base_price: -10, // Negative price
      };

      mockProductsService.create.mockRejectedValue(
        new Error('Validation failed'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Validation failed',
      });

      const result = await controller.create(invalidDto, mockRequest);

      expect(responseService.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('GET ALL PRODUCTS', () => {
    const query: ProductQueryDto = {
      page: 1,
      limit: 10,
      search: 'test',
    };

    it('should return paginated products', async () => {
      const mockResponse = {
        data: [
          {
            id: 1,
            name: 'Test Product 1',
            base_price: 99.99,
            state: ProductState.ACTIVE,
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
        },
      };

      mockProductsService.findAll.mockResolvedValue(mockResponse);
      mockResponseService.paginated.mockReturnValue({
        success: true,
        data: mockResponse.data,
        meta: mockResponse.meta,
      });

      const result = await controller.findAll(query, mockRequest);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(responseService.paginated).toHaveBeenCalledWith(
        mockResponse.data,
        1,
        1,
        10,
        'Productos obtenidos exitosamente',
      );
    });

    it('should handle search and filtering', async () => {
      const searchQuery: ProductQueryDto = {
        search: 'laptop',
        category_id: 1,
        state: ProductState.ACTIVE,
        pos_optimized: true,
      };

      mockProductsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll(searchQuery, mockRequest);

      expect(service.findAll).toHaveBeenCalledWith(searchQuery);
    });
  });

  describe('GET PRODUCT BY ID', () => {
    it('should return a product by ID', async () => {
      const expectedProduct = {
        id: 1,
        name: 'Test Product',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      mockProductsService.findOne.mockResolvedValue(expectedProduct);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedProduct,
      });

      const result = await controller.findOne(1);

      expect(service.findOne).toHaveBeenCalledWith(1);
      expect(responseService.success).toHaveBeenCalledWith(
        expectedProduct,
        'Producto obtenido exitosamente',
      );
    });

    it('should handle product not found', async () => {
      mockProductsService.findOne.mockRejectedValue(
        new Error('Product not found'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Product not found',
      });

      const result = await controller.findOne(999);

      expect(responseService.error).toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  describe('UPDATE PRODUCT', () => {
    const updateDto: UpdateProductDto = {
      name: 'Updated Product',
      base_price: 149.99,
    };

    it('should update a product successfully', async () => {
      const updatedProduct = {
        id: 1,
        ...updateDto,
        state: ProductState.ACTIVE,
      };

      mockProductsService.update.mockResolvedValue(updatedProduct);
      mockResponseService.updated.mockReturnValue({
        success: true,
        data: updatedProduct,
      });

      const result = await controller.update(1, updateDto);

      expect(service.update).toHaveBeenCalledWith(1, updateDto);
      expect(responseService.updated).toHaveBeenCalledWith(
        updatedProduct,
        'Producto actualizado exitosamente',
      );
    });
  });

  describe('DEACTIVATE PRODUCT', () => {
    it('should deactivate a product successfully', async () => {
      mockProductsService.deactivate.mockResolvedValue(undefined);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: null,
      });

      const result = await controller.deactivate(1);

      expect(service.deactivate).toHaveBeenCalledWith(1);
      expect(responseService.success).toHaveBeenCalledWith(
        null,
        'Producto desactivado exitosamente',
      );
    });
  });

  describe('DELETE PRODUCT', () => {
    it('should delete a product successfully (admin only)', async () => {
      mockProductsService.remove.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue({
        success: true,
        message: 'Producto eliminado exitosamente',
      });

      const result = await controller.remove(1);

      expect(service.remove).toHaveBeenCalledWith(1);
      expect(responseService.deleted).toHaveBeenCalledWith(
        'Producto eliminado exitosamente',
      );
    });
  });

  describe('PRODUCT VARIANTS', () => {
    const createVariantDto: CreateProductVariantDto = {
      sku: 'TEST-VAR-001',
      name: 'Test Variant',
      price_override: 109.99,
      stock_quantity: 50,
      attributes: { color: 'red', size: 'L' },
    };

    it('should create a product variant', async () => {
      const expectedVariant = {
        id: 1,
        product_id: 1,
        ...createVariantDto,
      };

      mockProductsService.createVariant.mockResolvedValue(expectedVariant);
      mockResponseService.created.mockReturnValue({
        success: true,
        data: expectedVariant,
      });

      const result = await controller.createVariant(1, createVariantDto);

      expect(service.createVariant).toHaveBeenCalledWith(1, createVariantDto);
      expect(responseService.created).toHaveBeenCalledWith(
        expectedVariant,
        'Variante de producto creada exitosamente',
      );
    });

    it('should update a product variant', async () => {
      const updateVariantDto: UpdateProductVariantDto = {
        price_override: 119.99,
        stock_quantity: 45,
      };

      const updatedVariant = {
        id: 1,
        ...updateVariantDto,
      };

      mockProductsService.updateVariant.mockResolvedValue(updatedVariant);
      mockResponseService.updated.mockReturnValue({
        success: true,
        data: updatedVariant,
      });

      const result = await controller.updateVariant(1, updateVariantDto);

      expect(service.updateVariant).toHaveBeenCalledWith(1, updateVariantDto);
    });

    it('should delete a product variant', async () => {
      mockProductsService.removeVariant.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue({
        success: true,
        message: 'Variante de producto eliminada exitosamente',
      });

      const result = await controller.removeVariant(1);

      expect(service.removeVariant).toHaveBeenCalledWith(1);
    });
  });

  describe('PRODUCT IMAGES', () => {
    const imageDto: ProductImageDto = {
      image_url: 'https://example.com/image.jpg',
      is_main: true,
      alt_text: 'Product image',
    };

    it('should add an image to product', async () => {
      const expectedImage = {
        id: 1,
        product_id: 1,
        ...imageDto,
      };

      mockProductsService.addImage.mockResolvedValue(expectedImage);
      mockResponseService.created.mockReturnValue({
        success: true,
        data: expectedImage,
      });

      const result = await controller.addImage(1, imageDto);

      expect(service.addImage).toHaveBeenCalledWith(1, imageDto);
      expect(responseService.created).toHaveBeenCalledWith(
        expectedImage,
        'Imagen de producto agregada exitosamente',
      );
    });

    it('should remove an image from product', async () => {
      mockProductsService.removeImage.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue({
        success: true,
        message: 'Imagen de producto eliminada exitosamente',
      });

      const result = await controller.removeImage(1);

      expect(service.removeImage).toHaveBeenCalledWith(1);
    });
  });

  describe('PRODUCT STATS', () => {
    it('should get product statistics for store', async () => {
      const expectedStats = {
        total_products: 100,
        active_products: 85,
        inactive_products: 10,
        archived_products: 5,
        low_stock_products: 8,
      };

      mockProductsService.getProductStats.mockResolvedValue(expectedStats);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedStats,
      });

      const result = await controller.getProductStats(1);

      expect(service.getProductStats).toHaveBeenCalledWith(1);
      expect(responseService.success).toHaveBeenCalledWith(
        expectedStats,
        'Estadísticas de productos obtenidas exitosamente',
      );
    });
  });

  describe('ERROR HANDLING', () => {
    it('should handle service errors consistently', async () => {
      const error = new Error('Database error');
      mockProductsService.findAll.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Database error',
      });

      const result = await controller.findAll({}, mockRequest);

      expect(responseService.error).toHaveBeenCalledWith(
        'Database error',
        'Database error',
        400,
      );
    });

    it('should handle permission errors', async () => {
      const permissionError = {
        message: 'Insufficient permissions',
        status: 403,
      };

      mockProductsService.create.mockRejectedValue(permissionError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Insufficient permissions',
      });

      const result = await controller.create(
        {} as CreateProductDto,
        mockRequest,
      );

      expect(responseService.error).toHaveBeenCalledWith(
        'Insufficient permissions',
        'Insufficient permissions',
        403,
      );
    });
  });

  describe('ADVANCED PRODUCT FLOWS', () => {
    it('should handle complex product creation with stock locations', async () => {
      const complexProductDto: CreateProductDto = {
        name: 'Complex Product',
        base_price: 199.99,
        sku: 'COMPLEX-001',
        stock_by_location: [
          {
            location_id: 1,
            quantity: 50,
            notes: 'Main warehouse',
          },
          {
            location_id: 2,
            quantity: 25,
            notes: 'Secondary warehouse',
          },
        ],
        track_inventory: true,
        min_stock_level: 10,
        max_stock_level: 200,
        reorder_point: 15,
        reorder_quantity: 50,
      };

      const expectedProduct = {
        id: 1,
        ...complexProductDto,
        state: ProductState.ACTIVE,
      };

      mockProductsService.create.mockResolvedValue(expectedProduct);

      await controller.create(complexProductDto, mockRequest);

      expect(service.create).toHaveBeenCalledWith(complexProductDto);
    });

    it('should handle product filtering by multiple criteria', async () => {
      const complexQuery: ProductQueryDto = {
        page: 1,
        limit: 20,
        search: 'smartphone',
        state: ProductState.ACTIVE,
        category_id: 1,
        brand_id: 2,
        include_inactive: false,
        pos_optimized: true,
        barcode: '1234567890',
        include_stock: true,
        include_variants: true,
      };

      mockProductsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      });

      await controller.findAll(complexQuery, mockRequest);

      expect(service.findAll).toHaveBeenCalledWith(complexQuery);
    });
  });
});
