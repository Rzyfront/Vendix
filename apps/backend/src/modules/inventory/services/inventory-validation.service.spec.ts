import { Test, TestingModule } from '@nestjs/testing';
import { InventoryValidationService } from './inventory-validation.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ValidateConsolidatedStockDto } from '../dto/validate-consolidated-stock.dto';
import { ValidateMultipleConsolidatedStockDto } from '../dto/validate-multiple-consolidated-stock.dto';

describe('InventoryValidationService', () => {
  let service: InventoryValidationService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockStockLevels = [
    {
      id: 1,
      product_id: 1,
      location_id: 1,
      quantity_available: 50,
      quantity_reserved: 10,
      quantity_on_hand: 60,
      last_updated: new Date('2024-01-01T10:00:00Z'),
      created_at: new Date('2024-01-01T09:00:00Z'),
      updated_at: new Date('2024-01-01T10:00:00Z'),
      inventory_locations: {
        id: 1,
        name: 'Main Warehouse',
        type: 'warehouse',
      },
    },
    {
      id: 2,
      product_id: 1,
      location_id: 2,
      quantity_available: 30,
      quantity_reserved: 5,
      quantity_on_hand: 35,
      last_updated: new Date('2024-01-01T11:00:00Z'),
      created_at: new Date('2024-01-01T09:00:00Z'),
      updated_at: new Date('2024-01-01T11:00:00Z'),
      inventory_locations: {
        id: 2,
        name: 'Secondary Warehouse',
        type: 'warehouse',
      },
    },
    {
      id: 3,
      product_id: 1,
      location_id: 3,
      quantity_available: 0,
      quantity_reserved: 0,
      quantity_on_hand: 0,
      last_updated: new Date('2024-01-01T12:00:00Z'),
      created_at: new Date('2024-01-01T09:00:00Z'),
      updated_at: new Date('2024-01-01T12:00:00Z'),
      inventory_locations: {
        id: 3,
        name: 'Retail Store',
        type: 'store',
      },
    },
  ];

  const mockStockLevelsProduct2 = [
    {
      id: 4,
      product_id: 2,
      location_id: 1,
      quantity_available: 20,
      quantity_reserved: 5,
      quantity_on_hand: 25,
      last_updated: new Date('2024-01-01T10:00:00Z'),
      created_at: new Date('2024-01-01T09:00:00Z'),
      updated_at: new Date('2024-01-01T10:00:00Z'),
      inventory_locations: {
        id: 1,
        name: 'Main Warehouse',
        type: 'warehouse',
      },
    },
  ];

  beforeEach(async () => {
    const mockPrismaService = {
      stock_levels: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryValidationService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<InventoryValidationService>(
      InventoryValidationService,
    );
    prismaService = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateConsolidatedStock', () => {
    const validateDto: ValidateConsolidatedStockDto = {
      product_id: 1,
      quantity: 60,
      organization_id: 1,
    };

    it('should validate successfully with sufficient stock', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock(validateDto);

      expect(result.isAvailable).toBe(true);
      expect(result.totalAvailable).toBe(80); // 50 + 30
      expect(result.totalReserved).toBe(15); // 10 + 5
      expect(result.totalOnHand).toBe(95); // 60 + 35
      expect(result.requested).toBe(60);
      expect(result.locations).toHaveLength(3);
      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 },
        { locationId: 2, quantity: 10 },
      ]);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: {
          product_id: 1,
          inventory_locations: {
            organization_id: 1,
          },
        },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });
    });

    it('should fail validation with insufficient stock', async () => {
      const insufficientStockDto = { ...validateDto, quantity: 100 };
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result =
        await service.validateConsolidatedStock(insufficientStockDto);

      expect(result.isAvailable).toBe(false);
      expect(result.totalAvailable).toBe(80);
      expect(result.requested).toBe(100);
      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 },
        { locationId: 2, quantity: 30 },
      ]);
    });

    it('should calculate totals correctly with zero values', async () => {
      const zeroStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 0,
          quantity_reserved: 0,
          quantity_on_hand: 0,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(zeroStockLevels);

      const result = await service.validateConsolidatedStock({
        ...validateDto,
        quantity: 1,
      });

      expect(result.totalAvailable).toBe(0);
      expect(result.totalReserved).toBe(0);
      expect(result.totalOnHand).toBe(0);
      expect(result.isAvailable).toBe(false);
      expect(result.suggestedAllocation).toBeNull();
    });

    it('should provide optimal allocation suggestion', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock({
        ...validateDto,
        quantity: 70,
      });

      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 }, // Highest available first
        { locationId: 2, quantity: 20 }, // Remaining from second highest
      ]);
    });

    it('should filter by organization_id when provided', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      await service.validateConsolidatedStock(validateDto);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            product_id: 1,
            inventory_locations: {
              organization_id: 1,
            },
          },
        }),
      );
    });

    it('should work without organization_id filter', async () => {
      const dtoWithoutOrg = { product_id: 1, quantity: 50 };
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      await service.validateConsolidatedStock(dtoWithoutOrg);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: {
          product_id: 1,
        },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });
    });

    it('should format locations correctly', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock(validateDto);

      expect(result.locations).toEqual([
        {
          locationId: 1,
          locationName: 'Main Warehouse',
          available: 50,
          reserved: 10,
          onHand: 60,
          type: 'warehouse',
        },
        {
          locationId: 2,
          locationName: 'Secondary Warehouse',
          available: 30,
          reserved: 5,
          onHand: 35,
          type: 'warehouse',
        },
        {
          locationId: 3,
          locationName: 'Retail Store',
          available: 0,
          reserved: 0,
          onHand: 0,
          type: 'store',
        },
      ]);
    });

    it('should handle null values in stock quantities', async () => {
      const stockLevelsWithNulls = [
        {
          ...mockStockLevels[0],
          quantity_available: null,
          quantity_reserved: null,
          quantity_on_hand: null,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(
        stockLevelsWithNulls,
      );

      const result = await service.validateConsolidatedStock(validateDto);

      expect(result.totalAvailable).toBe(0);
      expect(result.totalReserved).toBe(0);
      expect(result.totalOnHand).toBe(0);
      expect(result.locations[0].available).toBe(0);
      expect(result.locations[0].reserved).toBe(0);
      expect(result.locations[0].onHand).toBe(0);
    });

    it('should return null suggestedAllocation when no stock available', async () => {
      const emptyStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 0,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(emptyStockLevels);

      const result = await service.validateConsolidatedStock(validateDto);

      expect(result.suggestedAllocation).toBeNull();
    });
  });

  describe('validateMultipleConsolidatedStock', () => {
    const validateMultipleDto: ValidateMultipleConsolidatedStockDto = {
      products: [
        { product_id: 1, quantity: 60 },
        { product_id: 2, quantity: 15 },
      ],
      organization_id: 1,
    };

    it('should handle multiple products with some insufficient stock', async () => {
      const insufficientStockLevels = [
        {
          ...mockStockLevelsProduct2[0],
          quantity_available: 10,
        },
      ];

      const mockFindMany = prismaService.stock_levels.findMany as jest.Mock;
      mockFindMany
        .mockResolvedValueOnce(mockStockLevels)
        .mockResolvedValueOnce(insufficientStockLevels);

      const result =
        await service.validateMultipleConsolidatedStock(validateMultipleDto);

      expect(result.orderFeasible).toBe(false);
      expect(result.summary.totalProductsAvailable).toBe(1);
      expect(result.products[0].isAvailable).toBe(true);
      expect(result.products[1].isAvailable).toBe(false);
    });

    it('should calculate summary correctly', async () => {
      const mockFindMany = prismaService.stock_levels.findMany as jest.Mock;
      mockFindMany
        .mockResolvedValueOnce(mockStockLevels)
        .mockResolvedValueOnce(mockStockLevelsProduct2);

      const result =
        await service.validateMultipleConsolidatedStock(validateMultipleDto);

      expect(result.summary).toEqual({
        totalProductsRequested: 2,
        totalProductsAvailable: 2,
        totalQuantityRequested: 75,
        totalQuantityAvailable: 100,
      });
    });

    it('should evaluate order feasibility correctly', async () => {
      const insufficientStockLevels = [
        {
          ...mockStockLevelsProduct2[0],
          quantity_available: 5,
        },
      ];

      const mockFindMany = prismaService.stock_levels.findMany as jest.Mock;
      mockFindMany
        .mockResolvedValueOnce(mockStockLevels)
        .mockResolvedValueOnce(insufficientStockLevels);

      const result =
        await service.validateMultipleConsolidatedStock(validateMultipleDto);

      expect(result.orderFeasible).toBe(false);
      expect(result.products.every((p) => p.isAvailable)).toBe(false);
    });

    it('should use Promise.all for parallel validation', async () => {
      const startTime = Date.now();

      const mockFindMany = prismaService.stock_levels.findMany as jest.Mock;
      mockFindMany
        .mockResolvedValueOnce(mockStockLevels)
        .mockResolvedValueOnce(mockStockLevelsProduct2);

      await service.validateMultipleConsolidatedStock(validateMultipleDto);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should be fast due to parallel execution
      expect(executionTime).toBeLessThan(100);
      expect(prismaService.stock_levels.findMany).toHaveBeenCalledTimes(2);
    });

    it('should work without organization_id', async () => {
      const dtoWithoutOrg = {
        products: [{ product_id: 1, quantity: 50 }],
      };

      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      await service.validateMultipleConsolidatedStock(dtoWithoutOrg);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: {
          product_id: 1,
        },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });
    });
  });

  describe('calculateOptimalAllocation (private method)', () => {
    it('should allocate from locations with highest stock first', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 70,
      });

      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 }, // Highest available (50)
        { locationId: 2, quantity: 20 }, // Second highest (30)
      ]);
    });

    it('should handle insufficient total stock', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 100,
      });

      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 },
        { locationId: 2, quantity: 30 },
      ]);
    });

    it('should skip locations with zero available stock', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 10,
      });

      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 10 },
      ]);
      expect(result.suggestedAllocation?.some((a) => a.locationId === 3)).toBe(
        false,
      );
    });

    it('should handle exact quantity match', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 80,
      });

      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 50 },
        { locationId: 2, quantity: 30 },
      ]);
    });

    it('should return empty allocation when no stock available', async () => {
      const emptyStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 0,
        },
        {
          ...mockStockLevels[1],
          quantity_available: 0,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(emptyStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 10,
      });

      expect(result.suggestedAllocation).toBeNull();
    });
  });

  describe('Edge cases and validations', () => {
    it('should handle products without stock levels', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue([]);

      const result = await service.validateConsolidatedStock({
        product_id: 999,
        quantity: 10,
      });

      expect(result.isAvailable).toBe(false);
      expect(result.totalAvailable).toBe(0);
      expect(result.totalReserved).toBe(0);
      expect(result.totalOnHand).toBe(0);
      expect(result.locations).toHaveLength(0);
      expect(result.suggestedAllocation).toBeNull();
    });

    it('should handle decimal quantities', async () => {
      const decimalStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 25.5,
          quantity_reserved: 2.5,
          quantity_on_hand: 28,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(decimalStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 20.5,
      });

      expect(result.totalAvailable).toBe(25.5);
      expect(result.totalReserved).toBe(2.5);
      expect(result.isAvailable).toBe(true);
      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 20.5 },
      ]);
    });

    it('should handle negative values (edge case)', async () => {
      const negativeStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: -10,
          quantity_reserved: -5,
          quantity_on_hand: -15,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(
        negativeStockLevels,
      );

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 5,
      });

      expect(result.totalAvailable).toBe(-10);
      expect(result.totalReserved).toBe(-5);
      expect(result.isAvailable).toBe(false);
    });

    it('should handle organization with no locations', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue([]);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 10,
        organization_id: 999,
      });

      expect(result.isAvailable).toBe(false);
      expect(result.locations).toHaveLength(0);
      expect(result.suggestedAllocation).toBeNull();
    });

    it('should handle very large quantities', async () => {
      const largeStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 1000000,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(largeStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 999999,
      });

      expect(result.isAvailable).toBe(true);
      expect(result.totalAvailable).toBe(1000000);
      expect(result.suggestedAllocation).toEqual([
        { locationId: 1, quantity: 999999 },
      ]);
    });

    it('should handle mixed null and valid values', async () => {
      const mixedStockLevels = [
        {
          ...mockStockLevels[0],
          quantity_available: 50,
          quantity_reserved: null,
          quantity_on_hand: 50,
        },
        {
          ...mockStockLevels[1],
          quantity_available: null,
          quantity_reserved: 5,
          quantity_on_hand: null,
        },
      ];
      prismaService.stock_levels.findMany.mockResolvedValue(mixedStockLevels);

      const result = await service.validateConsolidatedStock({
        product_id: 1,
        quantity: 40,
      });

      expect(result.totalAvailable).toBe(50);
      expect(result.totalReserved).toBe(5);
      expect(result.totalOnHand).toBe(50);
      expect(result.isAvailable).toBe(true);
    });
  });
});
