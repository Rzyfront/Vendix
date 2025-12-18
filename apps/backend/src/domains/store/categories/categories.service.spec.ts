import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQueryDto,
  CategoryState,
} from './dto';
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

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prismaService: PrismaService;
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
    },
  };

  const mockAccessValidationService = {
    validateStoreAccess: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AccessValidationService,
          useValue: mockAccessValidationService,
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    prismaService = module.get<PrismaService>(PrismaService);
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
          image_url: undefined,
          state: CategoryState.ACTIVE,
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
          image_url: undefined,
          state: CategoryState.ACTIVE,
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
        data: categories,
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: { not: 'archived' } },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: { stores: true },
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
        data: categories,
        meta: { total: 6, page: 2, limit: 5, totalPages: 2 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: { not: 'archived' } },
        skip: 5,
        take: 5,
        orderBy: { created_at: 'desc' },
        include: { stores: true },
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
        data: categories,
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
        include: { stores: true },
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
        data: categories,
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { state: 'inactive' },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: { stores: true },
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

    it('should throw NotFoundException when category not found', async () => {
      const categoryId = 999;

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(service.findOne(categoryId)).rejects.toThrow(
        NotFoundException,
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

    it('should throw NotFoundException when category not found for update', async () => {
      const categoryId = 999;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Updated Category',
      };
      const user = { id: 1, organization_id: 1 };

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).rejects.toThrow(NotFoundException);
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

      expect(
        mockAccessValidationService.validateStoreAccess,
      ).toHaveBeenCalledWith(1, user);
      expect(mockPrismaService.product_categories.count).toHaveBeenCalledWith({
        where: { category_id: 1 },
      });
      expect(mockPrismaService.categories.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          state: 'archived',
          updated_at: expect.any(Date),
        },
      });
    });

    it('should throw BadRequestException when category has assigned products', async () => {
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
        BadRequestException,
      );
      await expect(service.remove(categoryId, user)).rejects.toThrow(
        'Cannot delete category with assigned products',
      );
    });

    it('should throw NotFoundException when category not found for deletion', async () => {
      const categoryId = 999;
      const user = { id: 1, organization_id: 1 };

      mockPrismaService.categories.findFirst.mockResolvedValue(null);

      await expect(service.remove(categoryId, user)).rejects.toThrow(
        NotFoundException,
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

    it('should throw ConflictException when slug already exists', async () => {
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
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update(categoryId, updateCategoryDto, user),
      ).rejects.toThrow('Category slug already exists in this store');
    });
  });
});
