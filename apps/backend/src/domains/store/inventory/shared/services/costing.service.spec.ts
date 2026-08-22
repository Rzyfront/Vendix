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
/**
 * `Prisma.Sql.text` conserva los saltos de línea y la sangría de la plantilla.
 * Las aserciones comparan la CONSULTA, no su formato.
 */
const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

describe('CostingService', () => {
  let service: CostingService;
  let prismaService: jest.Mocked<StorePrismaService>;
  let globalPrismaService: jest.Mocked<GlobalPrismaService>;
  let operatingScopeService: jest.Mocked<OperatingScopeService>;
  /**
   * El agregado de costo lee por CONSULTA CRUDA (`$queryRaw`), no por
   * `stock_levels.findMany`. Es deliberado: `$queryRaw` no atraviesa las
   * extensiones de Prisma, así que el conjunto agregado no depende de si el
   * cliente que ejecuta trae alcance de tienda o no. El mock apunta al
   * `PrismaClient` desnudo que devuelve `globalPrisma.withoutScope()`.
   */
  let rawQuery: jest.Mock;

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

    // QUI-425: el agregado en alcance se lee por el cliente SIN alcance
    // (`GlobalPrismaService.withoutScope()`), separado del cliente de tienda
    // que hace la lectura por ubicación y las escrituras.
    rawQuery = jest.fn().mockResolvedValue([]);
    const mockGlobalPrismaService = {
      withoutScope: jest.fn().mockReturnValue({ $queryRaw: rawQuery }),
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
    rawQuery.mockResolvedValue([]);
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
      rawQuery.mockResolvedValue([]);

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
      rawQuery.mockResolvedValue([existingStockLevel]);

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
      rawQuery.mockResolvedValue([existingStockLevel]);

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
    it('case 4: STORE scope → org + esa tienda + la bodega central (store_id IS NULL)', async () => {
      operatingScopeService.getOperatingScope.mockResolvedValue('STORE');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 42,
      });
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      rawQuery.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      // La pertenencia va ESCRITA en el WHERE, no heredada del cliente.
      const sent = rawQuery.mock.calls[0][0];
      expect(normalize(sent.text)).toContain(
        'il.organization_id = $2 AND (il.store_id = $3 OR il.store_id IS NULL)',
      );
      // [product_id, organization_id, store_id] — sin variante en esta llamada.
      expect(sent.values).toEqual([1, 1, 42]);
    });

    it('case 5: ORGANIZATION scope filters by { organization_id } only', async () => {
      operatingScopeService.getOperatingScope.mockResolvedValue('ORGANIZATION');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 42,
      });
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(null);
      rawQuery.mockResolvedValue([]);

      await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 1,
        unit_cost: 100,
        costing_method: 'weighted_average',
      });

      // ORGANIZATION scope → sólo { organization_id }: entran la bodega central
      // (store_id = null) y las tiendas hermanas.
      const sent = rawQuery.mock.calls[0][0];
      expect(normalize(sent.text)).toContain('il.organization_id = $2');
      expect(normalize(sent.text)).not.toContain('il.store_id =');
      expect(sent.values).toEqual([1, 1]);
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
      rawQuery.mockResolvedValue([
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

    /**
     * El método de costeo es CONFIGURABLE (ORG → STORE, default CPP). Una tienda
     * que operó en CPP puede tener saldo sin capas que lo respalden, porque CPP
     * cuesta al promedio y tolera la falta. Antes, el día que alguien movía el
     * ajuste a FIFO esas unidades costaban CERO: la venta salía con margen 100 %
     * y el único rastro era un warn en el log del servidor.
     */
    it('FIFO: cobra el faltante de capas al costo canónico, no a cero', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([
        { ...twoLayers[0] }, // sólo 10 unidades respaldadas por capa
      ]);

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 12,
        costing_method: 'fifo',
      });

      // 10 @ capa 10000 = 100000, + 2 sin capa @ canónico 12500 = 25000.
      expect(cogs).toBe(125000);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledTimes(1);
      expect(prismaService.inventory_cost_layers.update).toHaveBeenCalledWith({
        where: { id: 508 },
        data: { quantity_remaining: 0 },
      });
    });

    it('FIFO: sin capas ni costo canónico el COGS es 0, pero por dato ausente', async () => {
      (prismaService as any).inventory_cost_layers.findMany.mockResolvedValue([]);
      (prismaService as any).stock_levels.findFirst.mockResolvedValue({
        id: 7,
        product_id: 1,
        product_variant_id: null,
        location_id: 100,
        cost_per_unit: null,
        products: { cost_price: null },
        product_variants: null,
      });

      const cogs = await service.consumeCostLayers({
        product_id: 1,
        location_id: 100,
        quantity: 4,
        costing_method: 'fifo',
      });

      expect(cogs).toBe(0);
      expect(prismaService.inventory_cost_layers.update).not.toHaveBeenCalled();
    });
  });

  /**
   * F1 — cost_per_unit collapse fix.
   *
   * Root cause: `stock_levels.cost_per_unit` is `Decimal?` with no @default, so
   * it is born NULL on every write path except purchase receipts (create/edit
   * product, variants, imports, adjustments, seeds all set products/variants
   * `cost_price` but leave `cost_per_unit` NULL). The old aggregate averaged
   * with `cost_per_unit ?? 0`, so historical stock contributed value 0 and a
   * MORE EXPENSIVE receipt dragged the CPP DOWN.
   *
   * The fix replicates the canonical fallback already used by
   * `initializeCostLayers`: cost_per_unit → variant.cost_price →
   * product.cost_price → 0, using `||` (not `??`) so a spurious 0 falls through.
   */
  describe('cost_per_unit collapse fallback (F1)', () => {
    it('case a: stock row with cost_per_unit=NULL falls back to products.cost_price (3.5M, not 0)', async () => {
      // Aggregate reads through the UNSCOPED base client (globalPrisma).
      rawQuery.mockResolvedValue([
        {
          quantity_on_hand: 10,
          cost_per_unit: null, // born NULL (non-receipt write path)
          product_cost_price: 3_500_000,
          variant_cost_price: null,
        },
      ]);

      const agg = await service.getScopedStockAggregate({
        product_id: 1,
        location_id: 100,
      });

      expect(agg.quantity).toBe(10);
      // Fallback to products.cost_price — NOT 0.
      expect(agg.cost_per_unit).toBe(3_500_000);
    });

    it('case b: 24@3.5M (via cost_price fallback) + receipt 5@7M → CPP blends UP to ~4.1M, never collapses', async () => {
      // Founder's confirmed prod scenario: 24 units already on hand whose
      // cost_per_unit is NULL (so the real 3.5M cost lives only in cost_price),
      // then a 5-unit receipt at a HIGHER cost of 7M. The old code collapsed
      // the persisted cost to 1.436.207 (blended the 24 units at 0). The fix
      // must blend UP to (24*3.5M + 5*7M)/29 ≈ 4.103.448 — between 3.5M and 7M.
      const existing = {
        id: 5,
        product_id: 1,
        product_variant_id: null,
        location_id: 100,
        quantity_on_hand: 24,
        cost_per_unit: null,
        // Forma Prisma (la lee `stock_levels.findFirst`, por ubicación)…
        products: { cost_price: 3_500_000 },
        product_variants: null,
        // …y forma cruda (la lee el agregado en alcance, por `$queryRaw`).
        product_cost_price: 3_500_000,
        variant_cost_price: null,
      };
      (prismaService as any).stock_levels.findFirst.mockResolvedValue(existing);
      rawQuery.mockResolvedValue([existing]);

      const result = await service.calculateCostOnReceipt({
        product_id: 1,
        location_id: 100,
        quantity_received: 5,
        unit_cost: 7_000_000,
        costing_method: 'weighted_average',
      });

      const expected = (24 * 3_500_000 + 5 * 7_000_000) / 29; // 4,103,448.28
      expect(result.new_scoped_cost_per_unit).toBeCloseTo(expected, 5);
      expect(result.new_cost_per_unit).toBeCloseTo(expected, 5);
      // Invariant: the blended cost stays BETWEEN the two costs, never below
      // the 3.5M floor (the collapse bug produced 1.436.207).
      expect(result.new_scoped_cost_per_unit).toBeGreaterThan(3_500_000);
      expect(result.new_scoped_cost_per_unit).toBeLessThan(7_000_000);
      // products.cost_price persisted with the scoped blend.
      expect(prismaService.products.update).toHaveBeenCalledTimes(1);
    });

    it('case c: legitimate zero cost (cost_per_unit=0 AND cost_price=0) stays 0 (no false fallback)', async () => {
      rawQuery.mockResolvedValue([
        {
          quantity_on_hand: 10,
          cost_per_unit: 0,
          product_cost_price: 0,
          variant_cost_price: null,
        },
      ]);

      const agg = await service.getScopedStockAggregate({
        product_id: 1,
        location_id: 100,
      });

      expect(agg.quantity).toBe(10);
      // Every link in the fallback chain is 0 → result is 0, not a crash.
      expect(agg.cost_per_unit).toBe(0);
    });
  });

  /**
   * A.0 — Un único universo de stock.
   *
   * El defecto que este bloque clava: `getScopedStockAggregate` elegía cliente
   * con `tx ?? globalPrisma`, y como `StorePrismaService` SOBRESCRIBE
   * `$transaction` hacia el cliente CON alcance, el camino de recepción recibía
   * un `AND inventory_locations.store_id = <tienda>` encima del filtro
   * explícito — y ese filtro incluye A PROPÓSITO la bodega central de la
   * organización (`store_id IS NULL`). Medido en dev (producto 268,
   * organización 6, tienda 10, 10 u. a 2.000.000): vista previa 119 unidades y
   * 1.649.457,36; recepción 25 unidades y 1.728.571,43. 4,8 % de divergencia
   * entre lo que el operador aprueba y lo que el sistema sella.
   *
   * El contrato que queda escrito aquí: MISMO conjunto agregado con `tx` y sin
   * `tx`, y el aislamiento entre organizaciones sale del `WHERE`, no del
   * cliente que ejecute.
   */
  describe('A.0 — universo de stock idéntico con tx y sin tx', () => {
    // 94 unidades en la bodega central (store_id = null) + 25 en la tienda.
    // Bajo el defecto, la recepción veía sólo las 25.
    const universe = [
      {
        quantity_on_hand: 94,
        cost_per_unit: 1_620_000,
        product_cost_price: 1_620_000,
        variant_cost_price: null,
      },
      {
        quantity_on_hand: 25,
        cost_per_unit: 1_620_000,
        product_cost_price: 1_620_000,
        variant_cost_price: null,
      },
    ];

    const makeTx = (rows: any[], location = { organization_id: 1, store_id: 42 }) => ({
      $queryRaw: jest.fn().mockResolvedValue(rows),
      inventory_locations: {
        findUnique: jest.fn().mockResolvedValue(location),
      },
    });

    beforeEach(() => {
      operatingScopeService.getOperatingScope.mockResolvedValue('STORE');
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue({
        organization_id: 1,
        store_id: 42,
      });
    });

    it('los dos caminos emiten la MISMA consulta y agregan el MISMO conjunto', async () => {
      rawQuery.mockResolvedValue(universe);
      const tx = makeTx(universe);

      const preview = await service.getScopedStockAggregate({
        product_id: 268,
        location_id: 100,
      });
      const reception = await service.getScopedStockAggregate(
        { product_id: 268, location_id: 100 },
        tx,
      );

      // Igualdad exacta del agregado — el contrato.
      expect(reception).toEqual(preview);
      // 94 (bodega central) + 25 (tienda). El defecto daba 25 en recepción.
      expect(reception.quantity).toBe(119);
      expect(reception.cost_per_unit).toBe(1_620_000);

      // Misma consulta, mismos parámetros: un solo resolvedor.
      const sentPreview = rawQuery.mock.calls[0][0];
      const sentReception = tx.$queryRaw.mock.calls[0][0];
      expect(normalize(sentReception.text)).toBe(normalize(sentPreview.text));
      expect(sentReception.values).toEqual(sentPreview.values);
      // Y la bodega central sigue dentro del universo en AMBOS.
      expect(normalize(sentReception.text)).toContain('il.store_id IS NULL');
    });

    it('con `tx` la lectura va por el handle transaccional (ve lo escrito en la transacción)', async () => {
      const tx = makeTx(universe);

      await service.getScopedStockAggregate(
        { product_id: 268, location_id: 100 },
        tx,
      );

      // `globalPrisma` es OTRO PrismaClient con OTRO pool: dentro de la
      // transacción no vería la línea anterior de la misma recepción.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(rawQuery).not.toHaveBeenCalled();
      expect(globalPrismaService.withoutScope).not.toHaveBeenCalled();
    });

    it('sin `tx` la lectura va por el cliente SIN alcance', async () => {
      rawQuery.mockResolvedValue(universe);

      await service.getScopedStockAggregate({
        product_id: 268,
        location_id: 100,
      });

      expect(globalPrismaService.withoutScope).toHaveBeenCalled();
      expect(rawQuery).toHaveBeenCalledTimes(1);
    });

    it('el WHERE fija la organización del contexto en los dos caminos', async () => {
      operatingScopeService.getOperatingScope.mockResolvedValue('ORGANIZATION');
      rawQuery.mockResolvedValue([]);
      const tx = makeTx([]);

      await service.getScopedStockAggregate({
        product_id: 268,
        location_id: 100,
      });
      await service.getScopedStockAggregate(
        { product_id: 268, location_id: 100 },
        tx,
      );

      for (const sent of [rawQuery.mock.calls[0][0], tx.$queryRaw.mock.calls[0][0]]) {
        const text = normalize(sent.text);
        // El JOIN es lo que ancla cada fila de stock a una organización…
        expect(text).toContain(
          'JOIN inventory_locations il ON il.id = sl.location_id',
        );
        // …y el predicado la fija. Nunca es opcional, en ninguna rama.
        expect(text).toContain('il.organization_id = $2');
        // [product_id, organization_id] — la organización es la del contexto.
        expect(sent.values).toEqual([268, 1]);
      }
    });

    it('una ubicación de OTRA organización es inalcanzable por los dos caminos', async () => {
      const foreign = { organization_id: 99, store_id: 7 };
      (prismaService as any).inventory_locations.findUnique.mockResolvedValue(
        foreign,
      );
      const tx = makeTx(universe, foreign);

      await expect(
        service.getScopedStockAggregate({ product_id: 268, location_id: 100 }),
      ).rejects.toThrow('Location 100 does not belong to organization 1');

      await expect(
        service.getScopedStockAggregate(
          { product_id: 268, location_id: 100 },
          tx,
        ),
      ).rejects.toThrow('Location 100 does not belong to organization 1');

      // Ninguno de los dos llegó siquiera a consultar stock.
      expect(rawQuery).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('la variante viaja parametrizada y estrecha el universo igual en ambos caminos', async () => {
      rawQuery.mockResolvedValue([]);
      const tx = makeTx([]);

      await service.getScopedStockAggregate({
        product_id: 268,
        variant_id: 413,
        location_id: 100,
      });
      await service.getScopedStockAggregate(
        { product_id: 268, variant_id: 413, location_id: 100 },
        tx,
      );

      for (const sent of [rawQuery.mock.calls[0][0], tx.$queryRaw.mock.calls[0][0]]) {
        expect(normalize(sent.text)).toContain('sl.product_variant_id = $2');
        // [product_id, variant_id, organization_id, store_id]
        expect(sent.values).toEqual([268, 413, 1, 42]);
      }
    });
  });

});
