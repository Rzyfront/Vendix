import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CostingService } from './costing.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

/**
 * Step 5 — CostingService unit tests.
 *
 * Mirrors the mocking pattern used by stock-level-manager.service.spec.ts:
 *   - StorePrismaService mocked as a plain object with jest.fn() per model.
 *   - RequestContextService.getContext is spied to inject the org context.
 *   - OperatingScopeService is mocked to control the scope branch (STORE vs
 *     ORGANIZATION) used by buildScopedLocationFilter.
 *
 * Covers the contract introduced by Steps 1-4:
 *   1. stock 0 + first receipt → new_cost_per_unit = unit_cost; product cost_price persisted.
 *   2. 10@1000 + 10@2000 → CPP 1500; layer + stock_levels.cost_per_unit + products.cost_price written.
 *   3. FIFO → new_cost_per_unit = unit_cost (no average); layer created.
 *   4. Scope STORE → findMany where.inventory_locations.is = { organization_id, store_id }.
 *   5. Scope ORGANIZATION → filter only { organization_id }.
 *   6. Cross-org location → throw.
 */
describe('CostingService', () => {
  let service: CostingService;
  let prismaService: jest.Mocked<StorePrismaService>;
  let operatingScopeService: jest.Mocked<OperatingScopeService>;

  const mockContext = {
    organization_id: 1,
    user_id: 1,
    is_super_admin: false,
    is_owner: false,
  };

  beforeEach(async () => {
    const mockPrismaService = {
      stock_levels: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      inventory_locations: {
        findUnique: jest.fn(),
      },
      inventory_cost_layers: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      products: {
        update: jest.fn(),
      },
      product_variants: {
        update: jest.fn(),
      },
    };

    const mockOperatingScopeService = {
      getOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostingService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        {
          provide: OperatingScopeService,
          useValue: mockOperatingScopeService,
        },
      ],
    }).compile();

    service = module.get<CostingService>(CostingService);
    prismaService = module.get(StorePrismaService);
    operatingScopeService = module.get(OperatingScopeService);

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(mockContext);

    // Defaults reused across cases — overridden per test when needed.
    (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
      organization_id: 1,
      store_id: 10,
    });
    (prismaService as any).stock_levels.findMany.mockResolvedValue([]);
    (prismaService as any).inventory_cost_layers.create.mockResolvedValue({});
    (prismaService as any).products.update.mockResolvedValue({});
    (prismaService as any).product_variants.update.mockResolvedValue({});
    (prismaService as any).stock_levels.update.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateCostOnReceipt — weighted_average', () => {
    it('case 1: stock 0 + receipt 1@5682 → new_cost_per_unit = 5682 and products.cost_price = 5682', async () => {
      // No existing stock_level — first ever receipt.
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      // No locations with stock_on_hand > 0 anywhere yet.
      (prismaService as any).stock_levels.findMany.mockResolvedValue([]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 5682,
        costing_method: 'weighted_average',
      });

      expect(result.new_cost_per_unit).toBe(5682);
      expect(result.previous_cost_per_unit).toBe(0);

      // products.cost_price written with the scoped weighted-average (here = receipt cost).
      expect(prismaService.products.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            cost_price: new Prisma.Decimal(5682),
          }),
        }),
      );

      // Layer created — keeps the real receipt cost (5682).
      expect(prismaService.inventory_cost_layers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organization_id: 1,
            product_id: 1,
            location_id: 100,
            quantity_remaining: 1,
            unit_cost: new Prisma.Decimal(5682),
          }),
        }),
      );

      // No existing stock_level → no cost_per_unit update on stock_levels.
      expect(prismaService.stock_levels.update).not.toHaveBeenCalled();
    });

    it('case 2: 10@1000 existing + receipt 10@2000 → CPP 1500 + layer + cost updates', async () => {
      const existingStockLevel = {
        id: 7,
        product_id: 1,
        product_variant_id: null,
        location_id: 100,
        quantity_on_hand: 10,
        cost_per_unit: 1000,
      };

      (prismaService as any).stock_levels.findFirst.mockResolvedValue(
        existingStockLevel,
      );
      // Scoped aggregate finds the same single stock level.
      (prismaService as any).stock_levels.findMany.mockResolvedValue([
        existingStockLevel,
      ]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 10,
        unit_cost: 2000,
        costing_method: 'weighted_average',
      });

      // (10*1000 + 10*2000) / 20 = 1500
      expect(result.new_cost_per_unit).toBe(1500);
      expect(result.previous_cost_per_unit).toBe(1000);

      // stock_levels.cost_per_unit updated with 1500 (the new CPP).
      expect(prismaService.stock_levels.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7 },
          data: expect.objectContaining({
            cost_per_unit: new Prisma.Decimal(1500),
          }),
        }),
      );

      // products.cost_price also persisted to 1500.
      expect(prismaService.products.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            cost_price: new Prisma.Decimal(1500),
          }),
        }),
      );

      // Layer created for audit / FIFO replay.
      expect(prismaService.inventory_cost_layers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unit_cost: new Prisma.Decimal(2000),
            quantity_remaining: 10,
          }),
        }),
      );
    });
  });

  describe('calculateCostOnReceipt — FIFO', () => {
    it('case 3: FIFO returns new_cost_per_unit = unit_cost (no average) and still creates layer', async () => {
      const existingStockLevel = {
        id: 9,
        quantity_on_hand: 10,
        cost_per_unit: 1000,
      };
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(
        existingStockLevel,
      );
      (prismaService as any).stock_levels.findMany.mockResolvedValue([
        existingStockLevel,
      ]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 5,
        unit_cost: 2500,
        costing_method: 'fifo',
      });

      // FIFO: new_cost_per_unit equals the incoming receipt cost — no avg.
      expect(result.new_cost_per_unit).toBe(2500);

      expect(prismaService.inventory_cost_layers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unit_cost: new Prisma.Decimal(2500),
            quantity_remaining: 5,
          }),
        }),
      );
    });
  });

  describe('scoped aggregation by operating_scope', () => {
    it('case 4: STORE scope filters by { organization_id, store_id }', async () => {
      operatingScopeService.getOperatingScope.mockResolvedValue('STORE');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 42,
      });
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      (prismaService as any).stock_levels.findMany.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inventory_locations: {
              is: { organization_id: 1, store_id: 42 },
            },
          }),
        }),
      );
    });

    it('case 5: ORGANIZATION scope filters by { organization_id } only', async () => {
      operatingScopeService.getOperatingScope.mockResolvedValue('ORGANIZATION');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 42,
      });
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      (prismaService as any).stock_levels.findMany.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      expect(prismaService.stock_levels.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inventory_locations: {
              is: { organization_id: 1 },
            },
          }),
        }),
      );
    });

    it('case 6: location belongs to another organization → throws', async () => {
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 99, // different org than context (1)
        store_id: 7,
      });

      await expect(
        service.calculateCostOnReceipt({
          product_id: 1,
          location_id: 100,
          quantity_received: 1,
          unit_cost: 100,
          costing_method: 'weighted_average',
        }),
      ).rejects.toThrow(
        'Location 100 does not belong to organization 1',
      );
    });
  });
});
