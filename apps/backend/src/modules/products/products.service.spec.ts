import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductVariantService } from './services/product-variant.service';
import { RequestContextService } from '../../common/context/request-context.service';
import { InventoryIntegrationService } from '../inventory/shared/services/inventory-integration.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  let prismaService: PrismaService;
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
    },
    brands: {
      findUnique: jest.fn(),
    },
    tax_categories: {
      findMany: jest.fn(),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: PrismaService,
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
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    prismaService = module.get<PrismaService>(PrismaService);
    variantService = module.get<ProductVariantService>(ProductVariantService);
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
        total_products: 100,
        active_products: 85,
        inactive_products: 10,
        archived_products: 5,
        low_stock_products: 8,
        products_out_of_stock: 3,
        products_with_variants: 25,
      };

      mockPrismaService.products.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(85) // active
        .mockResolvedValueOnce(10) // inactive
        .mockResolvedValueOnce(5) // archived
        .mockResolvedValueOnce(8) // low stock
        .mockResolvedValueOnce(3) // out of stock
        .mockResolvedValueOnce(25); // with variants

      const result = await service.getProductStats(1);

      expect(result).toEqual(expectedStats);
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
});
