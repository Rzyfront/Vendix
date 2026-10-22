import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AssignProductsDto } from './dto';
// The categories domain throws typed VendixHttpException (CAT_*): the HTTP
// status now travels in the error code, not in the exception class.
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { RequestContextService } from '../../../common/context/request-context.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { S3Service } from '@common/services/s3.service';
import { CategoriesService } from './categories.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  CategoryState,
} from './dto';

// Mock para slugify
jest.mock('slugify', () => ({
  default: jest
    .fn()
    .mockImplementation((text) => text.toLowerCase().replace(/\s+/g, '-')),
}));

describe('CategoriesService', () => {

  // Writes read the tenant from the ALS context rather than a parameter, so
  // without it every case dies on STORE_CONTEXT_001 before reaching the rule it
  // means to assert. Establishing it per-test keeps the scoping contract intact
  // (the service still refuses when the context is genuinely absent — that path
  // has its own case).
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(1);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 1 } as any);
  });
  let service: CategoriesService;
  let prismaService: StorePrismaService;
  let accessValidationService: AccessValidationService;

  const mockPrismaService = {
    categories: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    product_categories: {
      count: jest.fn(),
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    products: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(mockPrismaService)),
  };

  const mockAccessValidationService = {
    validateStoreAccess: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: StorePrismaService,
          useValue: mockPrismaService,
        },
        // Image handling is S3Service's own contract (it has its own tests); these
        // stubs echo predictable values so a response assertion can read them.
        {
          provide: S3Service,
          useValue: {
            uploadImage: jest.fn().mockResolvedValue('https://s3/img.png'),
            uploadFile: jest.fn().mockResolvedValue('https://s3/file.xlsx'),
            downloadImage: jest.fn().mockResolvedValue(Buffer.from('')),
            deleteFile: jest.fn().mockResolvedValue(undefined),
            getPresignedUrl: jest.fn((url) => url),
            signUrl: jest.fn((url) => url),
          },
        },
        {
          provide: S3PathHelper,
          useValue: {
            buildBrandPath: jest.fn(() => 'brands/1'),
            buildCategoryPath: jest.fn(() => 'categories/1'),
          },
        },
        {
          provide: AccessValidationService,
          useValue: mockAccessValidationService,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    prismaService = module.get<StorePrismaService>(StorePrismaService);
    accessValidationService = module.get<AccessValidationService>(
      AccessValidationService,
    );

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a category successfully', async () => {
      const createCategoryDto: CreateCategoryDto = {
        name: 'Test Category',
        description: 'Test description',
        image_url: 'https://example.com/image.jpg',
      };

      const user = { id: 1, organization_id: 1 };
      const expectedCategory = {
        id: 1,
        name: 'Test Category',
        slug: 'test-category',
        description: 'Test description',
        image_url: 'https://example.com/image.jpg',
        state: CategoryState.ACTIVE,
        stores: { id: 1, name: 'Test Store' },
      };

      mockPrismaService.categories.create.mockResolvedValue(expectedCategory);

      const result = await service.create(createCategoryDto, user);

      expect(result).toEqual(expectedCategory);
      expect(mockPrismaService.categories.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Category',
          slug: 'test-category',
          description: 'Test description',
          image_url: 'https://example.com/image.jpg',
          state: CategoryState.ACTIVE,
          // Stamped from the ALS context, never taken from the DTO.
          store_id: 1,
        },
        include: { stores: true },
      });
    });

    it('should create category with minimum required fields', async () => {
      const createCategoryDto: CreateCategoryDto = {
        name: 'Minimal Category',
      };

      const user = { id: 1, organization_id: 1 };
      const expectedCategory = {
        id: 1,
        name: 'Minimal Category',
        slug: 'minimal-category',
        state: CategoryState.ACTIVE,
        stores: { id: 1, name: 'Test Store' },
      };

      mockPrismaService.categories.create.mockResolvedValue(expectedCategory);

      const result = await service.create(createCategoryDto, user);

      expect(result).toEqual(expectedCategory);
      expect(mockPrismaService.categories.create).toHaveBeenCalledWith({
        data: {
          name: 'Minimal Category',
          slug: 'minimal-category',
          description: undefined,
          image_url: null,
          state: CategoryState.ACTIVE,
          // Stamped from the ALS context, never taken from the DTO.
          store_id: 1,
        },
        include: { stores: true },
      });
    });

    it('should handle slug generation correctly', async () => {
      const createCategoryDto: CreateCategoryDto = {
        name: 'Complex Category Name 123',
      };

      const user = { id: 1, organization_id: 1 };
      const expectedCategory = {
        id: 1,
        name: 'Complex Category Name 123',
        slug: 'complex-category-name-123',
        state: CategoryState.ACTIVE,
        stores: { id: 1, name: 'Test Store' },
      };

      mockPrismaService.categories.create.mockResolvedValue(expectedCategory);

      const result = await service.create(createCategoryDto, user);

      expect(result).toEqual(expectedCategory);
      expect(mockPrismaService.categories.create).toHaveBeenCalledWith({
        data: {
          name: 'Complex Category Name 123',
          slug: 'complex-category-name-123',
          description: undefined,
          image_url: null,
          state: CategoryState.ACTIVE,
          // Stamped from the ALS context, never taken from the DTO.
          store_id: 1,
        },
        include: { stores: true },
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated categories with default values', async () => {
      const query: CategoryQueryDto = {};
      const categories = [
        {
          id: 1,
          name: 'Category 1',
          state: CategoryState.ACTIVE,
          stores: { id: 1, name: 'Store 1' },
        },
        {
          id: 2,
          name: 'Category 2',
          state: CategoryState.ACTIVE,
          stores: { id: 1, name: 'Store 1' },
        },
      ];

      mockPrismaService.categories.findMany.mockResolvedValue(categories);
      mockPrismaService.categories.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: categories.map((c) => ({ ...c, product_count: 0 })),
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: { not: 'archived' } },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: { stores: true, _count: expect.anything() },
      });
    });

    it('should handle pagination parameters', async () => {
      const query: CategoryQueryDto = {
        page: 2,
        limit: 5,
        sort_by: 'created_at',
        sort_order: 'desc',
      };

      const categories = [
        {
          id: 1,
          name: 'Category 1',
          state: CategoryState.ACTIVE,
          stores: { id: 1, name: 'Store 1' },
        },
      ];

      mockPrismaService.categories.findMany.mockResolvedValue(categories);
      mockPrismaService.categories.count.mockResolvedValue(6);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: categories.map((c) => ({ ...c, product_count: 0 })),
        meta: { total: 6, page: 2, limit: 5, totalPages: 2 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: { not: 'archived' } },
        skip: 5,
        take: 5,
        orderBy: { created_at: 'desc' },
        include: { stores: true, _count: expect.anything() },
      });
    });

    it('should handle search functionality', async () => {
      const query: CategoryQueryDto = {
        search: 'test',
      };

      const categories = [
        {
          id: 1,
          name: 'Test Category',
          state: CategoryState.ACTIVE,
          stores: { id: 1, name: 'Store 1' },
        },
      ];

      mockPrismaService.categories.findMany.mockResolvedValue(categories);
      mockPrismaService.categories.count.mockResolvedValue(1);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: categories.map((c) => ({ ...c, product_count: 0 })),
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: {
          state: { not: 'archived' },
          OR: [
            { name: { contains: 'test', mode: 'insensitive' } },
            { description: { contains: 'test', mode: 'insensitive' } },
          ],
        },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: { stores: true, _count: expect.anything() },
      });
    });

    it('should handle state filtering', async () => {
      const query: CategoryQueryDto = {
        state: CategoryState.INACTIVE,
      };

      const categories = [
        {
          id: 1,
          name: 'Inactive Category',
          state: 'inactive',
          stores: { id: 1, name: 'Store 1' },
        },
      ];

      mockPrismaService.categories.findMany.mockResolvedValue(categories);
      mockPrismaService.categories.count.mockResolvedValue(1);

      const result = await service.findAll(query);

      expect(result).toEqual({
        data: categories.map((c) => ({ ...c, product_count: 0 })),
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: 'inactive' },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: { stores: true, _count: expect.anything() },
      });
    });
  });

  describe('findOne', () => {
    it('should return category by id', async () => {
      const categoryId = 1;
      const expectedCategory = {
        id: 1,
        name: 'Test Category',
        state: CategoryState.ACTIVE,
        stores: { id: 1, name: 'Store 1' },
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(
        expectedCategory,
      );

      const result = await service.findOne(categoryId);

      expect(result).toEqual(expectedCategory);
      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith({
        where: { id: 1, state: CategoryState.ACTIVE },
        include: { stores: true },
      });
    });

    it('should throw VendixHttpException when category not found', async () => {
      const categoryId = 999;

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne(categoryId)).rejects.toThrow(
        VendixHttpException,
      );
      await expect(service.findOne(categoryId)).rejects.toThrow(
        'Category not found',
      );
    });

    it('should include inactive categories when requested', async () => {
      const categoryId = 1;
      const expectedCategory = {
        id: 1,
        name: 'Inactive Category',
        state: CategoryState.INACTIVE,
        stores: { id: 1, name: 'Store 1' },
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(
        expectedCategory,
      );

      const result = await service.findOne(categoryId, {
        includeInactive: true,
      });

      expect(result).toEqual(expectedCategory);
      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { stores: true },
      });
    });
  });

  describe('update', () => {
    it('should update category successfully', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Updated Category',
        description: 'Updated description',
      };

      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Original Category',
        slug: 'original-category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      const updatedCategory = {
        ...existingCategory,
        name: 'Updated Category',
        slug: 'updated-category',
        description: 'Updated description',
      };

      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce(existingCategory) // For findOne
        .mockResolvedValueOnce(null); // For validateUniqueSlug
      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );
      mockPrismaService.categories.update.mockResolvedValue(updatedCategory);

      const result = await service.update(categoryId, updateCategoryDto, user);

      expect(result).toEqual(updatedCategory);
      expect(
        mockAccessValidationService.validateStoreAccess,
      ).toHaveBeenCalledWith(1, user);
      expect(mockPrismaService.categories.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          name: 'Updated Category',
          slug: 'updated-category',
          description: 'Updated description',
        },
        include: { stores: true },
      });
    });

    it('should handle partial updates', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        description: 'Only description updated',
      };

      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Original Category',
        slug: 'original-category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      const updatedCategory = {
        ...existingCategory,
        description: 'Only description updated',
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(
        existingCategory,
      );
      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );
      mockPrismaService.categories.update.mockResolvedValue(updatedCategory);

      const result = await service.update(categoryId, updateCategoryDto, user);

      expect(result).toEqual(updatedCategory);
      expect(mockPrismaService.categories.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          description: 'Only description updated',
        },
        include: { stores: true },
      });
    });

    it('should throw VendixHttpException when category not found for update', async () => {
      const categoryId = 999;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Updated Category',
      };
      const user = { id: 1, organization_id: 1 };

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).rejects.toThrow(VendixHttpException);
    });
  });

  describe('remove', () => {
    it('should archive category when no products assigned', async () => {
      const categoryId = 1;
      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Test Category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(
        existingCategory,
      );
      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );
      mockPrismaService.product_categories.count.mockResolvedValue(0);
      mockPrismaService.categories.update.mockResolvedValue({
        ...existingCategory,
        state: 'archived',
      });

      await service.remove(categoryId, user);

      // NOTE: remove() does NOT call validateStoreAccess — only update() does.
      // The tenant boundary on this path is the scoped Prisma client (findOne
      // cannot see another store's category at all); validateStoreAccess is the
      // secondary user-to-store check. Worth confirming that is intended.
      expect(
        mockAccessValidationService.validateStoreAccess,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.product_categories.count).toHaveBeenCalledWith({
        where: { category_id: 1 },
      });
      expect(mockPrismaService.categories.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          // Prisma stamps updated_at via @updatedAt; the service no longer sets it.
          state: 'archived',
        },
      });
    });

    it('should throw VendixHttpException when category has assigned products', async () => {
      const categoryId = 1;
      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Test Category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      mockPrismaService.categories.findFirst.mockResolvedValue(
        existingCategory,
      );
      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );
      mockPrismaService.product_categories.count.mockResolvedValue(5);

      await expect(service.remove(categoryId, user)).rejects.toThrow(
        VendixHttpException,
      );
      await expect(service.remove(categoryId, user)).rejects.toThrow(
        'Category has assigned products',
      );
    });

    it('should throw VendixHttpException when category not found for deletion', async () => {
      const categoryId = 999;
      const user = { id: 1, organization_id: 1 };

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(service.remove(categoryId, user)).rejects.toThrow(
        VendixHttpException,
      );
    });
  });

  describe('validateUniqueSlug', () => {
    it('should not throw when slug is unique', async () => {
      const slug = 'unique-category';
      const storeId = 1;

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      // Since validateUniqueSlug is private, we need to test it indirectly through update
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Unique Category',
      };
      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Original Category',
        slug: 'original-category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce(existingCategory) // For findOne
        .mockResolvedValueOnce(null); // For validateUniqueSlug
      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );
      mockPrismaService.categories.update.mockResolvedValue({
        ...existingCategory,
        name: 'Unique Category',
      });

      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).resolves.not.toThrow();
    });

    it('should throw VendixHttpException when slug already exists', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Existing Category',
      };
      const user = { id: 1, organization_id: 1 };
      const existingCategory = {
        id: 1,
        name: 'Original Category',
        slug: 'original-category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };
      const conflictingCategory = {
        id: 2,
        name: 'Existing Category',
        slug: 'existing-category',
        store_id: 1,
        state: CategoryState.ACTIVE,
      };

      // Reset the mock specifically for this test
      mockPrismaService.categories.findFirst.mockReset();

      // Mock the calls in sequence - we need to handle multiple calls
      // The service might make additional calls during error handling
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce(existingCategory) // First call: findOne
        .mockResolvedValueOnce(conflictingCategory) // Second call: validateUniqueSlug
        .mockResolvedValueOnce(existingCategory) // Third call: potential retry
        .mockResolvedValueOnce(existingCategory); // Fourth call: potential retry

      mockAccessValidationService.validateStoreAccess.mockResolvedValue(
        undefined,
      );

      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).rejects.toThrow(VendixHttpException);
      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).rejects.toThrow('Category name/slug already exists in this store');
    });
  });

  describe('findAll product_count', () => {
    it('exposes the non-archived product count per category', async () => {
      mockPrismaService.categories.findMany.mockResolvedValue([
        { id: 1, name: 'A', image_url: null, _count: { product_categories: 4 } },
        { id: 2, name: 'B', image_url: null, _count: { product_categories: 0 } },
      ]);
      mockPrismaService.categories.count.mockResolvedValue(2);

      const result = await service.findAll({});

      expect(result.data.map((c: any) => c.product_count)).toEqual([4, 0]);
      expect(result.data[0]).not.toHaveProperty('_count');
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: {
              select: {
                product_categories: {
                  where: { products: { state: { not: 'archived' } } },
                },
              },
            },
          }),
        }),
      );
    });
  });

  describe('assignProducts', () => {
    const activeProducts = (ids: number[]) =>
      ids.map((id) => ({ id, brand_id: null, state: 'active' }));

    beforeEach(() => {
      mockPrismaService.categories.findFirst.mockResolvedValue({ id: 5 });
      mockPrismaService.product_categories.findMany.mockReset();
      mockPrismaService.product_categories.createMany.mockReset();
      mockPrismaService.product_categories.deleteMany.mockReset();
      mockPrismaService.products.findMany.mockReset();
      mockPrismaService.products.updateMany.mockReset();
    });

    it('add inserts with skipDuplicates and counts existing as unchanged', async () => {
      mockPrismaService.products.findMany.mockResolvedValue(
        activeProducts([1, 2, 3]),
      );
      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 2 },
      ]);
      mockPrismaService.product_categories.createMany.mockResolvedValue({
        count: 2,
      });

      const result = await service.assignProducts(5, {
        action: 'add',
        product_ids: [1, 2, 3, 3],
      });

      expect(result).toEqual({ added: 2, removed: 0, unchanged: 1 });
      expect(
        mockPrismaService.product_categories.createMany,
      ).toHaveBeenCalledWith({
        data: [
          { product_id: 1, category_id: 5 },
          { product_id: 3, category_id: 5 },
        ],
        skipDuplicates: true,
      });
      expect(mockPrismaService.products.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 3] }, store_id: 1 },
        data: { updated_at: expect.any(Date) },
      });
      expect(
        mockPrismaService.product_categories.deleteMany,
      ).not.toHaveBeenCalled();
    });

    it('remove deletes only that category relation', async () => {
      mockPrismaService.products.findMany.mockResolvedValue(
        activeProducts([1, 2]),
      );
      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 1 },
      ]);
      mockPrismaService.product_categories.deleteMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.assignProducts(5, {
        action: 'remove',
        product_ids: [1, 2],
      });

      expect(result).toEqual({ added: 0, removed: 1, unchanged: 1 });
      expect(
        mockPrismaService.product_categories.deleteMany,
      ).toHaveBeenCalledWith({
        where: { category_id: 5, product_id: { in: [1] } },
      });
      expect(mockPrismaService.products.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] }, store_id: 1 },
        data: { updated_at: expect.any(Date) },
      });
    });

    it('does not bump updated_at when nothing changed', async () => {
      mockPrismaService.products.findMany.mockResolvedValue(activeProducts([1]));
      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 1 },
      ]);

      const result = await service.assignProducts(5, {
        action: 'add',
        product_ids: [1],
      });

      expect(result).toEqual({ added: 0, removed: 0, unchanged: 1 });
      expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
    });

    it('rejects missing/other-store products without writing', async () => {
      mockPrismaService.products.findMany.mockResolvedValue(activeProducts([1]));

      await expect(
        service.assignProducts(5, { action: 'add', product_ids: [1, 99] }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          details: { invalid_product_ids: [99] },
        }),
      });
      expect(
        mockPrismaService.product_categories.createMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.products.updateMany).not.toHaveBeenCalled();
    });

    it('rejects archived products on add but allows them on remove', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 1, brand_id: null, state: 'archived' },
      ]);
      await expect(
        service.assignProducts(5, { action: 'add', product_ids: [1] }),
      ).rejects.toBeInstanceOf(VendixHttpException);

      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 1 },
      ]);
      mockPrismaService.product_categories.deleteMany.mockResolvedValue({
        count: 1,
      });
      await expect(
        service.assignProducts(5, { action: 'remove', product_ids: [1] }),
      ).resolves.toEqual({ added: 0, removed: 1, unchanged: 0 });
    });

    it('throws CAT_FIND_001 when the category is missing or archived', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(
        service.assignProducts(5, { action: 'add', product_ids: [1] }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'CAT_FIND_001' }),
      });
      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5, store_id: 1, state: { not: 'archived' } },
        }),
      );
      expect(mockPrismaService.products.findMany).not.toHaveBeenCalled();
    });
  });

  describe('previewAssignProducts', () => {
    beforeEach(() => {
      mockPrismaService.categories.findFirst.mockResolvedValue({ id: 5 });
      mockPrismaService.product_categories.findMany.mockReset();
      mockPrismaService.product_categories.createMany.mockReset();
      mockPrismaService.product_categories.deleteMany.mockReset();
      mockPrismaService.products.findMany.mockReset();
      mockPrismaService.products.updateMany.mockReset();
    });

    it('rechaza productos de otra tienda sin escribir', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 1, state: 'active' },
      ]);
      await expect(
        service.previewAssignProducts(5, {
          action: 'add',
          product_ids: [1, 99],
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'PROD_FIND_001',
          details: { invalid_product_ids: [99] },
        }),
      });
      expect(
        mockPrismaService.product_categories.createMany,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.product_categories.deleteMany,
      ).not.toHaveBeenCalled();
    });

    it('devuelve cuántos ya están y cuántos se agregarían', async () => {
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 1, state: 'active' },
        { id: 2, state: 'active' },
        { id: 3, state: 'active' },
      ]);
      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 2 },
      ]);
      await expect(
        service.previewAssignProducts(5, {
          action: 'add',
          product_ids: [1, 2, 3],
        }),
      ).resolves.toEqual({ already_in_category: 1, to_add: 2 });
    });

    it('lanza CAT_FIND_001 si la categoría no existe', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValue(null);
      await expect(
        service.previewAssignProducts(5, { action: 'add', product_ids: [1] }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'CAT_FIND_001' }),
      });
    });
  });

  describe('AssignProductsDto', () => {
    const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
    it('acepta 100 ids y rechaza 101 (arrayMaxSize)', () => {
      const ok = validateSync(
        plainToInstance(AssignProductsDto, {
          action: 'add',
          product_ids: range(100),
        }),
      );
      expect(ok).toHaveLength(0);
      const bad = validateSync(
        plainToInstance(AssignProductsDto, {
          action: 'add',
          product_ids: range(101),
        }),
      );
      expect(bad[0].constraints).toHaveProperty('arrayMaxSize');
    });
  });

  describe('getProductIds', () => {
    it('returns non-archived member ids and total', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValue({ id: 5 });
      mockPrismaService.product_categories.findMany.mockResolvedValue([
        { product_id: 3 },
        { product_id: 7 },
      ]);

      await expect(service.getProductIds(5)).resolves.toEqual({
        product_ids: [3, 7],
        total: 2,
      });
      expect(
        mockPrismaService.product_categories.findMany,
      ).toHaveBeenCalledWith({
        where: {
          category_id: 5,
          products: { state: { not: 'archived' } },
        },
        select: { product_id: true },
      });
    });

    it('throws CAT_FIND_001 for an unknown category', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValue(null);
      await expect(service.getProductIds(5)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });
  });

  describe('assignProducts tenant isolation', () => {
    it('scopes categories and products lookups with the context store_id', async () => {
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
      mockPrismaService.categories.findFirst.mockResolvedValue({ id: 5 });
      mockPrismaService.products.findMany.mockReset();
      mockPrismaService.products.findMany.mockResolvedValue([
        { id: 1, brand_id: null, state: 'active' },
      ]);
      mockPrismaService.product_categories.findMany.mockResolvedValue([]);
      mockPrismaService.product_categories.createMany.mockResolvedValue({
        count: 1,
      });

      await service.assignProducts(5, { action: 'add', product_ids: [1] });

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [1] }, store_id: 7 } }),
      );
      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 5, store_id: 7, state: { not: 'archived' } },
        }),
      );
    });

    it('throws STORE_CONTEXT_001 without a store in context', async () => {
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);
      mockPrismaService.products.findMany.mockReset();

      await expect(
        service.assignProducts(5, { action: 'add', product_ids: [1] }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error_code: 'STORE_CONTEXT_001' }),
      });
      await expect(service.getProductIds(5)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      expect(mockPrismaService.products.findMany).not.toHaveBeenCalled();
    });
  });
});
