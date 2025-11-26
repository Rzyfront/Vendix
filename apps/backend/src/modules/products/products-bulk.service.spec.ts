import { Test, TestingModule } from '@nestjs/testing';
import { ProductsBulkService } from './products-bulk.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from './products.service';
import { ProductVariantService } from './services/product-variant.service';
import { AccessValidationService } from '../../common/services/access-validation.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { BulkProductUploadDto, BulkProductItemDto, ProductState } from './dto';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

// Mock para slugify
jest.mock('slugify', () => ({
  default: jest
    .fn()
    .mockImplementation((text) => text.toLowerCase().replace(/\s+/g, '-')),
}));

describe('ProductsBulkService', () => {
  let service: ProductsBulkService;
  let prismaService: PrismaService;
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
          provide: PrismaService,
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
    prismaService = module.get<PrismaService>(PrismaService);
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
});
