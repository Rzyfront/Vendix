import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from './production-orders.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { StockValidatorService } from '../inventory/shared/services/stock-validator.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

interface FakeStockLevel {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  cost_per_unit: Prisma.Decimal;
}

interface FakeTransaction {
  id: number;
  productId: number;
  type: string;
  quantityChange: number;
}

/**
 * Targeted unit tests for `ProductionOrdersService.complete()`.
 *
 * These tests intentionally focus on the heart of Fase C:
 *  - Each recipe_item is consumed with `movement_type='consumption'` and
 *    a negative `quantity_change`.
 *  - Multiplicative merma (per-line + recipe-level) is applied.
 *  - Produced stock is credited with `movement_type='production'` and a
 *    positive `quantity_change`.
 *  - The unit_cost of the produced batch equals the FIFO-weighted average
 *    of the consumed ingredients divided by `produced_qty`.
 *  - The `production.completed` event is emitted exactly once with the
 *    derived cost snapshot.
 *
 * Stock, transactions, movements and the production_order are mocked so
 * the test runs without a real DB. FIFO cost resolution is exercised via
 * a single ingredient with two `inventory_cost_layers` rows.
 */
// Atomic state guard (QUI-995): the claim every completion makes first.
const claimOk = jest.fn().mockResolvedValue({ count: 1 });

describe('ProductionOrdersService — complete() (Fase C smoke)', () => {
  let service: ProductionOrdersService;
  let stockLevelManager: jest.Mocked<Pick<StockLevelManager, 'updateStock' | 'getDefaultLocationForProduct'>>;
  let stockValidatorService: jest.Mocked<
    Pick<StockValidatorService, 'assertIngredientsAvailable' | 'resolveInventoryPolicy'>
  >;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let prismaMock: {
    production_orders: {
      findFirst: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      update: jest.Mock;
    };
    store_settings: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };

  const ctx = {
    store_id: 1,
    organization_id: 1,
    user_id: 42,
    is_super_admin: false,
  };

  beforeEach(() => {
    stockLevelManager = {
      updateStock: jest.fn(),
      getDefaultLocationForProduct: jest.fn(),
    } as any;

    // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md,
    // step 6): resolves as available by default so the pre-existing smoke
    // test is unaffected; tests exercising the guard itself override this.
    stockValidatorService = {
      assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
      // docs/plans/no-overselling-stock-guard-plan.md step 9 — default
      // policy (strict oversell, permissive ingredient overuse) so the
      // pre-existing smoke tests observe the SAME behavior as before this
      // switch existed. Tests exercising the switch itself override this.
      resolveInventoryPolicy: jest
        .fn()
        .mockResolvedValue({ allowOversell: false, allowIngredientOveruse: true }),
    } as any;

    eventEmitter = { emit: jest.fn() } as any;

    prismaMock = {
      production_orders: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { produced_qty: 0 } }),
        update: jest.fn(),
      },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(ctx as any);

    service = new ProductionOrdersService(
      prismaMock as any,
      stockLevelManager as any,
      stockValidatorService as any,
      eventEmitter as any,
    );
  });

  it('consume ingredients with merma, produce stock with FIFO unit_cost, emit event', async () => {
    // 1. Mock the order: simple in_progress order with 1 ingredient (10g flour, no merma)
    prismaMock.production_orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      product_id: 50, // salsa
      recipe_id: 7,
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      status: 'in_progress',
      produced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      product: {
        id: 50,
        name: 'Salsa de tomate',
        sku: 'SAL-1',
        stock_unit: 'g',
        is_batch_produced: true,
      },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(0),
        preparation_notes: null,
        items: [
          {
            id: 1,
            recipe_id: 7,
            component_product_id: 99, // harina
            quantity: new Prisma.Decimal(10),
            waste_percent: new Prisma.Decimal(0),
            is_optional: false,
            component_product: {
              id: 99,
              name: 'Harina',
              sku: 'HAR-1',
              stock_unit: 'g',
            },
          },
        ],
      },
    } as any);

    // 2. The mocked updateStock will return a FIFO cost snapshot for the
    // ingredient consumption ($0.10 per unit * 10g = $1.00 total).
    // The second call (production credit) just echoes.
    stockLevelManager.updateStock.mockImplementation(async (params) => {
      if (params.movement_type === 'consumption') {
        return {
          stock_level: { id: 1 } as FakeStockLevel,
          transaction: { id: 1 } as FakeTransaction,
          previous_quantity: 10,
          cost_snapshot: {
            unit_cost: 0.1,
            total_cost: 1.0,
            stock_value: 0,
          },
        };
      }
      // 'production' branch — return a no-cost echo
      return {
        stock_level: { id: 2 } as FakeStockLevel,
        transaction: { id: 2 } as FakeTransaction,
        previous_quantity: 0,
        cost_snapshot: {
          unit_cost: 0.1,
          total_cost: 1.0,
          stock_value: 0,
        },
      };
    });

    stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);

    // 3. $transaction executes the callback with a fake tx. The final
    // `tx.production_orders.update` is what the service returns.
    const txOrderUpdate = jest.fn().mockResolvedValue({
      id: 100,
      status: 'completed',
      produced_qty: new Prisma.Decimal(10),
      product: {
        id: 50,
        name: 'Salsa de tomate',
        sku: 'SAL-1',
        stock_unit: 'g',
      },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(0),
      },
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({ production_orders: { update: txOrderUpdate, updateMany: claimOk } }),
    );

    // 4. The outer `production_orders.update` (post-transaction) is also
    // observed by some callers; mock it for safety.
    prismaMock.production_orders.update.mockResolvedValue({
      id: 100,
      status: 'completed',
      produced_qty: new Prisma.Decimal(10),
    } as any);

    // 5. Run complete()
    const result = await service.complete(100, { produced_qty: 10 });

    // 6. Assertions
    // (a) updateStock called twice: once for consumption, once for production
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(2);

    const [consumeCall, produceCall] = stockLevelManager.updateStock.mock.calls;

    // (b) consumption has movement_type='consumption' and negative qty
    expect(consumeCall[0].movement_type).toBe('consumption');
    expect(consumeCall[0].quantity_change).toBeLessThan(0);
    expect(consumeCall[0].quantity_change).toBeCloseTo(-10, 4);

    // (c) production has movement_type='production' and positive qty
    expect(produceCall[0].movement_type).toBe('production');
    expect(produceCall[0].quantity_change).toBe(10);

    // (d) unit_cost on production equals $1.00 / 10 = $0.10 (1:1 FIFO)
    expect(produceCall[0].unit_cost).toBeCloseTo(0.1, 4);

    // (e) result is the updated order
    expect(result.status).toBe('completed');

    // (f) production.completed event was emitted once
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'production.completed',
      expect.objectContaining({
        production_order_id: 100,
        produced_qty: 10,
        produced_unit_cost: expect.closeTo(0.1, 4),
        total_cost: expect.closeTo(1.0, 4),
        consumed_line_count: 1,
        product_id: 50,
        store_id: 1,
        user_id: 42,
      }),
    );
  });

  it('applies multiplicative merma (line + recipe) to consumption quantity', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue({
      id: 200,
      store_id: 1,
      product_id: 50,
      recipe_id: 7,
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      status: 'draft',
      produced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      product: { id: 50, name: 'Salsa', sku: 'S', stock_unit: 'g', is_batch_produced: true },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(5), // 5% recipe merma
        items: [
          {
            id: 1,
            recipe_id: 7,
            component_product_id: 99,
            quantity: new Prisma.Decimal(10),
            waste_percent: new Prisma.Decimal(10), // 10% line merma
            is_optional: false,
            component_product: { id: 99, name: 'H', sku: 'H', stock_unit: 'g' },
          },
        ],
      },
    } as any);

    stockLevelManager.updateStock.mockImplementation(async () => ({
      stock_level: { id: 1 } as any,
      transaction: { id: 1 } as any,
      previous_quantity: 0,
      cost_snapshot: { unit_cost: 0, total_cost: 0, stock_value: 0 },
    }));
    stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);

    const txOrderUpdateMerma = jest.fn().mockResolvedValue({
      id: 200,
      status: 'completed',
      produced_qty: new Prisma.Decimal(10),
      product: { id: 50, name: 'Salsa', sku: 'S', stock_unit: 'g' },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(5),
      },
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({ production_orders: { update: txOrderUpdateMerma, updateMany: claimOk } }),
    );
    prismaMock.production_orders.update.mockResolvedValue({
      id: 200,
      status: 'completed',
      produced_qty: new Prisma.Decimal(10),
    } as any);

    await service.complete(200, { produced_qty: 10 });

    const consumeCall = stockLevelManager.updateStock.mock.calls[0];
    // 1.10 * 1.05 = 1.155 → 10 * 1.155 = 11.55, y el servicio redondea a 12.
    //
    // El redondeo NO es una pérdida de precisión evitable: `stock_levels`
    // guarda `quantity_on_hand/reserved/available` como `Int`, y también
    // `inventory_movements.quantity`. Un consumo de 11,55 unidades no se puede
    // ni escribir ni asentar. Este test esperaba 11,55 —un valor que el
    // almacenamiento no admite— así que afirmaba una precisión que el sistema
    // nunca tuvo. Lo que sí importa y queda fijado acá es que la merma es
    // MULTIPLICATIVA (línea × receta), no aditiva: 12, no 11 (10 × 1,15).
    expect(consumeCall[0].quantity_change).toBe(-12);
  });

  it('rejects a complete() with produced_qty <= 0', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue({
      id: 300,
      store_id: 1,
      product_id: 50,
      recipe_id: 7,
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      status: 'draft',
      produced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      product: { id: 50, name: 'S', sku: 'S', stock_unit: 'g', is_batch_produced: true },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(0),
        items: [
          {
            id: 1,
            recipe_id: 7,
            component_product_id: 99,
            quantity: new Prisma.Decimal(10),
            waste_percent: new Prisma.Decimal(0),
            is_optional: false,
            component_product: { id: 99, name: 'H', sku: 'H', stock_unit: 'g' },
          },
        ],
      },
    } as any);

    await expect(
      service.complete(300, { produced_qty: 0 }),
    ).rejects.toThrow(VendixHttpException);
  });

  it('cancels draft orders idempotently', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue({
      id: 400,
      store_id: 1,
      product_id: 50,
      recipe_id: 7,
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      status: 'cancelled',
      produced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      product: { id: 50, name: 'S', sku: 'S', stock_unit: 'g', is_batch_produced: true },
      recipe: { id: 7, yield_quantity: new Prisma.Decimal(10), yield_unit: 'g', waste_percent: new Prisma.Decimal(0), items: [] },
    } as any);

    const result = await service.cancel(400);
    expect(result.status).toBe('cancelled');
    expect(prismaMock.production_orders.update).not.toHaveBeenCalled();
  });

  describe('no-overselling ingredient guard (docs/plans/no-overselling-stock-guard-plan.md, step 6)', () => {
    it('rejects an insufficient tracked ingredient BEFORE opening the transaction — 409, no stock movement', async () => {
      prismaMock.production_orders.findFirst.mockResolvedValue({
        id: 500,
        store_id: 1,
        product_id: 50,
        recipe_id: 7,
        planned_qty: new Prisma.Decimal(10),
        produced_qty: null,
        status: 'in_progress',
        produced_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        product: {
          id: 50,
          name: 'Salsa de tomate',
          sku: 'SAL-1',
          stock_unit: 'g',
          is_batch_produced: true,
        },
        recipe: {
          id: 7,
          yield_quantity: new Prisma.Decimal(10),
          yield_unit: 'g',
          waste_percent: new Prisma.Decimal(0),
          preparation_notes: null,
          items: [
            {
              id: 1,
              recipe_id: 7,
              component_product_id: 99,
              quantity: new Prisma.Decimal(10),
              waste_percent: new Prisma.Decimal(0),
              is_optional: false,
              component_product: {
                id: 99,
                name: 'Harina',
                sku: 'HAR-1',
                stock_unit: 'g',
              },
            },
          ],
        },
      } as any);

      stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);

      const insufficiencyError = new VendixHttpException(
        ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
        'Insumo sin stock suficiente: Harina (requerido 10, disponible 4).',
        {
          items: [
            {
              product_id: 99,
              product_variant_id: null,
              product_name: 'Harina',
              kind: 'ingredient',
              requested: 10,
              available: 4,
              used_by: ['Salsa de tomate'],
            },
          ],
        },
      );
      stockValidatorService.assertIngredientsAvailable.mockRejectedValueOnce(
        insufficiencyError,
      );

      let caught: any;
      try {
        await service.complete(500, { produced_qty: 10 });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught.errorCode).toBe('INV_STOCK_INSUFFICIENT_LINES');
      expect(caught.getResponse()).toMatchObject({
        details: {
          items: [expect.objectContaining({ kind: 'ingredient' })],
        },
      });

      // Nothing was consumed and the transaction never opened — the check
      // runs BEFORE `complete()` calls `this.prisma.$transaction`.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });
  });

  describe('ingredient overuse switch (docs/plans/no-overselling-stock-guard-plan.md, step 9)', () => {
    const buildOrder = (id: number) => ({
      id,
      store_id: 1,
      product_id: 50,
      recipe_id: 7,
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      status: 'in_progress',
      produced_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      product: { id: 50, name: 'Salsa', sku: 'SAL-1', stock_unit: 'g', is_batch_produced: true },
      recipe: {
        id: 7,
        yield_quantity: new Prisma.Decimal(10),
        yield_unit: 'g',
        waste_percent: new Prisma.Decimal(0),
        preparation_notes: null,
        items: [
          {
            id: 1,
            recipe_id: 7,
            component_product_id: 99,
            quantity: new Prisma.Decimal(10),
            waste_percent: new Prisma.Decimal(0),
            is_optional: false,
            component_product: { id: 99, name: 'Harina', sku: 'HAR-1', stock_unit: 'g' },
          },
        ],
      },
    });

    it('switch ON: a shortage only warns, consumption writes allow_negative + validate_availability=false, response carries stock_warnings', async () => {
      prismaMock.production_orders.findFirst.mockResolvedValue(
        buildOrder(600) as any,
      );
      stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
      stockLevelManager.updateStock.mockResolvedValue({
        stock_level: { id: 1 } as any,
        transaction: { id: 1 } as any,
        previous_quantity: 0,
        cost_snapshot: { unit_cost: 0.1, total_cost: 1.0, stock_value: 0 },
      });

      const shortageItems = [
        {
          product_id: 99,
          product_variant_id: null,
          product_name: 'Harina',
          kind: 'ingredient' as const,
          requested: 10,
          available: 0,
          used_by: ['Salsa'],
        },
      ];
      stockValidatorService.resolveInventoryPolicy.mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: true,
      });
      stockValidatorService.assertIngredientsAvailable.mockResolvedValue(
        shortageItems as any,
      );

      const txOrderUpdate = jest.fn().mockResolvedValue({
        id: 600,
        status: 'completed',
        produced_qty: new Prisma.Decimal(10),
        product: { id: 50, name: 'Salsa', sku: 'SAL-1', stock_unit: 'g' },
        recipe: { id: 7, yield_quantity: new Prisma.Decimal(10), yield_unit: 'g', waste_percent: new Prisma.Decimal(0) },
      });
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({ production_orders: { update: txOrderUpdate, updateMany: claimOk } }),
      );

      const result = await service.complete(600, { produced_qty: 10 });

      // The switch is on: assertIngredientsAvailable never throws, complete()
      // proceeds to consume — and it must have been asked to allow overuse.
      expect(
        stockValidatorService.assertIngredientsAvailable,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ allowIngredientOveruse: true }),
      );

      const [consumeCall] = stockLevelManager.updateStock.mock.calls;
      expect(consumeCall[0].movement_type).toBe('consumption');
      // Full requested quantity is still consumed — no silent reduction.
      expect(consumeCall[0].quantity_change).toBeCloseTo(-10, 4);
      expect(consumeCall[0].validate_availability).toBe(false);
      expect(consumeCall[0].allow_negative).toBe(true);

      expect((result as any).stock_warnings).toEqual(shortageItems);
    });

    it('switch OFF: resolveInventoryPolicy(false) still blocks via the strict guard (no consumption)', async () => {
      prismaMock.production_orders.findFirst.mockResolvedValue(
        buildOrder(700) as any,
      );
      stockValidatorService.resolveInventoryPolicy.mockResolvedValue({
        allowOversell: false,
        allowIngredientOveruse: false,
      });
      const insufficiencyError = new VendixHttpException(
        ErrorCodes.INV_STOCK_INSUFFICIENT_LINES,
        'Insumo sin stock suficiente: Harina (requerido 10, disponible 0).',
        { items: [] },
      );
      stockValidatorService.assertIngredientsAvailable.mockRejectedValueOnce(
        insufficiencyError,
      );

      await expect(
        service.complete(700, { produced_qty: 10 }),
      ).rejects.toMatchObject({ errorCode: 'INV_STOCK_INSUFFICIENT_LINES' });

      expect(
        stockValidatorService.assertIngredientsAvailable,
      ).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ allowIngredientOveruse: false }),
      );
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });
  });
  describe('yield scaling of ingredient consumption (QUI-965)', () => {
    const run = async (opts: {
      yieldQty: number | null;
      produced: number;
      lineQty: number;
      linePct?: number;
      recipePct?: number;
      mode?: 'percent' | 'absolute';
      wasteAbs?: number;
    }) => {
      prismaMock.production_orders.findFirst.mockResolvedValue({
        id: 900,
        store_id: 1,
        product_id: 50,
        recipe_id: 7,
        planned_qty: new Prisma.Decimal(opts.produced),
        produced_qty: null,
        status: 'draft',
        produced_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        product: { id: 50, name: 'Salsa', sku: 'S', stock_unit: 'g', is_batch_produced: true },
        recipe: {
          id: 7,
          yield_quantity:
            opts.yieldQty === null ? null : new Prisma.Decimal(opts.yieldQty),
          yield_unit: 'g',
          waste_percent: new Prisma.Decimal(opts.recipePct ?? 0),
          items: [
            {
              id: 1,
              recipe_id: 7,
              component_product_id: 99,
              quantity: new Prisma.Decimal(opts.lineQty),
              waste_percent: new Prisma.Decimal(opts.linePct ?? 0),
              waste_mode: opts.mode ?? 'percent',
              waste_absolute: new Prisma.Decimal(opts.wasteAbs ?? 0),
              is_optional: false,
              component_product: { id: 99, name: 'H', sku: 'H', stock_unit: 'g' },
            },
          ],
        },
      } as any);
      stockLevelManager.updateStock.mockImplementation(async () => ({
        stock_level: { id: 1 } as any,
        transaction: { id: 1 } as any,
        previous_quantity: 0,
        cost_snapshot: { unit_cost: 0, total_cost: 0, stock_value: 0 },
      }));
      stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
      const updated = {
        id: 900,
        status: 'completed',
        produced_qty: new Prisma.Decimal(opts.produced),
        product: { id: 50, name: 'Salsa', sku: 'S', stock_unit: 'g' },
        recipe: { id: 7, yield_quantity: new Prisma.Decimal(1), yield_unit: 'g', waste_percent: new Prisma.Decimal(0) },
      };
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({ production_orders: { update: jest.fn().mockResolvedValue(updated), updateMany: claimOk } }),
      );
      prismaMock.production_orders.update.mockResolvedValue(updated as any);
      await service.complete(900, { produced_qty: opts.produced });
      return stockLevelManager.updateStock.mock.calls[0][0].quantity_change;
    };

    it('yield 1, produce 10, line 100 -> consumes 1000', async () => {
      expect(await run({ yieldQty: 1, produced: 10, lineQty: 100 })).toBe(-1000);
    });

    it('yield 10, produce 10, line 100 -> consumes 100', async () => {
      expect(await run({ yieldQty: 10, produced: 10, lineQty: 100 })).toBe(-100);
    });

    it('yield 10, produce 30 (3 batches), line 100 -> consumes 300', async () => {
      expect(await run({ yieldQty: 10, produced: 30, lineQty: 100 })).toBe(-300);
    });

    it('percent waste applies on top of the scaled quantity (line% x recipe%)', async () => {
      // 100 * 2 * 1.10 * 1.05 = 231
      expect(
        await run({ yieldQty: 5, produced: 10, lineQty: 100, linePct: 10, recipePct: 5 }),
      ).toBe(-231);
    });

    it('absolute waste is per batch, so it scales with the factor', async () => {
      // (100 + 10) * 2 * 1.05 = 231
      expect(
        await run({
          yieldQty: 5,
          produced: 10,
          lineQty: 100,
          mode: 'absolute',
          wasteAbs: 10,
          recipePct: 5,
        }),
      ).toBe(-231);
    });

    it('degenerate yield (null) is treated as 1 and does not throw', async () => {
      expect(await run({ yieldQty: null, produced: 10, lineQty: 100 })).toBe(-1000);
    });

    it('rejects a produced quantity that is not a multiple of the recipe yield (yield 10, produce 25)', async () => {
      await expect(run({ yieldQty: 10, produced: 25, lineQty: 100 })).rejects.toMatchObject({
        errorCode: 'PRODUCTION_QTY_NOT_YIELD_MULTIPLE',
      });
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
      expect(stockValidatorService.assertIngredientsAvailable).not.toHaveBeenCalled();
    });

    it('rejects producing less than one batch (yield 10, produce 3)', async () => {
      await expect(run({ yieldQty: 10, produced: 3, lineQty: 1 })).rejects.toMatchObject({
        errorCode: 'PRODUCTION_QTY_NOT_YIELD_MULTIPLE',
      });
      expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    });

    it('the stock pre-check receives the same scaled quantity', async () => {
      await run({ yieldQty: 1, produced: 10, lineQty: 100 });
      expect(stockValidatorService.assertIngredientsAvailable).toHaveBeenCalledWith(
        [expect.objectContaining({ product_id: 99, quantity: 1000 })],
        expect.anything(),
      );
    });
  });
  describe('create() — planned quantity must be whole recipe batches (QUI-965)', () => {
    const arrange = (yieldQty: number) => {
      (prismaMock as any).products = {
        findFirst: jest.fn().mockResolvedValue({
          id: 50,
          name: 'Salsa',
          product_type: 'physical',
          is_batch_produced: true,
          store_id: 1,
        }),
      };
      (prismaMock as any).recipes = {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          product_id: 50,
          is_active: true,
          yield_quantity: new Prisma.Decimal(yieldQty),
          yield_unit: 'und',
        }),
      };
      (prismaMock.production_orders as any).create = jest
        .fn()
        .mockResolvedValue({ id: 1, status: 'draft' });
    };

    it('accepts 3 batches of a recipe that yields 10 (planned 30)', async () => {
      arrange(10);
      await service.create({ product_id: 50, recipe_id: 7, planned_qty: 30 } as any);
      expect((prismaMock.production_orders as any).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planned_qty: new Prisma.Decimal(30) }),
        }),
      );
    });

    it('rejects a planned quantity that is not a multiple of the recipe yield', async () => {
      arrange(10);
      await expect(
        service.create({ product_id: 50, recipe_id: 7, planned_qty: 25 } as any),
      ).rejects.toMatchObject({ errorCode: 'PRODUCTION_QTY_NOT_YIELD_MULTIPLE' });
      expect((prismaMock.production_orders as any).create).not.toHaveBeenCalled();
    });
  });
  describe('getStats() — "Completadas (mes)" counts only the current month (QUI-997)', () => {
    afterEach(() => jest.useRealTimers());

    it('limits the completed count to orders produced since the start of the month in the store timezone', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-15T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });

      await service.getStats();

      // America/Bogota (UTC-5) month start: 2026-11-01T00:00 local = 05:00 UTC.
      const monthStart = new Date('2026-11-01T05:00:00.000Z');
      expect(prismaMock.production_orders.count).toHaveBeenCalledWith({
        where: { store_id: 1, status: 'completed', produced_at: { gte: monthStart } },
      });
    });
  });
});


describe('ProductionOrdersService — sale-linked orders (QUI-995)', () => {
  const ctx = { store_id: 1, organization_id: 1, user_id: 42, is_super_admin: false };
  let service: ProductionOrdersService;
  let stock: { updateStock: jest.Mock; getDefaultLocationForProduct: jest.Mock; reserveStock: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let orderStockCommit: { commitOrderLines: jest.Mock };
  let prismaMock: any;
  let tx: any;

  const linkedOrder = (over: Record<string, unknown> = {}) => ({
    id: 100,
    store_id: 1,
    product_id: 50,
    recipe_id: 7,
    order_id: 77,
    planned_qty: new Prisma.Decimal(3),
    produced_qty: null,
    status: 'in_progress',
    product: { id: 50, name: 'Torta', sku: 'T', stock_unit: 'u', is_batch_produced: true },
    recipe: {
      id: 7,
      yield_quantity: new Prisma.Decimal(10),
      yield_unit: 'u',
      waste_percent: new Prisma.Decimal(0),
      items: [
        {
          component_product_id: 99,
          quantity: new Prisma.Decimal(10),
          waste_percent: new Prisma.Decimal(0),
          component_product: { id: 99, name: 'Harina', sku: 'H', stock_unit: 'g' },
        },
      ],
    },
    ...over,
  });

  const line = (over: Record<string, unknown> = {}) => ({
    id: 501,
    product_id: 50,
    product_variant_id: null,
    quantity: 3,
    addons_consumed_at: null,
    order_item_options: [
      {
        scope: 'per_unit',
        component_type: 'ingredient',
        component_product_id: 200,
        component_variant_id: null,
        quantity: 2,
      },
    ],
    ...over,
  });

  const setup = (opts: {
    order?: any;
    claimCount?: number;
    addonClaimCount?: number;
    sale?: { id: number; state: string } | null;
    lines?: any[];
    pendingLines?: any[];
  }) => {
    prismaMock.production_orders.findFirst.mockResolvedValue(opts.order ?? linkedOrder());
    tx = {
      production_orders: {
        updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 100,
          status: 'completed',
          ...data,
        })),
      },
      order_items: {
        findMany: jest
          .fn()
          .mockImplementation(async ({ where }: any) =>
            where.inventory_committed === false ? (opts.pendingLines ?? []) : (opts.lines ?? [line()]),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: opts.addonClaimCount ?? 1 }),
      },
      orders: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.sale === undefined ? { id: 77, state: 'processing' } : opts.sale),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(tx));
  };

  beforeEach(() => {
    stock = {
      updateStock: jest.fn().mockResolvedValue({
        cost_snapshot: { unit_cost: 1, total_cost: 5, stock_value: 0 },
      }),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
      reserveStock: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = { emit: jest.fn() };
    orderStockCommit = { commitOrderLines: jest.fn().mockResolvedValue({ totalCost: 0, committedItemCount: 1 }) };
    prismaMock = {
      production_orders: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
      orders: { findFirst: jest.fn() },
      order_items: { findMany: jest.fn() },
      recipes: { findMany: jest.fn().mockResolvedValue([]) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
    service = new ProductionOrdersService(
      prismaMock,
      stock as any,
      {
        assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
        resolveInventoryPolicy: jest
          .fn()
          .mockResolvedValue({ allowOversell: false, allowIngredientOveruse: true }),
      } as any,
      eventEmitter as any,
      {} as any,
      orderStockCommit as any,
      { signUrl: jest.fn(async (k: string) => `signed:${k}`) } as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('concurrent completion: the state claim finds 0 rows -> PRODUCTION_ORDER_CONCURRENT_UPDATE and nothing moves or is reserved', async () => {
    setup({ claimCount: 0 });
    await expect(service.complete(100, { produced_qty: 3 })).rejects.toMatchObject({
      errorCode: 'PRODUCTION_ORDER_CONCURRENT_UPDATE',
    });
    expect(tx.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: 100, status: 'in_progress', produced_qty: null },
      data: expect.objectContaining({ updated_at: expect.any(Date) }),
    });
    expect(stock.updateStock).not.toHaveBeenCalled();
    expect(stock.reserveStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('linked completion is not forced into whole recipe batches (yield 10, sold 3)', async () => {
    setup({});
    const result = await service.complete(100, { produced_qty: 3 });
    expect(result.status).toBe('completed');
  });

  it('claims the add-ons of the sale lines once and adds their cost to the order cost', async () => {
    setup({});
    await service.complete(100, { produced_qty: 3 });
    expect(tx.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: 501, addons_consumed_at: null },
      data: { addons_consumed_at: expect.any(Date) },
    });
    const addonCall = stock.updateStock.mock.calls
      .map((c) => c[0])
      .find((c) => c.product_id === 200);
    // 2 per unit x 3 units
    expect(addonCall).toMatchObject({ movement_type: 'consumption', quantity_change: -6, location_id: 1 });
    // recipe line (5) + add-on (5) = 10 -> one production.completed with the joint cost
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'production.completed',
      expect.objectContaining({ production_order_id: 100, total_cost: 10, consumed_line_count: 2 }),
    );
  });

  it('does not consume the add-ons again when another path already claimed the line (claim count 0)', async () => {
    setup({ addonClaimCount: 0 });
    await service.complete(100, { produced_qty: 3 });
    expect(stock.updateStock.mock.calls.map((c) => c[0].product_id)).not.toContain(200);
  });

  it('reserves min(produced, planned) for the sale without availability validation', async () => {
    setup({});
    await service.complete(100, { produced_qty: 5 });
    expect(stock.reserveStock).toHaveBeenCalledTimes(1);
    expect(stock.reserveStock).toHaveBeenCalledWith(50, undefined, 1, 3, 'order', 77, 42, false, tx);
  });

  it('sale already delivered: sells what was produced through the delivery commit and reserves nothing', async () => {
    setup({ sale: { id: 77, state: 'delivered' }, pendingLines: [{ id: 501 }, { id: 502 }] });
    await service.complete(100, { produced_qty: 3 });
    expect(orderStockCommit.commitOrderLines).toHaveBeenCalledWith(77, [501, 502], {
      blockOnInsufficient: false,
      tx,
      movementType: 'sale',
      reason: expect.stringContaining('Producción #100'),
    });
    expect(stock.reserveStock).not.toHaveBeenCalled();
  });

  it('sale cancelled: nothing is reserved nor sold', async () => {
    setup({ sale: { id: 77, state: 'cancelled' } });
    await service.complete(100, { produced_qty: 3 });
    expect(stock.reserveStock).not.toHaveBeenCalled();
    expect(orderStockCommit.commitOrderLines).not.toHaveBeenCalled();
  });

  it('manual order (no sale): no add-ons, no reservation, still one production.completed (behavior unchanged)', async () => {
    setup({ order: linkedOrder({ order_id: null, planned_qty: new Prisma.Decimal(10) }) });
    await service.complete(100, { produced_qty: 10 });
    expect(tx.order_items.findMany).not.toHaveBeenCalled();
    expect(tx.orders.findFirst).not.toHaveBeenCalled();
    expect(stock.reserveStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('manual order still enforces whole recipe batches', async () => {
    setup({ order: linkedOrder({ order_id: null }) });
    await expect(service.complete(100, { produced_qty: 3 })).rejects.toMatchObject({
      errorCode: 'PRODUCTION_QTY_NOT_YIELD_MULTIPLE',
    });
  });

  it('findAll filters by order_id and returns sale_order_number', async () => {
    prismaMock.production_orders.findMany.mockResolvedValue([
      { id: 1, order_id: 77, source: 'order', sale_order: { order_number: 'ORD-9' } },
      { id: 2, order_id: null, source: 'manual', sale_order: null },
    ]);
    prismaMock.production_orders.count.mockResolvedValue(2);
    const result = await service.findAll({ order_id: 77 } as any);
    expect(prismaMock.production_orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ order_id: 77 }) }),
    );
    expect(result.data.map((r: any) => r.sale_order_number)).toEqual(['ORD-9', null]);
    expect((result.data[0] as any).sale_order).toBeUndefined();
  });

  it('getDetail exposes base_recipe, sale_order and order_lines with add-ons', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue(
      linkedOrder({ due_date: new Date('2026-11-10T10:00:00Z') }),
    );
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 77,
      order_number: 'ORD-77',
      state: 'processing',
      customer_alias: 'Mesa 4',
      users: { first_name: 'Ana', last_name: 'Ruiz' },
      fulfillment_schedule: { scheduled_start: new Date('2026-11-10T15:00:00Z') },
    });
    prismaMock.order_items.findMany.mockResolvedValue([
      {
        id: 501,
        quantity: 3,
        notes: 'sin nueces',
        order_item_options: [
          {
            group_name: 'Relleno',
            option_name: 'Crema',
            note: 'poca',
            component_type: 'recipe',
            component_product_id: 300,
            component_variant_id: null,
          },
        ],
      },
    ]);
    prismaMock.recipes.findMany.mockResolvedValue([
      {
        product_id: 300,
        product_variant_id: null,
        items: [{ quantity: 2, component_product: { id: 301, name: 'Leche', stock_unit: 'ml' } }],
      },
    ]);
    prismaMock.products.findMany.mockResolvedValue([
      { id: 300, product_images: [{ image_url: 'k/crema.png' }] },
    ]);

    const detail: any = await service.getDetail(100);

    expect(detail.base_recipe).toEqual({
      id: 7,
      components: [{ product_id: 99, name: 'Harina', quantity: 10, unit: 'g', image_url: null }],
    });
    expect(detail.sale_order).toEqual({
      id: 77,
      order_number: 'ORD-77',
      state: 'processing',
      customer_name: 'Ana Ruiz',
      due_at: new Date('2026-11-10T15:00:00Z'),
    });
    expect(detail.order_lines).toEqual([
      {
        order_item_id: 501,
        quantity: 3,
        notes: 'sin nueces',
        addons: [
          {
            group_name: 'Relleno',
            option_name: 'Crema',
            note: 'poca',
            image_url: 'signed:k/crema.png',
            recipe: {
              components: [
                { product_id: 301, name: 'Leche', quantity: 2, unit: 'ml', image_url: null },
              ],
            },
          },
        ],
      },
    ]);
    expect(detail.order_id).toBe(77);
  });

  it('getDetail of a manual order returns sale_order null and no lines', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue(linkedOrder({ order_id: null }));
    const detail: any = await service.getDetail(100);
    expect(detail.sale_order).toBeNull();
    expect(detail.order_lines).toEqual([]);
  });

  it('getDetail survives an image signing failure: the detail loads and that image is null', async () => {
    prismaMock.production_orders.findFirst.mockResolvedValue(linkedOrder({ order_id: null }));
    prismaMock.products.findMany.mockResolvedValue([
      { id: 99, product_images: [{ image_url: 'k/harina.png' }] },
    ]);
    (service as any).s3Service.signUrl = jest.fn().mockRejectedValue(new Error('S3 down'));

    const detail: any = await service.getDetail(100);

    expect(detail.base_recipe.components).toEqual([
      { product_id: 99, name: 'Harina', quantity: 10, unit: 'g', image_url: null },
    ]);
    expect(detail.sale_order).toBeNull();
  });
});
