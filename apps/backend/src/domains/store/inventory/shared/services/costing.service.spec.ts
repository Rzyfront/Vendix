import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CostingService } from './costing.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
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
  let globalPrismaService: jest.Mocked<GlobalPrismaService>;
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

    // QUI-425: the scoped cost aggregate is read through the UNSCOPED base
    // client (GlobalPrismaService), so it must be mocked separately from the
    // store-scoped client used for the single-location read and writes.
    const mockGlobalPrismaService = {
      stock_levels: {
        findMany: jest.fn(),
      },
    };

    const mockOperatingScopeService = {
      getOperatingScope: jest.fn().mockResolvedValue('ORGANIZATION'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostingService,
        { provide: StorePrismaService, useValue: mockPrismaService },
        { provide: GlobalPrismaService, useValue: mockGlobalPrismaService },
        {
          provide: OperatingScopeService,
          useValue: mockOperatingScopeService,
        },
      ],
    }).compile();

    service = module.get<CostingService>(CostingService);
    prismaService = module.get(StorePrismaService);
    globalPrismaService = module.get(GlobalPrismaService);
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
    // Scoped aggregate default: no in-scope stock anywhere.
    (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([]);
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
      // No locations with stock_on_hand > 0 anywhere yet (scoped aggregate).
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 5682,
        costing_method: 'weighted_average',
      });

      expect(result.new_cost_per_unit).toBe(5682);
      // Scoped cost equals the receipt cost when there is no prior in-scope stock.
      expect(result.new_scoped_cost_per_unit).toBe(5682);
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
      // Scoped aggregate (UNSCOPED base client) finds the same single stock level.
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([
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
      // Scoped cost equals the same blend here (single in-scope location).
      expect(result.new_scoped_cost_per_unit).toBe(1500);
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
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([
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
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      // Aggregate runs on the UNSCOPED client with the scope filter as the
      // ONLY predicate (STORE → org + store).
      expect(globalPrismaService.stock_levels.findMany).toHaveBeenCalledWith(
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
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      // ORGANIZATION scope → filter is { organization_id } only, so org-level
      // central warehouses (store_id = null) and sibling stores are included.
      expect(globalPrismaService.stock_levels.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            inventory_locations: {
              is: { organization_id: 1 },
            },
          }),
        }),
      );
    });

    it('case 5b (QUI-425): ORGANIZATION scope blends the org-level central warehouse into cost_price/margin basis', async () => {
      // Founder's reported scenario: 10 units already in the central warehouse
      // (store_id = null) at 1.000.000, receiving 10 units into a store showroom
      // at 200.000. The scoped cost MUST blend both → 600.000, NOT collapse to
      // the incoming 200.000 (which spiked the margin).
      operatingScopeService.getOperatingScope.mockResolvedValue('ORGANIZATION');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 10, // receiving location = a store showroom
      });
      // Receiving location itself is empty pre-receipt.
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      // Scoped aggregate (unscoped read) sees the org-level central warehouse.
      (globalPrismaService as any).stock_levels.findMany.mockResolvedValue([
        {
          location_id: 49, // Bodega Central, store_id = null
          quantity_on_hand: 10,
          cost_per_unit: 1000000,
        },
      ]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 10,
        unit_cost: 200000,
        costing_method: 'weighted_average',
      });

      // Receiving location alone: empty + 10@200k → 200.000.
      expect(result.new_cost_per_unit).toBe(200000);
      // Scoped blend across the org: (10*1.000.000 + 10*200.000)/20 = 600.000.
      expect(result.new_scoped_cost_per_unit).toBe(600000);
      // products.cost_price persisted with the scoped blend (600.000), not 200.000.
      expect(prismaService.products.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            cost_price: new Prisma.Decimal(600000),
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

  /**
   * consumeCostLayers — COGS on stock consumption (fix 2748be26, QUI-425).
   *
   * The invariant the fix protects: under weighted_average (CPP) we MUST
   * decrement inventory_cost_layers (received_at ASC) so they stay in sync with
   * stock_levels, WHILE still valuing the consumed units at the average
   * cost_per_unit — never at the individual layer.unit_cost. The FIFO branch is
   * the contrast: it values at each layer's unit_cost. The E2E that motivated
   * this (order POS-2026-0042) saw layer 10→7, COGS at CPP 12.500 not 10.000.
   */
  describe('consumeCostLayers — COGS on consumption', () => {
    // Two layers, cheaper one received first. CPP average (in stock_levels) is
    // 12500, deliberately different from both layer unit_costs (10000, 15000)
    // so the average-vs-layer distinction is observable.
    const twoLayers = [
      {
        id: 508,
        quantity_remaining: 10,
        unit_cost: 10000,
        received_at: new Date('2026-06-01'),
      },
      {
        id: 509,
        quantity_remaining: 10,
        unit_cost: 15000,
        received_at: new Date('2026-06-15'),
      },
    ];

    beforeEach(() => {
      (prismaService as any).stock_levels.findFirst.mockResolvedValue({
        id: 7,
        product_id: 1,
        product_variant_id: null,
        location_id: 100,
        cost_per_unit: 12500,
      });
    });

    it('CPP: values COGS at the average and decrements the earliest layer', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([
        { ...twoLayers[0] },
        { ...twoLayers[1] },
      ]);

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 3,
        costing_method: 'weighted_average',
      });

      // 3 units @ average 12500 = 37500 (NOT 3 @ layer 10000 = 30000).
      expect(cogs).toBe(37500);

      // Only the earliest layer (508) is touched: 10 - 3 = 7.
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledTimes(1);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 508 },
        data: { quantity_remaining: 7 },
      });
    });

    it('CPP: spans multiple layers when the first is exhausted, still at average', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([
        { ...twoLayers[0] },
        { ...twoLayers[1] },
      ]);

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 15,
        costing_method: 'weighted_average',
      });

      // 15 units @ average 12500 = 187500 (blind to the 10000/15000 split).
      expect(cogs).toBe(187500);

      // First layer drained to 0, second reduced 10 → 5.
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledTimes(2);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 508 },
        data: { quantity_remaining: 0 },
      });
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 509 },
        data: { quantity_remaining: 5 },
      });
    });

    it('CPP: insufficient layers still charge the shortfall at the average cost', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([
        { ...twoLayers[0] }, // only 10 units of layer data available
      ]);

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 12,
        costing_method: 'weighted_average',
      });

      // 12 @ 12500 = 150000: 10 from the layer + 2 shortfall, all at average.
      expect(cogs).toBe(150000);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledTimes(1);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 508 },
        data: { quantity_remaining: 0 },
      });
    });

    it('FIFO contrast: values COGS at the layer unit_cost, not the average', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([
        { ...twoLayers[0] },
        { ...twoLayers[1] },
      ]);

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 3,
        costing_method: 'fifo',
      });

      // FIFO: 3 units @ earliest layer 10000 = 30000 (proves the CPP branch is
      // distinct — same inputs, different valuation).
      expect(cogs).toBe(30000);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 508 },
        data: { quantity_remaining: 7 },
      });
    });
  });
});
