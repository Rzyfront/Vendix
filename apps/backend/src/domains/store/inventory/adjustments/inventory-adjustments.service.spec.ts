/**
 * CP-pos-smart-search · D.1 — Specs del picker tokenizado de ajustes.
 *
 * Flag on: where AND×OR nestado bajo `products:` (mismo helper A.1) +
 * rank en memoria (mismo A.2); location_id y product_variant_id intactos;
 * shape idéntico al legacy. Kill-switch / throw ⇒ legacy.
 */
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('InventoryAdjustmentsService — searchAdjustableProducts (D.1)', () => {
  const mockPrisma = {
    stock_levels: { findMany: jest.fn() },
  };
  const mockSearchPath = { isKillSwitchOn: jest.fn() };
  let service: InventoryAdjustmentsService;

  const row = (over: Record<string, any>) => ({
    id: over.id ?? 1,
    product_variant_id: over.product_variant_id ?? null,
    quantity_on_hand: 10,
    quantity_reserved: 1,
    quantity_available: 9,
    products: {
      id: over.id ?? 1,
      name: 'Cafe Tubo 1/2',
      sku: 'TUBO-001',
      barcode: null,
      ...(over.products ?? {}),
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryAdjustmentsService(
      mockPrisma as any,
      {} as any,
      {} as any,
      mockSearchPath as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
    mockSearchPath.isKillSwitchOn.mockReturnValue(false);
  });

  it('smart: where tokenizado AND×OR bajo products: + location intacto', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      row({ id: 1 }),
      row({ id: 2, products: { name: 'Tubo Cafe 3/4', sku: 'X' } }),
    ]);

    const result = await service.searchAdjustableProducts('cafe tubo', 7, 10);

    const where = mockPrisma.stock_levels.findMany.mock.calls[0][0].where;
    expect(where.location_id).toBe(7);
    // 2 tokens ⇒ 2 ramas AND, cada una OR sobre name/sku/barcode.
    expect(where.products.AND).toHaveLength(2);
    for (const branch of where.products.AND) {
      expect(branch.OR).toHaveLength(3);
    }
    expect(where.products.OR).toBeUndefined();
    // Empate total de score/coverage (ambos tokens word-tier en ambas):
    // tiebreak id DESC ⇒ 2 primero (contrato compareSearchRank).
    expect(result.map((r: any) => r.id)).toEqual([2, 1]);
  });

  it('shape legacy intacto incl. product_variant_id por fila', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([
      row({ id: 9, product_variant_id: 44 }),
    ]);

    const result = await service.searchAdjustableProducts('tubo', 7, 10);

    expect(result).toEqual([
      {
        id: 9,
        name: 'Cafe Tubo 1/2',
        sku: 'TUBO-001',
        product_variant_id: 44,
        stock_at_location: {
          quantity_on_hand: 10,
          quantity_reserved: 1,
          quantity_available: 9,
        },
      },
    ]);
  });

  it('kill-switch: contains legacy byte-idéntico (OR frase)', async () => {
    mockSearchPath.isKillSwitchOn.mockReturnValue(true);
    mockPrisma.stock_levels.findMany.mockResolvedValue([]);

    await service.searchAdjustableProducts('cafe tubo', 7, 10);

    const args = mockPrisma.stock_levels.findMany.mock.calls[0][0];
    expect(args.where.products.OR).toEqual([
      { name: { contains: 'cafe tubo', mode: 'insensitive' } },
      { sku: { contains: 'cafe tubo', mode: 'insensitive' } },
      { barcode: { contains: 'cafe tubo', mode: 'insensitive' } },
    ]);
    expect(args.take).toBe(10);
  });

  it('query acentuada + smart ⇒ legacy (paridad, finding #2)', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([]);

    await service.searchAdjustableProducts('café tubo', 7, 10);

    const args = mockPrisma.stock_levels.findMany.mock.calls[0][0];
    expect(args.where.products.AND).toBeUndefined();
    expect(args.where.products.OR).toEqual([
      { name: { contains: 'café tubo', mode: 'insensitive' } },
      { sku: { contains: 'café tubo', mode: 'insensitive' } },
      { barcode: { contains: 'café tubo', mode: 'insensitive' } },
    ]);
  });

  it('kill-switch on / throw ⇒ legacy (fail-open)', async () => {
    mockPrisma.stock_levels.findMany.mockResolvedValue([row({ id: 1 })]);

    // Kill on.
    mockSearchPath.isKillSwitchOn.mockReturnValue(true);
    await service.searchAdjustableProducts('tubo', 7, 10);
    expect(
      mockPrisma.stock_levels.findMany.mock.calls[0][0].where.products.OR,
    ).toHaveLength(3);

    // Kill-switch down (throw).
    mockSearchPath.isKillSwitchOn.mockImplementation(() => {
      throw new Error('down');
    });
    await service.searchAdjustableProducts('tubo', 7, 10);
    expect(
      mockPrisma.stock_levels.findMany.mock.calls[1][0].where.products.OR,
    ).toHaveLength(3);
  });

  it('sobre scan-cap: fail-open a legacy', async () => {
    // 201 filas > cap 200 ⇒ rankedIdsPage null ⇒ legacy.
    mockPrisma.stock_levels.findMany.mockImplementation((args: any) => {
      if (args.take === 201) {
        return Promise.resolve(
          Array.from({ length: 201 }, (_, i) => row({ id: 1000 + i })),
        );
      }
      return Promise.resolve([row({ id: 1 })]);
    });

    const result = await service.searchAdjustableProducts('tubo', 7, 10);

    expect(
      mockPrisma.stock_levels.findMany.mock.calls[1][0].where.products.OR,
    ).toHaveLength(3);
    expect(result).toHaveLength(1);
  });
});

describe('InventoryAdjustmentsService — initial_load', () => {
  const tx: any = {
    $executeRawUnsafe: jest.fn(),
    stock_levels: { findFirst: jest.fn() },
    inventory_adjustments: { create: jest.fn() },
    products: { findFirst: jest.fn() },
    product_variants: { findFirst: jest.fn() },
  };
  const stockManager = { updateStock: jest.fn() };
  const costing = { calculateCostOnReceipt: jest.fn() };
  const resolver = { resolveCostingMethod: jest.fn() };
  let service: InventoryAdjustmentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryAdjustmentsService(
      {} as any,
      stockManager as any,
      { emit: jest.fn() } as any,
      {} as any,
      costing as any,
      resolver as any,
    );
    jest.spyOn(RequestContextService, 'getOrganizationId').mockReturnValue(1);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(9);
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(3);
    resolver.resolveCostingMethod.mockResolvedValue('weighted_average');
    costing.calculateCostOnReceipt.mockResolvedValue({
      new_cost_per_unit: 4100,
    });
    stockManager.updateStock.mockResolvedValue({ cost_snapshot: null });
    tx.inventory_adjustments.create.mockImplementation(
      async ({ data }: any) => ({
        id: 5,
        ...data,
      }),
    );
  });

  it('positivo: costea la entrada y mueve stock como initial', async () => {
    tx.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: 0 });

    const res = await service.createAdjustmentInTransaction(tx, {
      product_id: 1,
      location_id: 2,
      type: 'initial_load',
      quantity_after: 10,
      unit_cost: 3800,
    } as any);

    expect(costing.calculateCostOnReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: 1,
        location_id: 2,
        quantity_received: 10,
        unit_cost: 3800,
        costing_method: 'weighted_average',
      }),
      tx,
    );
    expect(stockManager.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({
        movement_type: 'initial',
        unit_cost: 4100,
        movement_unit_cost: 3800,
        validate_availability: false,
      }),
      tx,
    );
    expect(res.cost_amount).toBe(38000);
    expect(res.adjustment_type).toBe('initial_load');
  });

  it('sin stock_level no lanza y parte de quantity_before 0', async () => {
    tx.stock_levels.findFirst.mockResolvedValue(null);
    tx.products.findFirst.mockResolvedValue({ cost_price: 500 });

    const res = await service.createAdjustmentInTransaction(tx, {
      product_id: 1,
      location_id: 2,
      type: 'initial_load',
      quantity_after: 4,
    } as any);

    expect(
      tx.inventory_adjustments.create.mock.calls[0][0].data.quantity_before,
    ).toBe(0);
    expect(costing.calculateCostOnReceipt.mock.calls[0][0].unit_cost).toBe(500);
    expect(res.cost_amount).toBe(2000);
  });

  it.each([
    [5, 8],
    [5, 2],
    [0, 0],
  ])(
    'rechaza initial_load con saldo %i y destino %i antes de escribir',
    async (before, after) => {
      tx.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: before });
      await expect(
        service.createAdjustmentInTransaction(tx, {
          product_id: 1,
          location_id: 2,
          type: 'initial_load',
          quantity_after: after,
        } as any),
      ).rejects.toThrow('cantidad actual 0 y una entrada positiva');
      expect(tx.inventory_adjustments.create).not.toHaveBeenCalled();
      expect(stockManager.updateStock).not.toHaveBeenCalled();
      expect(costing.calculateCostOnReceipt).not.toHaveBeenCalled();
    },
  );

  it('batch settled preserva unit_cost al crear el ajuste', async () => {
    const create = jest
      .spyOn(service, 'createAdjustment')
      .mockResolvedValue({ id: 12 } as any);
    const results = await service.batchCreateAndCompleteSettled(2, [
      {
        product_id: 1,
        type: 'initial_load',
        quantity_after: 4,
        unit_cost: 2750,
      },
    ]);
    expect(results[0].ok).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ unit_cost: 2750 }),
      { approvedByUserId: 9 },
    );
  });
  it('count_variance se mantiene: sin costeo de recepción y movement adjustment', async () => {
    tx.stock_levels.findFirst.mockResolvedValue({ quantity_on_hand: 3 });
    stockManager.updateStock.mockResolvedValue({
      cost_snapshot: { total_cost: 70 },
    });

    const res = await service.createAdjustmentInTransaction(tx, {
      product_id: 1,
      location_id: 2,
      type: 'count_variance',
      quantity_after: 10,
    } as any);

    expect(costing.calculateCostOnReceipt).not.toHaveBeenCalled();
    expect(stockManager.updateStock.mock.calls[0][0].movement_type).toBe(
      'adjustment',
    );
    expect(res.cost_amount).toBe(70);
  });

  it('count_variance sin stock_level sigue lanzando INV_FIND_001', async () => {
    tx.stock_levels.findFirst.mockResolvedValue(null);
    await expect(
      service.createAdjustmentInTransaction(tx, {
        product_id: 1,
        location_id: 2,
        type: 'count_variance',
        quantity_after: 1,
      } as any),
    ).rejects.toBeDefined();
  });
});
