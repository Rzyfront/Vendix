import { Test, TestingModule } from '@nestjs/testing';
import { ProductsBulkService } from './products-bulk.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { RequestContextService } from '@common/context/request-context.service';
import { BulkProductUploadDto, BulkProductItemDto, ProductState } from './dto';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';

// Mock para slugify
jest.mock('slugify', () => ({
  default: jest
    .fn()
    .mockImplementation((text) => text.toLowerCase().replace(/\s+/g, '-')),
}));

describe('ProductsBulkService', () => {
  let service: ProductsBulkService;
  let prismaService: StorePrismaService;
  let productsService: ProductsService;
  let variantService: ProductVariantService;
  let accessValidationService: AccessValidationService;
  let stockLevelManager: StockLevelManager;
  let locationsService: LocationsService;

  const mockPrismaService = {
    $transaction: jest.fn(),
    products: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    product_categories: {
      createMany: jest.fn(),
    },
    product_tax_assignments: {
      createMany: jest.fn(),
    },
    product_images: {
      createMany: jest.fn(),
    },
    stock_levels: {
      createMany: jest.fn(),
    },
    brands: {
      findFirst: jest.fn(),
    },
    categories: {
      findFirst: jest.fn(),
    },
    tax_categories: {
      findMany: jest.fn(),
    },
  };

  const mockProductsService = {
    create: jest.fn(),
    createVariant: jest.fn(),
  };

  const mockVariantService = {
    create: jest.fn(),
  };

  const mockAccessValidationService = {
    validateStoreAccess: jest.fn(),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn(),
    initializeStockLevelsForProduct: jest.fn(),
  };

  const mockLocationsService = {
    getDefaultLocation: jest.fn(),
  };

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
    store_id: 1,
    roles: ['admin'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsBulkService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
        {
          provide: ProductVariantService,
          useValue: mockVariantService,
        },
        {
          provide: AccessValidationService,
          useValue: mockAccessValidationService,
        },
        {
          provide: StockLevelManager,
          useValue: mockStockLevelManager,
        },
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
      ],
    }).compile();

    service = module.get<ProductsBulkService>(ProductsBulkService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    productsService = module.get<ProductsService>(ProductsService);
    variantService = module.get<ProductVariantService>(ProductVariantService);
    accessValidationService = module.get<AccessValidationService>(
      AccessValidationService,
    );
    stockLevelManager = module.get<StockLevelManager>(StockLevelManager);
    locationsService = module.get<LocationsService>(LocationsService);

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default context - mock the static method directly
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 1,
      store_id: 1,
      user_id: 1,
      is_super_admin: false,
      is_owner: true,
    });
  });

  describe('uploadProducts', () => {
    it('should process bulk upload successfully with all products', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            description: 'Test product 1',
            sku: 'PROD-001',
            stock_quantity: 10,
            category_ids: [1, 2],
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            description: 'Test product 2',
            sku: 'PROD-002',
            stock_quantity: 5,
            brand_id: 1,
          },
        ],
      };

      const createdProducts = [
        {
          id: 1,
          name: 'Product 1',
          slug: 'product-1',
          base_price: 99.99,
          state: ProductState.ACTIVE,
          stores: { id: 1, name: 'Test Store' },
        },
        {
          id: 2,
          name: 'Product 2',
          slug: 'product-2',
          base_price: 149.99,
          state: ProductState.ACTIVE,
          stores: { id: 1, name: 'Test Store' },
        },
      ];

      // Mock successful product creation
      mockProductsService.create
        .mockResolvedValueOnce(createdProducts[0])
        .mockResolvedValueOnce(createdProducts[1]);

      // Mock brand validation
      mockPrismaService.brands.findFirst.mockResolvedValue({
        id: 1,
        name: 'Test Brand',
        state: 'active',
      });

      // Mock category validation
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce({ id: 1, name: 'Category 1', state: 'active' })
        .mockResolvedValueOnce({ id: 2, name: 'Category 2', state: 'active' });

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result).toEqual({
        success: true,
        total_processed: 2,
        successful: 2,
        failed: 0,
        results: [
          {
            product: createdProducts[0],
            status: 'success',
            message: 'Product created successfully',
          },
          {
            product: createdProducts[1],
            status: 'success',
            message: 'Product created successfully',
          },
        ],
      });

      expect(mockProductsService.create).toHaveBeenCalledTimes(2);
      expect(
        mockAccessValidationService.validateStoreAccess,
      ).toHaveBeenCalledWith(1, mockUser);
    });

    it('should handle partial failures in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
          },
          {
            name: 'Product 2',
            base_price: 149.99,
            sku: 'PROD-001', // Duplicate SKU
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product 1',
        slug: 'product-1',
        base_price: 99.99,
        state: ProductState.ACTIVE,
        stores: { id: 1, name: 'Test Store' },
      };

      // First product succeeds, second fails due to duplicate SKU
      mockProductsService.create
        .mockResolvedValueOnce(createdProduct)
        .mockRejectedValueOnce(new ConflictException('El SKU ya está en uso'));

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result).toEqual({
        success: false,
        total_processed: 2,
        successful: 1,
        failed: 1,
        results: [
          {
            product: createdProduct,
            status: 'success',
            message: 'Product created successfully',
          },
          {
            product: null,
            status: 'error',
            message: 'El SKU ya está en uso',
            error: 'ConflictException',
          },
        ],
      });
    });

    it('should validate brand existence before processing', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
            brand_id: 999, // Non-existent brand
          },
        ],
      };

      // Mock brand not found
      mockPrismaService.brands.findFirst.mockResolvedValue(null);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].message).toContain('Brand not found');
      expect(result.failed).toBe(1);
    });

    it('should validate category existence before processing', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product 1',
            base_price: 99.99,
            sku: 'PROD-001',
            category_ids: [999], // Non-existent category
          },
        ],
      };

      // Mock category not found
      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('error');
      expect(result.results[0].message).toContain('Category not found');
      expect(result.failed).toBe(1);
    });

    it('should handle empty products array', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [],
      };

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result).toEqual({
        success: true,
        total_processed: 0,
        successful: 0,
        failed: 0,
        results: [],
      });
    });

    it('should respect maximum batch size limit', async () => {
      // Create a large batch that exceeds the limit
      const largeBatch = Array.from({ length: 101 }, (_, i) => ({
        name: `Product ${i + 1}`,
        base_price: 99.99,
        sku: `PROD-${i + 1}`,
      }));

      const bulkUploadDto: BulkProductUploadDto = {
        products: largeBatch,
      };

      await expect(
        service.uploadProducts(bulkUploadDto, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate slugs automatically when not provided', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Test Product Name',
            base_price: 99.99,
            sku: 'PROD-001',
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Test Product Name',
        slug: 'test-product-name',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      mockProductsService.create.mockResolvedValue(createdProduct);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].product.slug).toBe('test-product-name');
    });

    it('should handle products with variants in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product with Variants',
            base_price: 99.99,
            sku: 'PROD-VAR-001',
            variants: [
              {
                sku: 'VAR-001',
                name: 'Variant 1',
                price_override: 109.99,
                stock_quantity: 10,
              },
              {
                sku: 'VAR-002',
                name: 'Variant 2',
                price_override: 119.99,
                stock_quantity: 5,
              },
            ],
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product with Variants',
        slug: 'product-with-variants',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      const createdVariants = [
        { id: 1, sku: 'VAR-001', product_id: 1 },
        { id: 2, sku: 'VAR-002', product_id: 1 },
      ];

      mockProductsService.create.mockResolvedValue(createdProduct);
      mockProductsService.createVariant
        .mockResolvedValueOnce(createdVariants[0])
        .mockResolvedValueOnce(createdVariants[1]);

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('success');
      expect(mockProductsService.createVariant).toHaveBeenCalledTimes(2);
    });

    it('should handle stock by location in bulk upload', async () => {
      const bulkUploadDto: BulkProductUploadDto = {
        products: [
          {
            name: 'Product with Location Stock',
            base_price: 99.99,
            sku: 'PROD-LOC-001',
            stock_by_location: [
              {
                location_id: 1,
                quantity: 20,
                notes: 'Main warehouse',
              },
              {
                location_id: 2,
                quantity: 10,
                notes: 'Secondary warehouse',
              },
            ],
          },
        ],
      };

      const createdProduct = {
        id: 1,
        name: 'Product with Location Stock',
        slug: 'product-with-location-stock',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      mockProductsService.create.mockResolvedValue(createdProduct);
      mockLocationsService.getDefaultLocation.mockResolvedValue({
        id: 1,
        name: 'Default Location',
      });

      const result = await service.uploadProducts(bulkUploadDto, mockUser);

      expect(result.results[0].status).toBe('success');
      expect(mockStockLevelManager.updateStock).toHaveBeenCalled();
    });
  });

  describe('validateBulkProducts', () => {
    it('should validate all products successfully', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Valid Product 1',
          base_price: 99.99,
          sku: 'PROD-001',
        },
        {
          name: 'Valid Product 2',
          base_price: 149.99,
          sku: 'PROD-002',
        },
      ];

      // Mock no existing SKUs
      mockPrismaService.products.findFirst.mockResolvedValue(null);

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.validProducts).toHaveLength(2);
    });

    it('should detect duplicate SKUs in validation', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: 99.99,
          sku: 'PROD-001',
        },
        {
          name: 'Product 2',
          base_price: 149.99,
          sku: 'PROD-001', // Duplicate SKU
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Duplicate SKU found');
    });

    it('should detect existing SKUs in database', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: 99.99,
          sku: 'EXISTING-SKU',
        },
      ];

      // Mock existing product with same SKU
      mockPrismaService.products.findFirst.mockResolvedValue({
        id: 1,
        name: 'Existing Product',
        sku: 'EXISTING-SKU',
      });

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('SKU already exists');
    });

    it('should validate required fields', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: '', // Empty name
          base_price: 99.99,
          sku: 'PROD-001',
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Product name is required');
    });

    it('should validate price constraints', async () => {
      const products: BulkProductItemDto[] = [
        {
          name: 'Product 1',
          base_price: -10, // Negative price
          sku: 'PROD-001',
        },
      ];

      const result = await service.validateBulkProducts(products, mockUser);

      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('Base price must be positive');
    });
  });

  describe('getBulkUploadTemplate', () => {
    it('should return CSV template structure', async () => {
      const result = await service.getBulkUploadTemplate();

      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('sample_data');
      expect(result).toHaveProperty('instructions');
      expect(result.headers).toContain('name');
      expect(result.headers).toContain('base_price');
      expect(result.headers).toContain('sku');
    });

    it('should include all required and optional fields in template', async () => {
      const result = await service.getBulkUploadTemplate();

      const expectedFields = [
        'name',
        'base_price',
        'sku',
        'description',
        'brand_id',
        'category_ids',
        'stock_quantity',
        'cost_price',
        'weight',
      ];

      expectedFields.forEach((field) => {
        expect(result.headers).toContain(field);
      });
    });
  });

  describe('exportCurrentProductsAsTemplate', () => {
    it('should scope the query by store_id', async () => {
      mockPrismaService.products.findMany.mockResolvedValueOnce([]);
      await service.exportCurrentProductsAsTemplate();

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: expect.anything(),
          }),
        }),
      );
    });

    it('should throw NotFoundException with a clear message when no products exist', async () => {
      mockPrismaService.products.count.mockResolvedValueOnce(0);

      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        /No hay productos para exportar/,
      );
    });

    it('should not call findMany when no products exist', async () => {
      mockPrismaService.products.count.mockResolvedValueOnce(0);
      mockPrismaService.products.findMany.mockClear();

      try {
        await service.exportCurrentProductsAsTemplate();
      } catch {
        // expected
      }

      expect(mockPrismaService.products.findMany).not.toHaveBeenCalled();
    });

    // Regla de negocio: los productos archivados NUNCA deben salir en la
    // descarga del template (mismo criterio que la UI usa para ocultarlos
    // en el listado de productos). Verificamos que tanto el count() previo
    // como el findMany() del chunk paginado filtren por `state: { not:
    // ProductState.ARCHIVED }`. Si esto se rompe, el usuario descarga 120+
    // productos "viejos" que aparecen como si estuvieran activos.
    it('should exclude archived products from both count() and findMany()', async () => {
      // Simular que hay productos no-archivados (count > 0) para que sí se
      // llegue a llamar findMany. Devolver [] corta el loop inmediatamente.
      mockPrismaService.products.count.mockResolvedValueOnce(5);
      mockPrismaService.products.findMany.mockResolvedValueOnce([]);

      try {
        await service.exportCurrentProductsAsTemplate();
      } catch {
        // Puede lanzar NotFoundException porque rows queda vacío; no nos
        // importa acá — lo que validamos son las llamadas a Prisma.
      }

      const expectedArchiveFilter = {
        state: { not: ProductState.ARCHIVED },
      };

      expect(mockPrismaService.products.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(expectedArchiveFilter),
        }),
      );
      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining(expectedArchiveFilter),
        }),
      );
    });

    // Regression: previously when count() failed (e.g. schema drift in prod),
    // the service silently set productCount=0 and threw NotFoundException
    // with 'No hay productos en su tienda' — misleading the user into
    // thinking they had no products. The fix differentiates the two cases.
    it('should throw InternalServerErrorException (not NotFoundException) when count() fails', async () => {
      mockPrismaService.products.count.mockReset();
      mockPrismaService.products.count.mockRejectedValueOnce(
        new Error('relation "products" does not exist'),
      );

      await expect(service.exportCurrentProductsAsTemplate()).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.exportCurrentProductsAsTemplate()).rejects.not.toThrow(
        NotFoundException,
      );
    });

    it('should retry findMany with minimal query when the rich include fails (schema drift fallback)', async () => {
      // First chunk: rich include fails -> fallback to minimal
      mockPrismaService.products.findMany
        .mockRejectedValueOnce(new Error('relation "stock_levels" does not exist'))
        .mockResolvedValueOnce([
          {
            id: 1,
            name: 'Drifted product',
            sku: 'DRF-1',
            product_type: 'physical',
            state: 'active',
            track_inventory: true,
            base_price: 10,
            description: '',
            product_tax_assignments: [],
            pricing_type: 'unit',
            available_for_ecommerce: false,
            is_featured: false,
            allow_pos_price_override: false,
            has_multiple_price_tiers: false,
            is_on_sale: false,
            sale_price: 0,
            cost_price: 0,
          },
        ]);

      const buffer = await service.exportCurrentProductsAsTemplate();
      expect(buffer).toBeInstanceOf(Buffer);

      // Should have called findMany twice: once rich (failed), once minimal (succeeded)
      expect(mockPrismaService.products.findMany).toHaveBeenCalledTimes(2);

      // Second call must NOT include the rich include (fallback path).
      const fallbackCall =
        mockPrismaService.products.findMany.mock.calls[1][0];
      expect(fallbackCall.include).toBeUndefined();
    });
  });
});
