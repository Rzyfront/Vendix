import { Test, TestingModule } from '@nestjs/testing';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { brand_state_enum } from '@prisma/client';

describe('BrandsController', () => {
  let controller: BrandsController;
  let service: BrandsService;
  let responseService: ResponseService;

  const mockBrandsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findByStore: jest.fn(),
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
      controllers: [BrandsController],
      providers: [
        {
          provide: BrandsService,
          useValue: mockBrandsService,
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

    controller = module.get<BrandsController>(BrandsController);
    service = module.get<BrandsService>(BrandsService);
    responseService = module.get<ResponseService>(ResponseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('CREATE BRAND', () => {
    const createBrandDto: CreateBrandDto = {
      name: 'Test Brand',
      description: 'Test brand description',
      logo_url: 'https://example.com/logo.png',
    };

    it('should create a brand successfully', async () => {
      const expectedBrand = {
        id: 1,
        name: 'Test Brand',
        description: 'Test brand description',
        logo_url: 'https://example.com/logo.png',
        state: brand_state_enum.active,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockBrandsService.create.mockResolvedValue(expectedBrand);
      mockResponseService.created.mockReturnValue({
        success: true,
        data: expectedBrand,
        message: 'Marca creada exitosamente',
      });

      const result = await controller.create(createBrandDto, mockRequest);

      expect(service.create).toHaveBeenCalledWith(
        createBrandDto,
        mockRequest.user,
      );
      expect(responseService.created).toHaveBeenCalledWith(
        expectedBrand,
        'Marca creada exitosamente',
      );
      expect(result).toEqual({
        success: true,
        data: expectedBrand,
        message: 'Marca creada exitosamente',
      });
    });

    it('should create a brand with minimum required fields', async () => {
      const minimalBrandDto: CreateBrandDto = {
        name: 'Minimal Brand',
      };

      const expectedBrand = {
        id: 1,
        name: 'Minimal Brand',
        state: 'active',
      };

      mockBrandsService.create.mockResolvedValue(expectedBrand);
      mockResponseService.created.mockReturnValue({
        success: true,
        data: expectedBrand,
        message: 'Marca creada exitosamente',
      });

      const result = await controller.create(minimalBrandDto, mockRequest);

      expect(service.create).toHaveBeenCalledWith(
        minimalBrandDto,
        mockRequest.user,
      );
      expect(result.success).toBe(true);
    });

    it('should handle duplicate brand name error', async () => {
      const duplicateBrandDto: CreateBrandDto = {
        name: 'Existing Brand',
      };

      const duplicateError = new Error('Brand name already exists');
      mockBrandsService.create.mockRejectedValue(duplicateError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al crear marca',
        error: 'Brand name already exists',
      });

      const result = await controller.create(duplicateBrandDto, mockRequest);

      expect(responseService.error).toHaveBeenCalledWith(
        'Error al crear marca',
        'Brand name already exists',
      );
      expect(result.success).toBe(false);
    });

    it('should handle invalid URL in logo_url', async () => {
      const invalidBrandDto: CreateBrandDto = {
        name: 'Test Brand',
        logo_url: 'invalid-url',
      };

      const validationError = new Error('Invalid URL format');
      mockBrandsService.create.mockRejectedValue(validationError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al crear marca',
        error: 'Invalid URL format',
      });

      const result = await controller.create(invalidBrandDto, mockRequest);

      expect(result.success).toBe(false);
    });
  });

  describe('GET ALL BRANDS', () => {
    const query: BrandQueryDto = {
      page: 1,
      limit: 10,
      search: 'test',
      sort_by: 'name',
      sort_order: 'asc',
    };

    it('should return paginated brands', async () => {
      const mockResponse = {
        data: [
          {
            id: 1,
            name: 'Test Brand 1',
            state: 'active',
            products_count: 5,
          },
          {
            id: 2,
            name: 'Test Brand 2',
            state: 'active',
            products_count: 3,
          },
        ],
        meta: {
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
        },
      };

      mockBrandsService.findAll.mockResolvedValue(mockResponse);
      mockResponseService.paginated.mockReturnValue({
        success: true,
        data: mockResponse.data,
        meta: mockResponse.meta,
      });

      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(responseService.paginated).toHaveBeenCalledWith(
        mockResponse.data,
        2,
        1,
        10,
        'Marcas obtenidas exitosamente',
      );
      expect((result as any).data).toHaveLength(2);
    });

    it('should return non-paginated brands when no pagination data', async () => {
      const simpleQuery: BrandQueryDto = {};
      const mockBrands = [
        {
          id: 1,
          name: 'Brand 1',
          state: 'active',
        },
      ];

      mockBrandsService.findAll.mockResolvedValue(mockBrands);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: mockBrands,
      });

      const result = await controller.findAll(simpleQuery);

      expect(responseService.success).toHaveBeenCalledWith(
        mockBrands,
        'Marcas obtenidas exitosamente',
      );
      expect((result as any).data).toEqual(mockBrands);
    });

    it('should handle search functionality', async () => {
      const searchQuery: BrandQueryDto = {
        search: 'Nike',
        page: 1,
        limit: 5,
      };

      mockBrandsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 5 },
      });

      await controller.findAll(searchQuery);

      expect(service.findAll).toHaveBeenCalledWith(searchQuery);
    });

    it('should handle sorting parameters', async () => {
      const sortQuery: BrandQueryDto = {
        sort_by: 'created_at',
        sort_order: 'desc',
        page: 1,
        limit: 10,
      };

      mockBrandsService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 10 },
      });

      await controller.findAll(sortQuery);

      expect(service.findAll).toHaveBeenCalledWith({
        sort_by: 'created_at',
        sort_order: 'desc',
        page: 1,
        limit: 10,
      });
    });

    it('should handle service errors gracefully', async () => {
      mockBrandsService.findAll.mockRejectedValue(
        new Error('Database connection failed'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener marcas',
        error: 'Database connection failed',
      });

      const result = await controller.findAll({});

      expect(responseService.error).toHaveBeenCalledWith(
        'Error al obtener marcas',
        'Database connection failed',
      );
      expect(result.success).toBe(false);
    });
  });

  describe('GET BRANDS BY STORE', () => {
    it('should return brands for specific store', async () => {
      const storeId = 1;
      const query: BrandQueryDto = {
        page: 1,
        limit: 10,
      };

      const mockResponse = {
        data: [
          {
            id: 1,
            name: 'Store Brand 1',
            state: 'active',
            products_count: 8,
          },
        ],
        meta: {
          total: 1,
          page: 1,
          limit: 10,
        },
      };

      mockBrandsService.findByStore.mockResolvedValue(mockResponse);
      mockResponseService.paginated.mockReturnValue({
        success: true,
        data: mockResponse.data,
        meta: mockResponse.meta,
      });

      const result = await controller.findByStore(storeId, query);

      expect(service.findByStore).toHaveBeenCalledWith(storeId, query);
      expect(responseService.paginated).toHaveBeenCalledWith(
        mockResponse.data,
        1,
        1,
        10,
        'Marcas de la tienda obtenidas exitosamente',
      );
    });

    it('should handle store not found error', async () => {
      const invalidStoreId = 999;
      mockBrandsService.findByStore.mockRejectedValue(
        new Error('Store not found'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener marcas de la tienda',
        error: 'Store not found',
      });

      const result = await controller.findByStore(invalidStoreId, {});

      expect(result.success).toBe(false);
    });
  });

  describe('GET BRAND BY ID', () => {
    it('should return a brand by ID', async () => {
      const brandId = 1;
      const expectedBrand = {
        id: 1,
        name: 'Test Brand',
        description: 'Test description',
        state: 'active',
        products_count: 5,
      };

      mockBrandsService.findOne.mockResolvedValue(expectedBrand);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedBrand,
      });

      const result = await controller.findOne(brandId);

      expect(service.findOne).toHaveBeenCalledWith(brandId, {
        includeInactive: false,
      });
      expect(responseService.success).toHaveBeenCalledWith(
        expectedBrand,
        'Marca obtenida exitosamente',
      );
      expect((result as any).data).toEqual(expectedBrand);
    });

    it('should return brand including inactive when requested', async () => {
      const brandId = 1;
      const expectedBrand = {
        id: 1,
        name: 'Inactive Brand',
        state: 'inactive',
        products_count: 0,
      };

      mockBrandsService.findOne.mockResolvedValue(expectedBrand);
      mockResponseService.success.mockReturnValue({
        success: true,
        data: expectedBrand,
      });

      const result = await controller.findOne(brandId, 'true');

      expect(service.findOne).toHaveBeenCalledWith(brandId, {
        includeInactive: true,
      });
      expect((result as any).data.state).toBe('inactive');
    });

    it('should handle brand not found', async () => {
      const nonExistentId = 999;
      mockBrandsService.findOne.mockRejectedValue(new Error('Brand not found'));
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al obtener marca',
        error: 'Brand not found',
      });

      const result = await controller.findOne(nonExistentId);

      expect(result.success).toBe(false);
    });
  });

  describe('UPDATE BRAND', () => {
    const updateBrandDto: UpdateBrandDto = {
      name: 'Updated Brand Name',
      description: 'Updated description',
      logo_url: 'https://example.com/updated-logo.png',
    };

    it('should update a brand successfully', async () => {
      const brandId = 1;
      const updatedBrand = {
        id: 1,
        ...updateBrandDto,
        state: 'active',
        updated_at: new Date(),
      };

      mockBrandsService.update.mockResolvedValue(updatedBrand);
      mockResponseService.updated.mockReturnValue({
        success: true,
        data: updatedBrand,
      });

      const result = await controller.update(
        brandId,
        updateBrandDto,
        mockRequest,
      );

      expect(service.update).toHaveBeenCalledWith(
        brandId,
        updateBrandDto,
        mockRequest.user,
      );
      expect(responseService.updated).toHaveBeenCalledWith(
        updatedBrand,
        'Marca actualizada exitosamente',
      );
      expect((result as any).data.name).toBe('Updated Brand Name');
    });

    it('should update brand with partial data', async () => {
      const brandId = 1;
      const partialUpdate: UpdateBrandDto = {
        description: 'New description only',
      };

      const updatedBrand = {
        id: 1,
        name: 'Original Name',
        description: 'New description only',
        state: 'active',
      };

      mockBrandsService.update.mockResolvedValue(updatedBrand);
      mockResponseService.updated.mockReturnValue({
        success: true,
        data: updatedBrand,
      });

      const result = await controller.update(
        brandId,
        partialUpdate,
        mockRequest,
      );

      expect((result as any).data.description).toBe('New description only');
      expect((result as any).data.name).toBe('Original Name'); // Should remain unchanged
    });

    it('should handle duplicate name on update', async () => {
      const brandId = 1;
      const duplicateNameUpdate: UpdateBrandDto = {
        name: 'Existing Brand Name',
      };

      mockBrandsService.update.mockRejectedValue(
        new Error('Brand name already exists'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al actualizar marca',
        error: 'Brand name already exists',
      });

      const result = await controller.update(
        brandId,
        duplicateNameUpdate,
        mockRequest,
      );

      expect(result.success).toBe(false);
    });
  });

  describe('DELETE BRAND', () => {
    it('should delete a brand successfully (soft delete)', async () => {
      const brandId = 1;
      mockBrandsService.remove.mockResolvedValue(undefined);
      mockResponseService.deleted.mockReturnValue({
        success: true,
        message: 'Marca eliminada exitosamente',
      });

      const result = await controller.remove(brandId, mockRequest);

      expect(service.remove).toHaveBeenCalledWith(brandId, mockRequest.user);
      expect(responseService.deleted).toHaveBeenCalledWith(
        'Marca eliminada exitosamente',
      );
      expect(result.success).toBe(true);
    });

    it('should handle brand with associated products error', async () => {
      const brandId = 1;
      mockBrandsService.remove.mockRejectedValue(
        new Error('Cannot delete brand with associated products'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al eliminar marca',
        error: 'Cannot delete brand with associated products',
      });

      const result = await controller.remove(brandId, mockRequest);

      expect(result.success).toBe(false);
    });

    it('should handle brand not found error', async () => {
      const nonExistentId = 999;
      mockBrandsService.remove.mockRejectedValue(new Error('Brand not found'));
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al eliminar marca',
        error: 'Brand not found',
      });

      const result = await controller.remove(nonExistentId, mockRequest);

      expect(result.success).toBe(false);
    });
  });

  describe('ADVANCED SCENARIOS', () => {
    it('should handle complex search with sorting and pagination', async () => {
      const complexQuery: BrandQueryDto = {
        search: 'sport',
        sort_by: 'name',
        sort_order: 'desc',
        page: 2,
        limit: 25,
      };

      const mockResponse = {
        data: [
          {
            id: 1,
            name: 'Sportswear Brand',
            state: 'active',
            products_count: 12,
          },
        ],
        meta: {
          total: 1,
          page: 2,
          limit: 25,
          totalPages: 1,
        },
      };

      mockBrandsService.findAll.mockResolvedValue(mockResponse);
      mockResponseService.paginated.mockReturnValue({
        success: true,
        data: mockResponse.data,
        meta: mockResponse.meta,
      });

      const result = await controller.findAll(complexQuery);

      expect(service.findAll).toHaveBeenCalledWith(complexQuery);
      expect((result as any).meta.page).toBe(2);
      expect((result as any).meta.limit).toBe(25);
    });

    it('should handle brand creation with invalid logo URL validation', async () => {
      const invalidBrandDto: CreateBrandDto = {
        name: 'Brand with invalid logo',
        logo_url: 'not-a-valid-url',
      };

      mockBrandsService.create.mockRejectedValue(
        new Error('logo_url must be a valid URL'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al crear marca',
        error: 'logo_url must be a valid URL',
      });

      const result = await controller.create(invalidBrandDto, mockRequest);

      expect(result.success).toBe(false);
      expect((result as any).error).toContain('valid URL');
    });

    it('should handle concurrent brand creation conflicts', async () => {
      const concurrentBrandDto: CreateBrandDto = {
        name: 'Popular Brand',
      };

      mockBrandsService.create.mockRejectedValue(
        new Error('Database conflict: Brand already exists'),
      );
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al crear marca',
        error: 'Database conflict: Brand already exists',
      });

      const result = await controller.create(concurrentBrandDto, mockRequest);

      expect(result.success).toBe(false);
    });
  });

  describe('ERROR HANDLING INTEGRATION', () => {
    it('should handle Prisma P2002 error (unique constraint)', async () => {
      const duplicateDto: CreateBrandDto = {
        name: 'Duplicate Brand',
      };

      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint failed on the field: `name`',
      };

      mockBrandsService.create.mockRejectedValue(prismaError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al crear marca',
        error: prismaError.message,
      });

      const result = await controller.create(duplicateDto, mockRequest);

      expect(result.success).toBe(false);
      expect((result as any).error).toContain('Unique constraint failed');
    });

    it('should handle Prisma P2025 error (record not found)', async () => {
      const nonExistentId = 999;
      const prismaError = {
        code: 'P2025',
        message: 'Record to update not found',
      };

      mockBrandsService.update.mockRejectedValue(prismaError);
      mockResponseService.error.mockReturnValue({
        success: false,
        message: 'Error al actualizar marca',
        error: prismaError.message,
      });

      const result = await controller.update(nonExistentId, {}, mockRequest);

      expect(result.success).toBe(false);
      expect((result as any).error).toContain('Record to update not found');
    });
  });
});
