import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ResponseService } from '@common/responses/response.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryQueryDto } from './dto';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let categoriesService: CategoriesService;
  let responseService: ResponseService;

  const mockCategoriesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockResponseService = {
    created: jest.fn(),
    success: jest.fn(),
    paginated: jest.fn(),
    updated: jest.fn(),
    deleted: jest.fn(),
    error: jest.fn(),
  };

  const mockUser = {
    id: 1,
    email: 'test@example.com',
    organization_id: 1,
    roles: ['admin'],
  };

  const mockRequest = {
    user: mockUser,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        {
          provide: CategoriesService,
          useValue: mockCategoriesService,
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

    controller = module.get<CategoriesController>(CategoriesController);
    categoriesService = module.get<CategoriesService>(CategoriesService);
    responseService = module.get<ResponseService>(ResponseService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create category successfully', async () => {
      const createCategoryDto: CreateCategoryDto = {
        name: 'Test Category',
        description: 'Test description',
        image_url: 'https://example.com/image.jpg',
      };

      const createdCategory = {
        id: 1,
        name: 'Test Category',
        slug: 'test-category',
        description: 'Test description',
        image_url: 'https://example.com/image.jpg',
        state: 'active',
        stores: { id: 1, name: 'Test Store' },
      };

      const expectedResponse = {
        data: createdCategory,
        message: 'Categoría creada exitosamente',
      };

      mockCategoriesService.create.mockResolvedValue(createdCategory);
      mockResponseService.created.mockReturnValue(expectedResponse);

      const result = await controller.create(
        createCategoryDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.create).toHaveBeenCalledWith(
        createCategoryDto,
        mockUser,
      );
      expect(mockResponseService.created).toHaveBeenCalledWith(
        createdCategory,
        'Categoría creada exitosamente',
      );
    });

    it('should handle errors when creating category', async () => {
      const createCategoryDto: CreateCategoryDto = {
        name: 'Test Category',
      };

      const error = new ConflictException('Category slug already exists');
      const expectedErrorResponse = {
        error: 'Category slug already exists',
        message: 'Category slug already exists',
        statusCode: 409,
      };

      mockCategoriesService.create.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.create(
        createCategoryDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Category slug already exists',
        'Category slug already exists',
        409,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated categories successfully', async () => {
      const query: CategoryQueryDto = {
        page: 1,
        limit: 10,
      };

      const categoriesData = {
        data: [
          {
            id: 1,
            name: 'Category 1',
            state: 'active',
            stores: { id: 1, name: 'Store 1' },
          },
          {
            id: 2,
            name: 'Category 2',
            state: 'active',
            stores: { id: 1, name: 'Store 1' },
          },
        ],
        meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
      };

      const expectedResponse = {
        data: categoriesData.data,
        meta: categoriesData.meta,
        message: 'Categorías obtenidas exitosamente',
      };

      mockCategoriesService.findAll.mockResolvedValue(categoriesData);
      mockResponseService.paginated.mockReturnValue(expectedResponse);

      const result = await controller.findAll(query);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.findAll).toHaveBeenCalledWith(query);
      expect(mockResponseService.paginated).toHaveBeenCalledWith(
        categoriesData.data,
        categoriesData.meta.total,
        categoriesData.meta.page,
        categoriesData.meta.limit,
        'Categorías obtenidas exitosamente',
      );
    });

    it('should return non-paginated categories when no meta data', async () => {
      const query: CategoryQueryDto = {};

      const categoriesData = [
        {
          id: 1,
          name: 'Category 1',
          state: 'active',
          stores: { id: 1, name: 'Store 1' },
        },
      ];

      const expectedResponse = {
        data: categoriesData,
        message: 'Categorías obtenidas exitosamente',
      };

      mockCategoriesService.findAll.mockResolvedValue(categoriesData);
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await controller.findAll(query);

      expect(result).toEqual(expectedResponse);
      expect(mockResponseService.success).toHaveBeenCalledWith(
        categoriesData,
        'Categorías obtenidas exitosamente',
      );
    });

    it('should handle errors when fetching categories', async () => {
      const query: CategoryQueryDto = {};

      const error = new Error('Database connection failed');
      const expectedErrorResponse = {
        error: 'Database connection failed',
        message: 'Database connection failed',
        statusCode: 400,
      };

      mockCategoriesService.findAll.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.findAll(query);

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Database connection failed',
        'Database connection failed',
        400,
      );
    });
  });

  describe('search', () => {
    it('should search categories successfully', async () => {
      const query: CategoryQueryDto = {
        search: 'test',
      };

      const searchResult = {
        data: [
          {
            id: 1,
            name: 'Test Category',
            state: 'active',
            stores: { id: 1, name: 'Store 1' },
          },
        ],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      const expectedResponse = {
        data: searchResult.data,
        message: 'Búsqueda de categorías completada',
      };

      mockCategoriesService.findAll.mockResolvedValue(searchResult);
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await controller.search(query);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.findAll).toHaveBeenCalledWith({
        ...query,
        search: 'test',
      });
      expect(mockResponseService.success).toHaveBeenCalledWith(
        searchResult.data,
        'Búsqueda de categorías completada',
      );
    });

    it('should handle empty search query', async () => {
      const query: CategoryQueryDto = {};

      const searchResult = {
        data: [
          {
            id: 1,
            name: 'Category 1',
            state: 'active',
            stores: { id: 1, name: 'Store 1' },
          },
        ],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      };

      const expectedResponse = {
        data: searchResult.data,
        message: 'Búsqueda de categorías completada',
      };

      mockCategoriesService.findAll.mockResolvedValue(searchResult);
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await controller.search(query);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.findAll).toHaveBeenCalledWith({
        ...query,
        search: '',
      });
    });

    it('should handle errors when searching categories', async () => {
      const query: CategoryQueryDto = {
        search: 'test',
      };

      const error = new Error('Search failed');
      const expectedErrorResponse = {
        error: 'Search failed',
        message: 'Search failed',
        statusCode: 400,
      };

      mockCategoriesService.findAll.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.search(query);

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Search failed',
        'Search failed',
        400,
      );
    });
  });

  describe('findOne', () => {
    it('should return category by id successfully', async () => {
      const categoryId = 1;
      const category = {
        id: 1,
        name: 'Test Category',
        state: 'active',
        stores: { id: 1, name: 'Store 1' },
      };

      const expectedResponse = {
        data: category,
        message: 'Categoría obtenida exitosamente',
      };

      mockCategoriesService.findOne.mockResolvedValue(category);
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await controller.findOne(categoryId);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.findOne).toHaveBeenCalledWith(1, {
        includeInactive: false,
      });
      expect(mockResponseService.success).toHaveBeenCalledWith(
        category,
        'Categoría obtenida exitosamente',
      );
    });

    it('should include inactive categories when requested', async () => {
      const categoryId = 1;
      const includeInactive = 'true';
      const category = {
        id: 1,
        name: 'Inactive Category',
        state: 'inactive',
        stores: { id: 1, name: 'Store 1' },
      };

      const expectedResponse = {
        data: category,
        message: 'Categoría obtenida exitosamente',
      };

      mockCategoriesService.findOne.mockResolvedValue(category);
      mockResponseService.success.mockReturnValue(expectedResponse);

      const result = await controller.findOne(categoryId, includeInactive);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.findOne).toHaveBeenCalledWith(1, {
        includeInactive: true,
      });
    });

    it('should handle NotFoundException when category not found', async () => {
      const categoryId = 999;

      const error = new NotFoundException('Category not found');
      const expectedErrorResponse = {
        error: 'Category not found',
        message: 'Category not found',
        statusCode: 404,
      };

      mockCategoriesService.findOne.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.findOne(categoryId);

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Category not found',
        'Category not found',
        404,
      );
    });
  });

  describe('update', () => {
    it('should update category successfully', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Updated Category',
        description: 'Updated description',
      };

      const updatedCategory = {
        id: 1,
        name: 'Updated Category',
        slug: 'updated-category',
        description: 'Updated description',
        state: 'active',
        stores: { id: 1, name: 'Store 1' },
      };

      const expectedResponse = {
        data: updatedCategory,
        message: 'Categoría actualizada exitosamente',
      };

      mockCategoriesService.update.mockResolvedValue(updatedCategory);
      mockResponseService.updated.mockReturnValue(expectedResponse);

      const result = await controller.update(
        categoryId,
        updateCategoryDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.update).toHaveBeenCalledWith(
        1,
        updateCategoryDto,
        mockUser,
      );
      expect(mockResponseService.updated).toHaveBeenCalledWith(
        updatedCategory,
        'Categoría actualizada exitosamente',
      );
    });

    it('should handle errors when updating category', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Updated Category',
      };

      const error = new ConflictException('Category slug already exists');
      const expectedErrorResponse = {
        error: 'Category slug already exists',
        message: 'Category slug already exists',
        statusCode: 409,
      };

      mockCategoriesService.update.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.update(
        categoryId,
        updateCategoryDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Category slug already exists',
        'Category slug already exists',
        409,
      );
    });
  });

  describe('replace', () => {
    it('should replace category successfully', async () => {
      const categoryId = 1;
      const updateCategoryDto: UpdateCategoryDto = {
        name: 'Replaced Category',
        description: 'Replaced description',
        image_url: 'https://example.com/new-image.jpg',
      };

      const replacedCategory = {
        id: 1,
        name: 'Replaced Category',
        slug: 'replaced-category',
        description: 'Replaced description',
        image_url: 'https://example.com/new-image.jpg',
        state: 'active',
        stores: { id: 1, name: 'Store 1' },
      };

      const expectedResponse = {
        data: replacedCategory,
        message: 'Categoría actualizada exitosamente',
      };

      mockCategoriesService.update.mockResolvedValue(replacedCategory);
      mockResponseService.updated.mockReturnValue(expectedResponse);

      const result = await controller.replace(
        categoryId,
        updateCategoryDto,
        mockRequest as any,
      );

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.update).toHaveBeenCalledWith(
        1,
        updateCategoryDto,
        mockUser,
      );
      expect(mockResponseService.updated).toHaveBeenCalledWith(
        replacedCategory,
        'Categoría actualizada exitosamente',
      );
    });
  });

  describe('remove', () => {
    it('should delete category successfully', async () => {
      const categoryId = 1;

      const expectedResponse = {
        message: 'Categoría eliminada exitosamente',
      };

      mockCategoriesService.remove.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue(expectedResponse);

      const result = await controller.remove(categoryId, mockRequest as any);

      expect(result).toEqual(expectedResponse);
      expect(mockCategoriesService.remove).toHaveBeenCalledWith(1, mockUser);
      expect(mockResponseService.deleted).toHaveBeenCalledWith(
        'Categoría eliminada exitosamente',
      );
    });

    it('should handle BadRequestException when category has products', async () => {
      const categoryId = 1;

      const error = new BadRequestException(
        'Cannot delete category with assigned products',
      );
      const expectedErrorResponse = {
        error: 'Cannot delete category with assigned products',
        message: 'Cannot delete category with assigned products',
        statusCode: 400,
      };

      mockCategoriesService.remove.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.remove(categoryId, mockRequest as any);

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Cannot delete category with assigned products',
        'Cannot delete category with assigned products',
        400,
      );
    });

    it('should handle NotFoundException when category not found for deletion', async () => {
      const categoryId = 999;

      const error = new NotFoundException('Category not found');
      const expectedErrorResponse = {
        error: 'Category not found',
        message: 'Category not found',
        statusCode: 404,
      };

      mockCategoriesService.remove.mockRejectedValue(error);
      mockResponseService.error.mockReturnValue(expectedErrorResponse);

      const result = await controller.remove(categoryId, mockRequest as any);

      expect(result).toEqual(expectedErrorResponse);
      expect(mockResponseService.error).toHaveBeenCalledWith(
        'Category not found',
        'Category not found',
        404,
      );
    });
  });
});
