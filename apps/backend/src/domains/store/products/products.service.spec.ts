import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductVariantService } from './services/product-variant.service';
import { RequestContextService } from '@common/context/request-context.service';
import { InventoryIntegrationService } from '../inventory/shared/services/inventory-integration.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { S3Service } from '@common/services/s3.service';
import { QrService } from '@common/services/qr.service';
import { RemoteImageService } from '@common/services/remote-image.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductImageDto,
  ProductQueryDto,
  ProductState,
  StockByLocationDto,
} from './dto';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

describe('ProductsService', () => {
  let service: ProductsService;
  let prismaService: StorePrismaService;
  let variantService: ProductVariantService;

  const mockPrismaService = {
    products: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product_variants: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    product_images: {
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    product_categories: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    product_tax_assignments: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    stock_levels: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    inventory_locations: {
      findMany: jest.fn(),
    },
    categories: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    brands: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    tax_categories: {
      findMany: jest.fn(),
    },
    domain_settings: {
      findFirst: jest.fn(),
    },
    store_settings: {
      findFirst: jest.fn(),
    },
    stores: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockVariantService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findByProductId: jest.fn(),
    checkSkuAvailability: jest.fn(),
  };

  const mockInventoryIntegrationService = {
    // Add any methods used by ProductsService
  };

  const mockLocationsService = {
    getDefaultLocation: jest.fn(),
  };

  const mockStockLevelManager = {
    updateStock: jest.fn(),
    initializeStockLevelsForProduct: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockS3Service = {
    signUrl: jest.fn((url) => Promise.resolve(url)),
    getPresignedUrl: jest.fn((url) => Promise.resolve(url)),
    uploadBase64: jest.fn(),
    deleteFile: jest.fn(),
  };

  const mockQrService = {
    generateDataUrl: jest.fn((content) =>
      Promise.resolve(
        `data:image/png;base64,${Buffer.from(content).toString('base64')}`,
      ),
    ),
  };

  const mockRemoteImageService = {
    fetchPreview: jest.fn(),
  };

  const mockS3PathHelper = {
    buildProductPath: jest.fn(
      () => 'organizations/org-1/stores/store-1/products',
    ),
  };

  const mockAIEngineService = {
    run: jest.fn(),
  };

  const mockPromotionEngineService = {
    findActiveAutoPromotionsForProducts: jest.fn().mockResolvedValue(new Map()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ProductVariantService,
          useValue: mockVariantService,
        },
        {
          provide: RequestContextService,
          useValue: {
            getContext: jest.fn().mockReturnValue({
              organization_id: 1,
              store_id: 1,
              user_id: 1,
              is_super_admin: false,
              is_owner: true,
            }),
          },
        },
        {
          provide: InventoryIntegrationService,
          useValue: mockInventoryIntegrationService,
        },
        {
          provide: LocationsService,
          useValue: mockLocationsService,
        },
        {
          provide: StockLevelManager,
          useValue: mockStockLevelManager,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: QrService,
          useValue: mockQrService,
        },
        {
          provide: RemoteImageService,
          useValue: mockRemoteImageService,
        },
        {
          provide: S3PathHelper,
          useValue: mockS3PathHelper,
        },
        {
          provide: AIEngineService,
          useValue: mockAIEngineService,
        },
        {
          provide: PromotionEngineService,
          useValue: mockPromotionEngineService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    variantService = module.get<ProductVariantService>(ProductVariantService);
    mockPrismaService.store_settings.findFirst.mockResolvedValue({
      settings: { inventory: { low_stock_threshold: 10 } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createProductDto: CreateProductDto = {
      name: 'Test Product',
      base_price: 99.99,
      sku: 'TEST-001',
      description: 'Test product description',
      store_id: 1,
    };

    it('should create a product successfully', async () => {
      const expectedProduct = {
        id: 1,
        ...createProductDto,
        state: ProductState.ACTIVE,
        slug: 'test-product',
        created_at: new Date(),
        updated_at: new Date(),
        stores: {
          id: 1,
          name: 'Test Store',
          slug: 'test-store',
          organization_id: 1,
        },
        brands: null,
        product_categories: [],
        product_tax_assignments: [],
        product_images: [],
        product_variants: [],
        reviews: [],
        stock_levels: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
        stock_quantity: 0,
        total_stock_available: 0,
        total_stock_reserved: 0,
        stock_by_location: [],
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      const result = await service.create(createProductDto);

      expect(result).toBeDefined();
      expect(mockPrismaService.products.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: createProductDto.name,
          base_price: createProductDto.base_price,
          sku: createProductDto.sku,
          description: createProductDto.description,
          store_id: createProductDto.store_id,
          state: ProductState.ACTIVE,
        }),
      });
    });

    it('should generate slug automatically if not provided', async () => {
      const productWithoutSlug = {
        ...createProductDto,
      };

      delete productWithoutSlug.sku;

      const expectedProduct = {
        id: 1,
        ...productWithoutSlug,
        state: ProductState.ACTIVE,
        slug: 'test-product',
        stores: {
          id: 1,
          name: 'Test Store',
          slug: 'test-store',
          organization_id: 1,
        },
        brands: null,
        product_categories: [],
        product_tax_assignments: [],
        product_images: [],
        product_variants: [],
        reviews: [],
        stock_levels: [],
        _count: { product_variants: 0, product_images: 0, reviews: 0 },
        stock_quantity: 0,
        total_stock_available: 0,
        total_stock_reserved: 0,
        stock_by_location: [],
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      const result: any = await service.create(productWithoutSlug);

      expect(result).toBeDefined();
      expect(result.slug).toBeDefined();
    });

    it('should throw error if SKU already exists', async () => {
      mockPrismaService.products.findFirst.mockResolvedValue({ id: 1 });
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await expect(service.create(createProductDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should handle product with categories and tax assignments', async () => {
      const productWithCategories: CreateProductDto = {
        ...createProductDto,
        category_ids: [1, 2],
        tax_category_ids: [3, 4],
      };

      const expectedProduct = {
        id: 1,
        ...productWithCategories,
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.create(productWithCategories);

      expect(
        mockPrismaService.product_categories.createMany,
      ).toHaveBeenCalledWith({
        data: [
          { category_id: 1, product_id: 1 },
          { category_id: 2, product_id: 1 },
        ],
      });

      expect(
        mockPrismaService.product_tax_assignments.createMany,
      ).toHaveBeenCalledWith({
        data: [
          { tax_category_id: 3, product_id: 1 },
          { tax_category_id: 4, product_id: 1 },
        ],
      });
    });
  });

  describe('findAll', () => {
    const query: ProductQueryDto = {
      page: 1,
      limit: 10,
      search: 'test',
    };

    it('should return paginated products', async () => {
      const mockProducts = [
        {
          id: 1,
          name: 'Test Product 1',
          base_price: 99.99,
          state: ProductState.ACTIVE,
        },
        {
          id: 2,
          name: 'Test Product 2',
          base_price: 149.99,
          state: ProductState.ACTIVE,
        },
      ];

      mockPrismaService.products.findMany.mockResolvedValue(mockProducts);
      mockPrismaService.products.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      expect(result.data).toEqual(mockProducts);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    it('should apply search filter correctly', async () => {
      const searchQuery: ProductQueryDto = {
        search: 'laptop',
        page: 1,
        limit: 10,
      };

      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(searchQuery);

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: [
            { name: { contains: 'laptop', mode: 'insensitive' } },
            { description: { contains: 'laptop', mode: 'insensitive' } },
            { sku: { contains: 'laptop', mode: 'insensitive' } },
          ],
        }),
        include: expect.any(Object),
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });

    it('should include variants when requested', async () => {
      const variantsQuery: ProductQueryDto = {
        include_variants: true,
        page: 1,
        limit: 10,
      };

      const mockProduct = {
        id: 1,
        name: 'Test Product',
        variants: [
          { id: 1, sku: 'VAR-001', price_override: 109.99 },
          { id: 2, sku: 'VAR-002', price_override: 119.99 },
        ],
      };

      mockPrismaService.products.findMany.mockResolvedValue([mockProduct]);
      mockPrismaService.products.count.mockResolvedValue(1);

      const result = await service.findAll(variantsQuery);

      expect(result.data[0].variants).toBeDefined();
      expect(result.data[0].variants).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should return a product by ID', async () => {
      const expectedProduct = {
        id: 1,
        name: 'Test Product',
        base_price: 99.99,
        state: ProductState.ACTIVE,
        variants: [],
        images: [],
        categories: [],
      };

      mockPrismaService.products.findUnique.mockResolvedValue(expectedProduct);

      const result = await service.findOne(1);

      expect(result).toEqual(expectedProduct);
      expect(mockPrismaService.products.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: expect.any(Object),
      });
    });

    it('should throw NotFoundException if product not found', async () => {
      mockPrismaService.products.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    const updateDto: UpdateProductDto = {
      name: 'Updated Product',
      base_price: 149.99,
    };

    it('should update a product successfully', async () => {
      const existingProduct = {
        id: 1,
        name: 'Original Product',
        base_price: 99.99,
        state: ProductState.ACTIVE,
      };

      const updatedProduct = {
        ...existingProduct,
        ...updateDto,
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.products.update.mockResolvedValue(updatedProduct);

      const result = await service.update(1, updateDto);

      expect(result).toEqual(updatedProduct);
      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          name: updateDto.name,
          base_price: updateDto.base_price,
        }),
      });
    });

    it('should throw NotFoundException if product to update not found', async () => {
      mockPrismaService.products.findUnique.mockResolvedValue(null);

      await expect(service.update(999, updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should handle slug changes', async () => {
      const updateWithSlug: UpdateProductDto = {
        name: 'New Product Name',
        slug: 'new-product-slug',
      };

      const existingProduct = {
        id: 1,
        name: 'Original Product',
        slug: 'original-product',
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.findUnique
        .mockResolvedValueOnce(existingProduct)
        .mockResolvedValueOnce(null); // Slug uniqueness check
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.update(1, updateWithSlug);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          slug: 'new-product-slug',
        }),
      });
    });
  });

  describe('deactivate', () => {
    it('should deactivate a product successfully', async () => {
      const existingProduct = {
        id: 1,
        name: 'Test Product',
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.products.update.mockResolvedValue({
        ...existingProduct,
        state: ProductState.INACTIVE,
      });

      await service.deactivate(1);

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { state: ProductState.INACTIVE },
      });
    });

    it('should throw NotFoundException if product not found', async () => {
      mockPrismaService.products.findUnique.mockResolvedValue(null);

      await expect(service.deactivate(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete a product successfully (hard delete)', async () => {
      const existingProduct = {
        id: 1,
        name: 'Test Product',
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.remove(1);

      expect(mockPrismaService.products.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundException if product to delete not found', async () => {
      mockPrismaService.products.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('VARIANTS OPERATIONS', () => {
    const createVariantDto: CreateProductVariantDto = {
      sku: 'TEST-VAR-001',
      name: 'Test Variant',
      price_override: 109.99,
      stock_quantity: 50,
      attributes: { color: 'red', size: 'L' },
    };

    it('should create a variant for a product', async () => {
      const expectedVariant = {
        id: 1,
        product_id: 1,
        ...createVariantDto,
      };

      const existingProduct = {
        id: 1,
        name: 'Test Product',
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.product_variants.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.product_variants.create.mockResolvedValue(
        expectedVariant,
      );

      const result = await service.createVariant(1, createVariantDto);

      expect(result).toEqual(expectedVariant);
      expect(mockPrismaService.product_variants.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException if product not found when creating variant', async () => {
      mockPrismaService.products.findUnique.mockResolvedValue(null);

      await expect(
        service.createVariant(999, createVariantDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update a variant', async () => {
      const updateVariantDto: UpdateProductVariantDto = {
        price_override: 119.99,
        stock_quantity: 45,
      };

      const existingVariant = {
        id: 1,
        sku: 'TEST-VAR-001',
        price_override: 109.99,
        stock_quantity: 50,
      };

      const updatedVariant = {
        ...existingVariant,
        ...updateVariantDto,
      };

      mockPrismaService.product_variants.findUnique.mockResolvedValue(
        existingVariant,
      );
      mockPrismaService.product_variants.update.mockResolvedValue(
        updatedVariant,
      );

      const result = await service.updateVariant(1, updateVariantDto);

      expect(result).toEqual(updatedVariant);
      expect(mockPrismaService.product_variants.update).toHaveBeenCalled();
    });

    it('should remove a variant', async () => {
      const existingVariant = {
        id: 1,
        sku: 'TEST-VAR-001',
      };

      mockPrismaService.product_variants.findUnique.mockResolvedValue(
        existingVariant,
      );
      mockPrismaService.product_variants.delete.mockResolvedValue(
        existingVariant,
      );

      await service.removeVariant(1);

      expect(mockPrismaService.product_variants.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
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

      const existingProduct = {
        id: 1,
        name: 'Test Product',
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.product_images.create.mockResolvedValue(expectedImage);

      const result = await service.addImage(1, imageDto);

      expect(result).toEqual(expectedImage);
      expect(mockPrismaService.product_images.create).toHaveBeenCalledWith({
        data: {
          product_id: 1,
          image_url: imageDto.image_url,
          is_main: imageDto.is_main,
          alt_text: imageDto.alt_text,
          sort_order: 0,
        },
      });
    });

    it('should set image as main if is_main is true', async () => {
      const imageDtoWithMain: ProductImageDto = {
        image_url: 'https://example.com/image.jpg',
        is_main: true,
      };

      const existingProduct = {
        id: 1,
        name: 'Test Product',
      };

      mockPrismaService.products.findUnique.mockResolvedValue(existingProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });
      mockPrismaService.product_images.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.product_images.create.mockResolvedValue({
        id: 1,
        ...imageDtoWithMain,
      });

      await service.addImage(1, imageDtoWithMain);

      expect(mockPrismaService.product_images.updateMany).toHaveBeenCalledWith({
        where: { product_id: 1 },
        data: { is_main: false },
      });
    });
  });

  describe('getProductStats', () => {
    it('should return product statistics for store', async () => {
      const expectedStats = {
        total_products: 3,
        active_products: 2,
        inactive_products: 1,
        archived_products: 1,
        low_stock_products: 3,
        out_of_stock_products: 1,
        products_without_images: 3,
        total_value: 500,
        categories_count: 2,
        brands_count: 1,
      };

      mockPrismaService.products.findMany.mockResolvedValue([
        {
          state: ProductState.ACTIVE,
          stock_quantity: 2,
          base_price: 100,
          product_images: [],
        },
        {
          state: ProductState.ACTIVE,
          stock_quantity: 0,
          base_price: 100,
          product_images: [{ id: 1 }],
        },
        {
          state: ProductState.INACTIVE,
          stock_quantity: 5,
          base_price: 20,
          product_images: [],
        },
        {
          state: ProductState.ARCHIVED,
          stock_quantity: 10,
          base_price: 20,
          product_images: [],
        },
      ]);
      mockPrismaService.categories.count.mockResolvedValue(2);
      mockPrismaService.brands.count.mockResolvedValue(1);

      const result = await service.getProductStats(1);

      expect(result).toEqual(expectedStats);
    });

    it('should use store low stock threshold when product threshold is not set', async () => {
      mockPrismaService.store_settings.findFirst.mockResolvedValue({
        settings: { inventory: { low_stock_threshold: 8 } },
      });
      mockPrismaService.products.findMany.mockResolvedValue([
        {
          state: ProductState.ACTIVE,
          stock_quantity: 8,
          min_stock_level: 0,
          reorder_point: 0,
          base_price: 10,
          product_images: [],
        },
        {
          state: ProductState.ACTIVE,
          stock_quantity: 9,
          min_stock_level: 0,
          reorder_point: 0,
          base_price: 10,
          product_images: [],
        },
      ]);
      mockPrismaService.categories.count.mockResolvedValue(0);
      mockPrismaService.brands.count.mockResolvedValue(0);

      const result = await service.getProductStats(1);

      expect(result.low_stock_products).toBe(1);
    });
  });

  describe('ADVANCED SCENARIOS', () => {
    it('should handle product creation with multiple stock locations', async () => {
      const productWithStock: CreateProductDto = {
        name: 'Product with Stock',
        base_price: 199.99,
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
      };

      const expectedProduct = {
        id: 1,
        ...productWithStock,
        state: ProductState.ACTIVE,
      };

      mockPrismaService.products.create.mockResolvedValue(expectedProduct);
      mockPrismaService.$transaction.mockImplementation((callback) => {
        return callback(mockPrismaService);
      });

      await service.create(productWithStock);

      expect(mockPrismaService.stock_levels.createMany).toHaveBeenCalledWith({
        data: [
          { location_id: 1, quantity: 50, product_id: 1 },
          { location_id: 2, quantity: 25, product_id: 1 },
        ],
      });
    });

    it('should handle complex filtering with multiple criteria', async () => {
      const complexQuery: ProductQueryDto = {
        search: 'smartphone',
        category_id: 1,
        brand_id: 2,
        state: ProductState.ACTIVE,
        pos_optimized: true,
        include_variants: true,
        include_stock: true,
      };

      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(complexQuery);

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          AND: [
            {
              OR: [
                { name: { contains: 'smartphone', mode: 'insensitive' } },
                {
                  description: { contains: 'smartphone', mode: 'insensitive' },
                },
                { sku: { contains: 'smartphone', mode: 'insensitive' } },
              ],
            },
            { state: ProductState.ACTIVE },
            { category_id: 1 },
            { brand_id: 2 },
          ],
        }),
        include: expect.any(Object),
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('STATE FILTER PRIORITY (findAll)', () => {
    // Regression: previously, the state filter was set with a ternary
    // (pos_optimized ? ACTIVE : include_inactive ? undefined : { not: ARCHIVED })
    // and then overridden by a spread `...(state && { state })`. The spread
    // did not propagate correctly, so filtering by 'archived' returned 0
    // products. Fix computes `effectiveState` with explicit priority.

    const buildStateQuery = (
      overrides: Partial<ProductQueryDto> = {},
    ): ProductQueryDto =>
      ({
        page: 1,
        limit: 10,
        ...overrides,
      }) as ProductQueryDto;

    const getFindManyStateFilter = (callArgs: any): any => {
      // The service wraps `where` inside an `AND` array when there are other
      // filters; we unwrap it here so tests only assert the `state` clause.
      const where = callArgs?.where ?? {};
      if (Array.isArray(where.AND)) {
        const stateEntry = where.AND.find(
          (clause: any) => clause && 'state' in clause,
        );
        return stateEntry?.state;
      }
      return where.state;
    };

    it('uses the explicit `state` param when the caller asks for archived', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(
        buildStateQuery({ state: ProductState.ARCHIVED, include_inactive: true }),
      );

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.ARCHIVED);
    });

    it('forces ACTIVE when pos_optimized=true and no explicit state', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({ pos_optimized: true }));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.ACTIVE);
    });

    it('omits the state filter when include_inactive=true and no explicit state', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({ include_inactive: true }));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      // No `state` clause should appear at all.
      expect(getFindManyStateFilter(lastCall)).toBeUndefined();
    });

    it('excludes archived by default when no flags are set', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(buildStateQuery({}));

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      expect(getFindManyStateFilter(lastCall)).toEqual({
        not: ProductState.ARCHIVED,
      });
    });

    it('explicit `state` wins over pos_optimized (caller priority)', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([]);
      mockPrismaService.products.count.mockResolvedValue(0);

      await service.findAll(
        buildStateQuery({
          state: ProductState.INACTIVE,
          pos_optimized: true,
        }),
      );

      const lastCall =
        mockPrismaService.products.findMany.mock.calls[
          mockPrismaService.products.findMany.mock.calls.length - 1
        ][0];
      // Even though pos_optimized is true, explicit INACTIVE should win.
      expect(getFindManyStateFilter(lastCall)).toBe(ProductState.INACTIVE);
    });
  });

  describe('ACTIVE PROMOTIONS ON LISTING', () => {
    const buildListedProduct = (override: Partial<any> = {}) => ({
      id: override.id ?? 1,
      name: 'Sample Product',
      slug: 'sample-product',
      description: 'desc',
      base_price: 100,
      sale_price: null,
      is_on_sale: false,
      sku: 'SKU-1',
      cost_price: null,
      profit_margin: null,
      min_stock_level: null,
      reorder_point: null,
      state: ProductState.ACTIVE,
      pricing_type: 'unit',
      product_type: 'physical',
      track_inventory: true,
      available_for_ecommerce: true,
      is_featured: false,
      allow_pos_price_override: false,
      requires_batch_tracking: false,
      requires_booking: false,
      booking_mode: null,
      buffer_minutes: 0,
      is_recurring: false,
      service_duration_minutes: null,
      service_modality: null,
      service_pricing_type: null,
      service_instructions: null,
      product_images: [],
      brands: null,
      product_categories: override.product_categories ?? [],
      product_tax_assignments: [],
      product_price_tier_assignments: [],
      product_variants: [],
      stock_levels: [],
      stores: { id: 1, name: 'T', slug: 't' },
      _count: { product_variants: 0, product_images: 0, reviews: 0 },
      ...override,
    });

    it('attaches active_promotion when the engine returns one for the product', async () => {
      const product = buildListedProduct({ id: 10 });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map([
          [
            10,
            {
              id: 55,
              name: 'Direct 15%',
              type: 'percentage',
              scope: 'product',
              discount_percentage: 15,
              promotional_price: 85,
              badge_label: '-15% OFF',
              priority: 2,
            },
          ],
        ]),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect((result.data[0] as any).active_promotion).toMatchObject({
        id: 55,
        promotional_price: 85,
        badge_label: '-15% OFF',
      });
    });

    it('forwards product category ids so the engine can resolve scope=category eligibility', async () => {
      const product = buildListedProduct({
        id: 20,
        product_categories: [
          { category_id: 5, categories: { id: 5, name: 'Cat A' } },
        ],
      });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map([
          [
            20,
            {
              id: 77,
              name: 'Cat 10%',
              type: 'percentage',
              scope: 'category',
              discount_percentage: 10,
              promotional_price: 90,
              badge_label: '-10% OFF',
              priority: 1,
            },
          ],
        ]),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      const callArgs =
        mockPromotionEngineService.findActiveAutoPromotionsForProducts.mock
          .calls[0][0];
      expect(callArgs[0].category_ids).toContain(5);
      expect((result.data[0] as any).active_promotion).toMatchObject({
        id: 77,
        scope: 'category',
      });
    });

    it('returns active_promotion=null when the engine does not match the product', async () => {
      const product = buildListedProduct({ id: 30 });
      mockPrismaService.products.findMany.mockResolvedValue([product]);
      mockPrismaService.products.count.mockResolvedValue(1);
      mockPromotionEngineService.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
        new Map(),
      );

      const result = await service.findAll({ page: 1, limit: 10 });

      expect((result.data[0] as any).active_promotion).toBeNull();
    });
  });
});
