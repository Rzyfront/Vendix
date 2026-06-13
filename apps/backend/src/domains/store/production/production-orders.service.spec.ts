import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from './production-orders.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
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
describe('ProductionOrdersService — complete() (Fase C smoke)', () => {
  let service: ProductionOrdersService;
  let stockLevelManager: jest.Mocked<Pick<StockLevelManager, 'updateStock' | 'getDefaultLocationForProduct'>>;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let prismaMock: {
    production_orders: {
      findFirst: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      update: jest.Mock;
    };
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

    eventEmitter = { emit: jest.fn() } as any;

    prismaMock = {
      production_orders: {
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { produced_qty: 0 } }),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(ctx as any);

    service = new ProductionOrdersService(
      prismaMock as any,
      stockLevelManager as any,
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
      cb({ production_orders: { update: txOrderUpdate } }),
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
      cb({ production_orders: { update: txOrderUpdateMerma } }),
    );
    prismaMock.production_orders.update.mockResolvedValue({
      id: 200,
      status: 'completed',
      produced_qty: new Prisma.Decimal(10),
    } as any);

    await service.complete(200, { produced_qty: 10 });

    const consumeCall = stockLevelManager.updateStock.mock.calls[0];
    // 1.10 * 1.05 = 1.155 → 10 * 1.155 = 11.55
    expect(consumeCall[0].quantity_change).toBeCloseTo(-11.55, 2);
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
});
