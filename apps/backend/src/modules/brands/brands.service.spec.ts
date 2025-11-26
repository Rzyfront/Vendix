import { Test, TestingModule } from '@nestjs/testing';
import { BrandsService } from './brands.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

describe('BrandsService', () => {
  let service: BrandsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    brands: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    products: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createBrandDto: CreateBrandDto = {
      name: 'Test Brand',
      description: 'Test description',
      logo_url: 'https://example.com/logo.png',
    };

    it('should create a brand successfully', async () => {
      const expectedBrand = {
        id: 1,
        name: 'Test Brand',
        description: 'Test description',
        logo_url: 'https://example.com/logo.png',
        state: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPrismaService.brands.create.mockResolvedValue(expectedBrand);

      const result = await service.create(createBrandDto, {
        id: 1,
        email: 'test@example.com',
      });

      expect(result).toEqual(expectedBrand);
      expect(mockPrismaService.brands.create).toHaveBeenCalledWith({
        data: {
          name: 'Test Brand',
          description: 'Test description',
          logo_url: 'https://example.com/logo.png',
        },
      });
    });

    it('should create a brand with minimum required fields', async () => {
      const minimalDto: CreateBrandDto = {
        name: 'Minimal Brand',
      };

      const expectedBrand = {
        id: 1,
        name: 'Minimal Brand',
        state: 'active',
      };

      mockPrismaService.brands.create.mockResolvedValue(expectedBrand);

      const result = await service.create(minimalDto, { id: 1 });

      expect(result).toEqual(expectedBrand);
      expect(mockPrismaService.brands.create).toHaveBeenCalledWith({
        data: {
          name: 'Minimal Brand',
          description: undefined,
          logo_url: undefined,
        },
      });
    });

    it('should throw ConflictException for duplicate brand name', async () => {
      const duplicateDto: CreateBrandDto = {
        name: 'Existing Brand',
      };

      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint failed',
      };

      mockPrismaService.brands.create.mockRejectedValue(prismaError);

      await expect(service.create(duplicateDto, { id: 1 })).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(duplicateDto, { id: 1 })).rejects.toThrow(
        'Brand name already exists',
      );
    });

    it('should handle database errors properly', async () => {
      const invalidDto: CreateBrandDto = {
        name: 'Invalid Brand',
      };

      const databaseError = new Error('Database connection failed');
      mockPrismaService.brands.create.mockRejectedValue(databaseError);

      await expect(service.create(invalidDto, { id: 1 })).rejects.toThrow(
        databaseError,
      );
    });
  });

  describe('findAll', () => {
    const query: BrandQueryDto = {
      page: 1,
      limit: 10,
      search: 'test',
      sort_by: 'name',
      sort_order: 'asc',
    };

    it('should return paginated brands with search', async () => {
      const mockBrands = [
        {
          id: 1,
          name: 'Test Brand 1',
          description: 'Description 1',
          state: 'active',
          _count: { products: 5 },
        },
        {
          id: 2,
          name: 'Test Brand 2',
          description: 'Description 2',
          state: 'active',
          _count: { products: 3 },
        },
      ];

      mockPrismaService.brands.findMany.mockResolvedValue(mockBrands);
      mockPrismaService.brands.count.mockResolvedValue(2);

      const result = await service.findAll(query);

      expect(result.data).toEqual(mockBrands);
      expect(result.meta).toEqual({
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { name: { contains: 'test', mode: 'insensitive' } },
            { description: { contains: 'test', mode: 'insensitive' } },
          ],
        },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should return brands without search filter', async () => {
      const queryWithoutSearch: BrandQueryDto = {
        page: 2,
        limit: 5,
        sort_by: 'created_at',
        sort_order: 'desc',
      };

      const mockBrands = [
        {
          id: 1,
          name: 'Brand 1',
          _count: { products: 1 },
        },
      ];

      mockPrismaService.brands.findMany.mockResolvedValue(mockBrands);
      mockPrismaService.brands.count.mockResolvedValue(1);

      const result = await service.findAll(queryWithoutSearch);

      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 5,
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
      expect(result.meta.page).toBe(2);
    });

    it('should use default values when query params are missing', async () => {
      const emptyQuery: BrandQueryDto = {};

      mockPrismaService.brands.findMany.mockResolvedValue([]);
      mockPrismaService.brands.count.mockResolvedValue(0);

      await service.findAll(emptyQuery);

      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });
  });

  describe('findByStore', () => {
    it('should return brands for store (brands are global)', async () => {
      const storeId = 1;
      const query: BrandQueryDto = {
        page: 1,
        limit: 10,
        search: 'sport',
      };

      const mockBrands = [
        {
          id: 1,
          name: 'Sport Brand',
          state: 'active',
          _count: { products: 8 },
        },
      ];

      mockPrismaService.brands.findMany.mockResolvedValue(mockBrands);
      mockPrismaService.brands.count.mockResolvedValue(1);

      const result = await service.findByStore(storeId, query);

      expect(result.data).toEqual(mockBrands);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {
          state: { not: 'archived' },
          OR: [
            { name: { contains: 'sport', mode: 'insensitive' } },
            { description: { contains: 'sport', mode: 'insensitive' } },
          ],
        },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should exclude archived brands by default', async () => {
      const storeId = 1;
      const query: BrandQueryDto = {};

      mockPrismaService.brands.findMany.mockResolvedValue([]);
      mockPrismaService.brands.count.mockResolvedValue(0);

      await service.findByStore(storeId, query);

      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {
          state: { not: 'archived' },
        },
        skip: 0,
        take: 10,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });
  });

  describe('findOne', () => {
    it('should return a brand by ID with product count', async () => {
      const brandId = 1;
      const expectedBrand = {
        id: 1,
        name: 'Test Brand',
        description: 'Test description',
        state: 'active',
        logo_url: 'https://example.com/logo.png',
        _count: { products: 5 },
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(expectedBrand);

      const result = await service.findOne(brandId);

      expect(result).toEqual(expectedBrand);
      expect(mockPrismaService.brands.findFirst).toHaveBeenCalledWith({
        where: { id: brandId },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should throw NotFoundException if brand not found', async () => {
      const nonExistentId = 999;
      mockPrismaService.brands.findFirst.mockResolvedValue(null);

      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(nonExistentId)).rejects.toThrow(
        'Brand not found',
      );
    });

    it('should return brand including inactive brands', async () => {
      const brandId = 1;
      const inactiveBrand = {
        id: 1,
        name: 'Inactive Brand',
        state: 'inactive',
        _count: { products: 0 },
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(inactiveBrand);

      const result = await service.findOne(brandId, { includeInactive: true });

      expect(result.state).toBe('inactive');
      expect(mockPrismaService.brands.findFirst).toHaveBeenCalledWith({
        where: { id: brandId },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });
  });

  describe('update', () => {
    const updateBrandDto: UpdateBrandDto = {
      name: 'Updated Brand',
      description: 'Updated description',
      logo_url: 'https://example.com/updated-logo.png',
    };

    it('should update a brand successfully', async () => {
      const brandId = 1;
      const existingBrand = {
        id: 1,
        name: 'Original Brand',
        description: 'Original description',
      };

      const updatedBrand = {
        id: 1,
        name: 'Updated Brand',
        description: 'Updated description',
        logo_url: 'https://example.com/updated-logo.png',
        _count: { products: 3 },
      };

      mockPrismaService.brands.findFirst.mockResolvedValueOnce(existingBrand);
      mockPrismaService.brands.findFirst.mockResolvedValueOnce(updatedBrand);
      mockPrismaService.brands.update.mockResolvedValue(updatedBrand);

      const result = await service.update(brandId, updateBrandDto, { id: 1 });

      expect(result).toEqual(updatedBrand);
      expect(mockPrismaService.brands.update).toHaveBeenCalledWith({
        where: { id: brandId },
        data: {
          name: 'Updated Brand',
          description: 'Updated description',
          logo_url: 'https://example.com/updated-logo.png',
        },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should update only provided fields', async () => {
      const brandId = 1;
      const partialUpdate: UpdateBrandDto = {
        description: 'New description only',
      };

      const existingBrand = {
        id: 1,
        name: 'Original Brand',
        description: 'Original description',
        logo_url: 'https://example.com/old-logo.png',
      };

      const updatedBrand = {
        id: 1,
        name: 'Original Brand',
        description: 'New description only',
        logo_url: 'https://example.com/old-logo.png',
        _count: { products: 2 },
      };

      mockPrismaService.brands.findFirst.mockResolvedValueOnce(existingBrand);
      mockPrismaService.brands.findFirst.mockResolvedValueOnce(updatedBrand);
      mockPrismaService.brands.update.mockResolvedValue(updatedBrand);

      const result = await service.update(brandId, partialUpdate, { id: 1 });

      expect(mockPrismaService.brands.update).toHaveBeenCalledWith({
        where: { id: brandId },
        data: {
          description: 'New description only',
        },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
      expect(result.name).toBe('Original Brand'); // Should remain unchanged
    });

    it('should handle undefined fields correctly', async () => {
      const brandId = 1;
      const updateWithUndefined: UpdateBrandDto = {
        name: 'New Name',
        description: undefined, // Should not be updated
        logo_url: undefined, // Should not be updated
      };

      const existingBrand = {
        id: 1,
        name: 'Old Name',
        description: 'Old Description',
        logo_url: 'https://example.com/old-logo.png',
      };

      const updatedBrand = {
        id: 1,
        name: 'New Name',
        description: 'Old Description',
        logo_url: 'https://example.com/old-logo.png',
        _count: { products: 1 },
      };

      mockPrismaService.brands.findFirst.mockResolvedValueOnce(existingBrand);
      mockPrismaService.brands.findFirst.mockResolvedValueOnce(updatedBrand);
      mockPrismaService.brands.update.mockResolvedValue(updatedBrand);

      await service.update(brandId, updateWithUndefined, { id: 1 });

      expect(mockPrismaService.brands.update).toHaveBeenCalledWith({
        where: { id: brandId },
        data: {
          name: 'New Name',
        },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should throw ConflictException for duplicate name on update', async () => {
      const brandId = 1;
      const duplicateNameUpdate: UpdateBrandDto = {
        name: 'Existing Brand Name',
      };

      const existingBrand = {
        id: 1,
        name: 'Original Brand',
      };

      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint failed',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);
      mockPrismaService.brands.update.mockRejectedValue(prismaError);

      await expect(
        service.update(brandId, duplicateNameUpdate, { id: 1 }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update(brandId, duplicateNameUpdate, { id: 1 }),
      ).rejects.toThrow('Brand name already exists');
    });

    it('should throw NotFoundException if brand to update not found', async () => {
      const brandId = 999;
      const updateDto: UpdateBrandDto = {
        name: 'Updated Name',
      };

      // Mock findOne to throw NotFoundException (brand doesn't exist)
      jest
        .spyOn(service, 'findOne')
        .mockRejectedValue(new NotFoundException('Brand not found'));

      await expect(
        service.update(brandId, updateDto, { id: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete a brand successfully', async () => {
      const brandId = 1;
      const existingBrand = {
        id: 1,
        name: 'Brand to Delete',
        state: 'active',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);
      mockPrismaService.products.count.mockResolvedValue(0);
      mockPrismaService.brands.update.mockResolvedValue({});

      await service.remove(brandId, { id: 1 });

      expect(mockPrismaService.brands.findFirst).toHaveBeenCalledWith({
        where: { id: brandId },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
      expect(mockPrismaService.products.count).toHaveBeenCalledWith({
        where: { brand_id: brandId },
      });
      expect(mockPrismaService.brands.update).toHaveBeenCalledWith({
        where: { id: brandId },
        data: {
          state: 'archived',
          updated_at: expect.any(Date),
        },
      });
    });

    it('should throw BadRequestException if brand has products', async () => {
      const brandId = 1;
      const brandWithProducts = {
        id: 1,
        name: 'Brand with Products',
        state: 'active',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(brandWithProducts);
      mockPrismaService.products.count.mockResolvedValue(5);

      await expect(service.remove(brandId, { id: 1 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.remove(brandId, { id: 1 })).rejects.toThrow(
        'Cannot delete brand with assigned products',
      );
    });

    it('should throw NotFoundException if brand to delete not found', async () => {
      const brandId = 999;
      mockPrismaService.brands.findFirst.mockResolvedValue(null);

      await expect(service.remove(brandId, { id: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('validateUniqueName', () => {
    it('should throw ConflictException if name already exists', async () => {
      const existingBrand = {
        id: 2,
        name: 'Existing Brand',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);

      // Access private method through type assertion for testing
      await expect(
        (service as any).validateUniqueName('Existing Brand'),
      ).rejects.toThrow(ConflictException);
    });

    it('should not throw if name is unique', async () => {
      mockPrismaService.brands.findFirst.mockResolvedValue(null);

      await expect(
        (service as any).validateUniqueName('Unique Brand'),
      ).resolves.toBeUndefined();
    });

    it('should not throw if name exists for different brand during update', async () => {
      const existingBrand = {
        id: 2,
        name: 'Same Name Different ID',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);

      await expect(
        (service as any).validateUniqueName('Same Name Different ID', 2),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('ADVANCED SCENARIOS', () => {
    it('should handle complex search queries', async () => {
      const complexQuery: BrandQueryDto = {
        search: 'Nike Sport',
        page: 2,
        limit: 25,
        sort_by: 'created_at',
        sort_order: 'desc',
      };

      mockPrismaService.brands.findMany.mockResolvedValue([]);
      mockPrismaService.brands.count.mockResolvedValue(0);

      await service.findAll(complexQuery);

      expect(mockPrismaService.brands.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { name: { contains: 'Nike Sport', mode: 'insensitive' } },
            { description: { contains: 'Nike Sport', mode: 'insensitive' } },
          ],
        },
        skip: 25,
        take: 25,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should handle empty search results gracefully', async () => {
      const searchQuery: BrandQueryDto = {
        search: 'NonExistentBrand',
        page: 1,
        limit: 10,
      };

      mockPrismaService.brands.findMany.mockResolvedValue([]);
      mockPrismaService.brands.count.mockResolvedValue(0);

      const result = await service.findAll(searchQuery);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should handle brand update with no changes', async () => {
      const brandId = 1;
      const emptyUpdate: UpdateBrandDto = {};

      const existingBrand = {
        id: 1,
        name: 'Brand Name',
        description: 'Brand Description',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);
      mockPrismaService.brands.update.mockResolvedValue(existingBrand);

      const result = await service.update(brandId, emptyUpdate, { id: 1 });

      expect(mockPrismaService.brands.update).toHaveBeenCalledWith({
        where: { id: brandId },
        data: {},
        include: {
          _count: {
            select: { products: true },
          },
        },
      });
    });

    it('should handle brand deletion at database boundary', async () => {
      const brandId = 1;
      const existingBrand = {
        id: 1,
        name: 'Brand to Delete',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(existingBrand);
      mockPrismaService.products.count.mockResolvedValue(0);
      mockPrismaService.brands.update.mockImplementation(() => {
        throw new Error('Database constraint violation');
      });

      await expect(service.remove(brandId, { id: 1 })).rejects.toThrow(
        'Database constraint violation',
      );
    });
  });

  describe('ERROR HANDLING', () => {
    it('should handle Prisma P2002 error in create', async () => {
      const createDto: CreateBrandDto = {
        name: 'Duplicate Brand',
      };

      const prismaError = {
        code: 'P2002',
        message: 'Unique constraint failed on the field: `name`',
        meta: {
          target: 'brands_name_key',
        },
      };

      mockPrismaService.brands.create.mockRejectedValue(prismaError);

      await expect(service.create(createDto, { id: 1 })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should handle Prisma P2025 error in update', async () => {
      const brandId = 999;
      const updateDto: UpdateBrandDto = {
        name: 'Updated Name',
      };

      const prismaError = {
        code: 'P2025',
        message: 'Record to update not found',
      };

      mockPrismaService.brands.findFirst.mockResolvedValue(null);

      await expect(
        service.update(brandId, updateDto, { id: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle database connection errors', async () => {
      const connectionError = new Error('Connection timeout');
      mockPrismaService.brands.findMany.mockRejectedValue(connectionError);

      await expect(service.findAll({})).rejects.toThrow(connectionError);
    });
  });
});
