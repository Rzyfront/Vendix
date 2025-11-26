import { Test, TestingModule } from '@nestjs/testing';
import {
  StockLevelManager,
  UpdateStockParams,
} from './stock-level-manager.service';
import { PrismaService } from '../../../../prisma/prisma.service';
import { InventoryTransactionsService } from '../../transactions/inventory-transactions.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { InventoryTransaction } from '../../transactions/interfaces/inventory-transaction.interface';

describe('StockLevelManager', () => {
  let service: StockLevelManager;
  let prismaService: jest.Mocked<PrismaService>;
  let transactionsService: jest.Mocked<InventoryTransactionsService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockContext = {
    organization_id: 1,
    user_id: 1,
    is_super_admin: false,
    is_owner: false,
  };

  const updateStockParams: UpdateStockParams = {
    product_id: 1,
    location_id: 1,
    quantity_change: 50,
    movement_type: 'stock_in',
    reason: 'Initial stock',
    user_id: 1,
    create_movement: true,
  };

  const mockStockLevel = {
    id: 1,
    product_id: 1,
    product_variant_id: null,
    location_id: 1,
    quantity_on_hand: 100,
    quantity_reserved: 10,
    quantity_available: 90,
    last_updated: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockTransaction: InventoryTransaction = {
    id: 1,
    product_id: 1,
    product_variant_id: null,
    user_id: 1,
    order_item_id: null,
    type: 'stock_in',
    notes: 'Test transaction',
    transaction_date: new Date(),
    quantity_change: 50,
    created_at: new Date(),
  };

  const mockProduct = {
    id: 1,
    name: 'Test Product',
    sku: 'TEST-001',
    stock_quantity: 100,
    stores: {
      organization_id: 1,
    },
  };

  const mockLocation = {
    id: 1,
    name: 'Main Warehouse',
    code: 'WH-001',
    organization_id: 1,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      $transaction: jest.fn(),
      stock_levels: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn(),
      },
      products: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      inventory_locations: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      stock_reservations: {
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      inventory_movements: {
        create: jest.fn(),
      },
    };

    const mockTransactionsService = {
      createTransaction: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLevelManager,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: InventoryTransactionsService,
          useValue: mockTransactionsService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<StockLevelManager>(StockLevelManager);
    prismaService = module.get(PrismaService);
    transactionsService = module.get(InventoryTransactionsService);
    eventEmitter = module.get(EventEmitter2);

    // Mock RequestContextService
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(mockContext);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateStock', () => {
    it('should update stock successfully with stock_in movement', async () => {
      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue({
        ...mockStockLevel,
        quantity_on_hand: 150,
        quantity_available: 140,
      });
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 140 },
      });

      const result = await service.updateStock(updateStockParams);

      expect(result).toEqual({
        stock_level: expect.objectContaining({
          quantity_on_hand: 150,
          quantity_available: 140,
        }),
        transaction: mockTransaction,
        previous_quantity: 90,
      });

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'stock.updated',
        expect.objectContaining({
          product_id: 1,
          location_id: 1,
          new_quantity: 140,
          transaction_id: 1,
          movement_type: 'stock_in',
          user_id: 1,
        }),
      );
    });

    it('should handle stock_out movement with availability validation', async () => {
      const stockOutParams = {
        ...updateStockParams,
        quantity_change: -30,
        movement_type: 'stock_out' as const,
        validate_availability: true,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue({
        ...mockStockLevel,
        quantity_on_hand: 70,
        quantity_available: 60,
      });
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 60 },
      });

      const result = await service.updateStock(stockOutParams);

      expect(result.stock_level.quantity_on_hand).toBe(70);
      expect(result.stock_level.quantity_available).toBe(60);
    });

    it('should throw ConflictException when insufficient stock available', async () => {
      const stockOutParams = {
        ...updateStockParams,
        quantity_change: -100,
        movement_type: 'stock_out' as const,
        validate_availability: true,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);

      await expect(service.updateStock(stockOutParams)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should handle sale movement type correctly', async () => {
      const saleParams = {
        ...updateStockParams,
        quantity_change: -20,
        movement_type: 'sale' as const,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue({
        ...mockStockLevel,
        quantity_on_hand: 80,
        quantity_available: 70, // Should be reduced by sale amount
      });
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 70 },
      });

      const result = await service.updateStock(saleParams);

      expect(result.stock_level.quantity_available).toBe(70);
    });

    it('should work with external transaction client', async () => {
      const externalTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 90 },
      });

      const result = await service.updateStock(
        updateStockParams,
        externalTx as any,
      );

      expect(result).toBeDefined();
      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when organization context is missing', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        is_super_admin: false,
        is_owner: false,
      });

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );

      await expect(service.updateStock(updateStockParams)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('reserveStock', () => {
    const reserveParams = {
      product_id: 1,
      variant_id: undefined,
      location_id: 1,
      quantity: 20,
      reserved_for_type: 'order' as const,
      reserved_for_id: 1,
      user_id: 1,
    };

    it('should reserve stock successfully', async () => {
      const mockTx = {
        stock_levels: prismaService.stock_levels,
        stock_reservations: prismaService.stock_reservations,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_reservations.create.mockResolvedValue({ id: 1 });
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);

      await expect(
        service.reserveStock(
          reserveParams.product_id,
          reserveParams.variant_id,
          reserveParams.location_id,
          reserveParams.quantity,
          reserveParams.reserved_for_type,
          reserveParams.reserved_for_id,
          reserveParams.user_id,
        ),
      ).resolves.not.toThrow();

      expect(prismaService.stock_reservations.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          product_id: 1,
          location_id: 1,
          quantity: 20,
          reserved_for_type: 'order',
          reserved_for_id: 1,
          status: 'active',
        }),
      });
    });

    it('should throw ConflictException when insufficient stock for reservation', async () => {
      const insufficientStockParams = {
        ...reserveParams,
        quantity: 100, // More than available (90)
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        stock_reservations: prismaService.stock_reservations,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);

      await expect(
        service.reserveStock(
          insufficientStockParams.product_id,
          insufficientStockParams.variant_id,
          insufficientStockParams.location_id,
          insufficientStockParams.quantity,
          insufficientStockParams.reserved_for_type,
          insufficientStockParams.reserved_for_id,
          insufficientStockParams.user_id,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should handle transfer reservations', async () => {
      const transferParams = {
        ...reserveParams,
        reserved_for_type: 'transfer' as const,
        reserved_for_id: 2,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        stock_reservations: prismaService.stock_reservations,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_reservations.create.mockResolvedValue({ id: 1 });
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);

      await expect(
        service.reserveStock(
          transferParams.product_id,
          transferParams.variant_id,
          transferParams.location_id,
          transferParams.quantity,
          transferParams.reserved_for_type,
          transferParams.reserved_for_id,
          transferParams.user_id,
        ),
      ).resolves.not.toThrow();

      expect(prismaService.stock_reservations.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          product_id: 1,
          location_id: 1,
          quantity: 20,
          reserved_for_type: 'transfer',
          reserved_for_id: 2,
          status: 'active',
          user_id: 1,
        }),
      });
    });
  });

  describe('releaseReservation', () => {
    const releaseParams = {
      product_id: 1,
      variant_id: undefined,
      location_id: 1,
      reserved_for_type: 'order' as const,
      reserved_for_id: 1,
    };

    it('should release reservation successfully', async () => {
      const mockReservations = [
        {
          id: 1,
          quantity: 20,
          status: 'active',
        },
        {
          id: 2,
          quantity: 10,
          status: 'active',
        },
      ];

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        stock_reservations: prismaService.stock_reservations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.stock_reservations.findMany.mockResolvedValue(
        mockReservations,
      );
      prismaService.stock_reservations.updateMany.mockResolvedValue({
        count: 2,
      });
      prismaService.stock_levels.findUnique.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);

      await expect(
        service.releaseReservation(
          releaseParams.product_id,
          releaseParams.variant_id,
          releaseParams.location_id,
          releaseParams.reserved_for_type,
          releaseParams.reserved_for_id,
        ),
      ).resolves.not.toThrow();

      expect(prismaService.stock_reservations.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { status: 'consumed', updated_at: expect.any(Date) },
      });

      expect(prismaService.stock_levels.update).toHaveBeenCalledWith({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: 1,
            product_variant_id: null,
            location_id: 1,
          },
        },
        data: {
          quantity_reserved: 0,
          quantity_available: 120,
          last_updated: expect.any(Date),
          updated_at: expect.any(Date),
        },
      });
    });

    it('should handle case when no reservations exist', async () => {
      const mockTx = {
        stock_levels: prismaService.stock_levels,
        stock_reservations: prismaService.stock_reservations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.stock_reservations.findMany.mockResolvedValue([]);

      await expect(
        service.releaseReservation(
          releaseParams.product_id,
          releaseParams.variant_id,
          releaseParams.location_id,
          releaseParams.reserved_for_type,
          releaseParams.reserved_for_id,
        ),
      ).resolves.not.toThrow();

      expect(
        prismaService.stock_reservations.updateMany,
      ).not.toHaveBeenCalled();
      expect(prismaService.stock_levels.update).not.toHaveBeenCalled();
    });
  });

  describe('initializeStockLevelsForProduct', () => {
    it('should initialize stock levels for all locations', async () => {
      const mockLocations = [
        { id: 1, name: 'Warehouse 1' },
        { id: 2, name: 'Warehouse 2' },
      ];

      prismaService.inventory_locations.findMany.mockResolvedValue(
        mockLocations,
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(null);
      prismaService.stock_levels.create.mockResolvedValue(mockStockLevel);

      await service.initializeStockLevelsForProduct(1, 1);

      expect(prismaService.stock_levels.create).toHaveBeenCalledTimes(2);
      expect(prismaService.inventory_locations.findMany).toHaveBeenCalledWith({
        where: { organization_id: 1 },
      });
    });

    it('should use existing stock levels if they exist', async () => {
      const mockLocations = [{ id: 1, name: 'Warehouse 1' }];

      prismaService.inventory_locations.findMany.mockResolvedValue(
        mockLocations,
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);

      await service.initializeStockLevelsForProduct(1, 1);

      expect(prismaService.stock_levels.create).not.toHaveBeenCalled();
    });

    it('should work with external transaction', async () => {
      const externalTx = {
        inventory_locations: prismaService.inventory_locations,
        stock_levels: prismaService.stock_levels,
        products: prismaService.products,
      };

      prismaService.inventory_locations.findMany.mockResolvedValue([{ id: 1 }]);
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);

      await service.initializeStockLevelsForProduct(1, 1, externalTx as any);

      expect(prismaService.inventory_locations.findMany).toHaveBeenCalled();
    });
  });

  describe('getStockLevels', () => {
    it('should return stock levels for product', async () => {
      const mockStockLevels = [
        {
          ...mockStockLevel,
          inventory_locations: {
            id: 1,
            name: 'Main Warehouse',
            code: 'WH-001',
          },
        },
      ];

      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.getStockLevels(1);

      expect(result).toEqual(mockStockLevels);
      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: { product_id: 1 },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });
    });

    it('should filter by variant_id when provided', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue([]);

      await service.getStockLevels(1, 2);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: { product_id: 1, product_variant_id: 2 },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });
    });
  });

  describe('checkReorderPoints', () => {
    it('should return products below reorder point', async () => {
      const mockStockLevels = [
        {
          ...mockStockLevel,
          quantity_available: 5,
          reorder_point: 10,
          inventory_locations: {
            id: 1,
            name: 'Main Warehouse',
            code: 'WH-001',
          },
        },
        {
          ...mockStockLevel,
          id: 2,
          quantity_available: 15,
          reorder_point: 10,
          inventory_locations: {
            id: 2,
            name: 'Secondary Warehouse',
            code: 'WH-002',
          },
        },
      ];

      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.checkReorderPoints(1);

      expect(result).toHaveLength(1);
      expect(result[0].quantity_available).toBe(5);
      expect(result[0].reorder_point).toBe(10);
    });

    it('should return empty array when no products need reorder', async () => {
      const mockStockLevels = [
        {
          ...mockStockLevel,
          quantity_available: 20,
          reorder_point: 10,
          inventory_locations: {
            id: 1,
            name: 'Main Warehouse',
            code: 'WH-001',
          },
        },
      ];

      prismaService.stock_levels.findMany.mockResolvedValue(mockStockLevels);

      const result = await service.checkReorderPoints(1);

      expect(result).toHaveLength(0);
    });

    it('should only check stock levels with reorder points set', async () => {
      prismaService.stock_levels.findMany.mockResolvedValue([]);

      await service.checkReorderPoints(1);

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith({
        where: {
          product_id: 1,
          reorder_point: { not: null },
        },
        include: {
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });
    });
  });

  describe('Private methods and edge cases', () => {
    it('should handle super admin context correctly', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        is_super_admin: true,
        is_owner: false,
      });

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 90 },
      });

      await service.updateStock({
        product_id: 1,
        location_id: 1,
        quantity_change: 10,
        movement_type: 'stock_in',
      });

      expect(prismaService.products.findFirst).not.toHaveBeenCalled();
      expect(
        prismaService.inventory_locations.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('should validate product scope for non-super admin', async () => {
      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(null); // Product not in scope

      await expect(
        service.updateStock({
          product_id: 1,
          location_id: 1,
          quantity_change: 10,
          movement_type: 'stock_in',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate location scope for non-super admin', async () => {
      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(null); // Location not in scope

      await expect(
        service.updateStock({
          product_id: 1,
          location_id: 1,
          quantity_change: 10,
          movement_type: 'stock_in',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map initial movement type to stock_in for movements', async () => {
      const initialParams = {
        ...updateStockParams,
        movement_type: 'initial' as const,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 90 },
      });

      await service.updateStock(initialParams);

      expect(prismaService.inventory_movements.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          movement_type: 'stock_in', // Should be mapped from 'initial'
        }),
      });
    });

    it('should handle adjustment movement type mapping', async () => {
      const adjustmentParams = {
        ...updateStockParams,
        movement_type: 'adjustment' as const,
      };

      const mockTx = {
        stock_levels: prismaService.stock_levels,
        inventory_movements: prismaService.inventory_movements,
        products: prismaService.products,
        inventory_locations: prismaService.inventory_locations,
      };

      prismaService.$transaction.mockImplementation((callback) =>
        callback(mockTx),
      );
      prismaService.products.findFirst.mockResolvedValue(mockProduct);
      prismaService.inventory_locations.findFirst.mockResolvedValue(
        mockLocation,
      );
      prismaService.stock_levels.findFirst.mockResolvedValue(mockStockLevel);
      prismaService.stock_levels.update.mockResolvedValue(mockStockLevel);
      transactionsService.createTransaction.mockResolvedValue(mockTransaction);
      prismaService.products.update.mockResolvedValue(mockProduct);
      prismaService.stock_levels.aggregate.mockResolvedValue({
        _sum: { quantity_available: 90 },
      });

      await service.updateStock(adjustmentParams);

      expect(transactionsService.createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'adjustment_damage', // Should be mapped from 'adjustment'
        }),
        expect.any(Object),
      );
    });
  });
});
