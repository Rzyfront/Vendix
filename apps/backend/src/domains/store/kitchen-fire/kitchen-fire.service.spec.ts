import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { KitchenFireService } from './kitchen-fire.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RecipesService } from '../recipes/recipes.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';

interface FakeStockLevel {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  cost_per_unit: any;
}

/**
 * Targeted unit tests for `KitchenFireService.fireOrderItems()`.
 *
 * These tests exercise the heart of Fase D:
 *  - 3 prepared order_items (1 with merma, 1 with sub-recipe, 1 raw)
 *    are consumed via StockLevelManager.updateStock with
 *    `movement_type='consumption'` and a negative `quantity_change`.
 *  - `order_items.inventory_consumed_at_fire` is flipped to TRUE.
 *  - The COGS total emitted on the `kitchen.fired` event equals the sum
 *    of `cost_snapshot.total_cost` returned by every consumption.
 *  - Idempotency: re-firing the same order_item does NOT trigger
 *    additional stock updates and re-emits a `KITCHEN_FIRE_ALL_ALREADY_CONSUMED`
 *    style error.
 *
 * The test mocks `RecipesService.explodeBom` to return synthetic BOMs
 * (no need to walk the recursive recipe graph) and stubs
 * `StockLevelManager.updateStock` to return deterministic
 * `cost_snapshot` values per call.
 */
describe('KitchenFireService — fireOrderItems() (Fase D smoke)', () => {
  let service: KitchenFireService;
  let recipesService: any;
  let stockLevelManager: jest.Mocked<
    Pick<StockLevelManager, 'updateStock' | 'getDefaultLocationForProduct'>
  >;
  let eventEmitter: jest.Mocked<Pick<EventEmitter2, 'emit'>>;
  let prismaMock: any;

  const ctx = {
    store_id: 1,
    organization_id: 1,
    user_id: 42,
    is_super_admin: false,
  };

  const makeOrderItem = (
    id: number,
    productId: number,
    productType: string,
    alreadyFired = false,
  ) => ({
    id,
    order_id: 100,
    product_id: productId,
    product_name: `Plato ${id}`,
    quantity: 2,
    inventory_consumed_at_fire: alreadyFired,
    products: {
      id: productId,
      name: `Plato ${id}`,
      product_type: productType,
      track_inventory: true,
      store_id: 1,
    },
  });

  beforeEach(() => {
    recipesService = {
      explodeBom: jest.fn(),
    };

    stockLevelManager = {
      updateStock: jest.fn(),
      getDefaultLocationForProduct: jest.fn(),
    } as any;

    eventEmitter = { emit: jest.fn() } as any;

    prismaMock = {
      orders: {
        findFirst: jest.fn(),
      },
      recipes: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(ctx as any);

    service = new KitchenFireService(
      prismaMock as any,
      recipesService as RecipesService,
      stockLevelManager as any,
      eventEmitter as any,
      { push: jest.fn() } as any,
    );
  });

  it('consumes 3 leaf components (merma + sub-recipe + direct), flips flag, emits kitchen.fired with COGS', async () => {
    // Order has 1 prepared order_item (id=10, product=50) and the
    // operator asked to fire only that one. The other 2 items in the
    // request are non-prepared (services) and are skipped.
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-1',
      order_items: [
        makeOrderItem(10, 50, 'prepared', false), // ← fires
        makeOrderItem(11, 51, 'service', false), // ← skipped (service)
        makeOrderItem(12, 52, 'physical', false), // ← skipped (physical)
      ],
    });

    prismaMock.recipes.findFirst.mockResolvedValue({
      id: 7,
      product_id: 50,
      is_active: true,
    });

    // explodeBom returns 3 leaves:
    //   - product 99 (harina, direct, with 10% merma → 1.10)
    //   - product 80 (sub-recipe 'salsa', already resolved at the leaf)
    //   - product 70 (insumo directo, 0% merma)
    // multiplied by qty=2 (order_item.quantity) at the call site.
    recipesService.explodeBom.mockResolvedValue([
      { component_product_id: 99, quantity: 1.1, depth: 1, path_recipe_ids: [] },
      { component_product_id: 80, quantity: 0.5, depth: 1, path_recipe_ids: [] },
      { component_product_id: 70, quantity: 3, depth: 1, path_recipe_ids: [] },
    ]);

    stockLevelManager.getDefaultLocationForProduct.mockImplementation(
      async (pid: number) => 100 + pid,
    );

    // Per-leaf FIFO cost snapshot. We compute total = 0.20*2.2 + 0.50*1.0 + 0.10*6.0
    // = 0.44 + 0.50 + 0.60 = 1.54
    stockLevelManager.updateStock.mockImplementation(async (params) => {
      let cost = 0;
      if (params.product_id === 99) cost = 0.2 * 2.2; // harina: 0.20 × 2.2
      else if (params.product_id === 80) cost = 0.5 * 1.0; // salsa: 0.50 × 1.0
      else if (params.product_id === 70) cost = 0.1 * 6.0; // insumo: 0.10 × 6.0
      return {
        stock_level: { id: params.product_id } as FakeStockLevel,
        transaction: { id: params.product_id } as any,
        previous_quantity: 100,
        cost_snapshot: {
          unit_cost: cost / Math.abs(params.quantity_change),
          total_cost: cost,
          stock_value: 0,
        },
      };
    });

    // $transaction executes the callback with a fake tx that supports
    // order_items.update, kitchen_tickets.create (with nested items.create).
    const orderItemUpdate = jest.fn().mockResolvedValue({ id: 10 });
    const ticketCreate = jest.fn().mockResolvedValue({
      id: 555,
      items: [
        { id: 1, order_item_id: 10, product_id: 50, quantity: 2, status: 'pending' },
      ],
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        order_items: { update: orderItemUpdate },
        kitchen_tickets: { create: ticketCreate },
      }),
    );

    // 1) Call
    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10, 11, 12],
    });

    // 2) Assertions
    // (a) 3 updateStock calls — one per leaf, all 'consumption' negative
    expect(stockLevelManager.updateStock).toHaveBeenCalledTimes(3);
    for (const call of stockLevelManager.updateStock.mock.calls) {
      expect(call[0].movement_type).toBe('consumption');
      expect(call[0].quantity_change).toBeLessThan(0);
      expect(call[0].source_module).toBe('kitchen_fire');
    }
    // (b) The leaf product ids were 99, 80, 70 in that order (order of
    //     the bomLines array is preserved)
    const calledProductIds = stockLevelManager.updateStock.mock.calls.map(
      (c) => c[0].product_id,
    );
    expect(calledProductIds).toEqual([99, 80, 70]);
    // (c) Quantities reflect qty=2 multiplier: 1.1*2=2.2, 0.5*2=1.0, 3*2=6.0
    expect(stockLevelManager.updateStock.mock.calls[0][0].quantity_change).toBeCloseTo(
      -2.2,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[1][0].quantity_change).toBeCloseTo(
      -1.0,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[2][0].quantity_change).toBeCloseTo(
      -6.0,
      4,
    );

    // (d) Flag flipped on the prepared order_item only
    expect(orderItemUpdate).toHaveBeenCalledTimes(1);
    expect(orderItemUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { inventory_consumed_at_fire: true },
    });

    // (e) Ticket created with the nested items
    expect(ticketCreate).toHaveBeenCalledTimes(1);
    const ticketArgs = ticketCreate.mock.calls[0][0];
    expect(ticketArgs.data.store_id).toBe(1);
    expect(ticketArgs.data.order_id).toBe(100);
    expect(ticketArgs.data.status).toBe('pending');
    expect(ticketArgs.data.items.create).toHaveLength(1);

    // (f) Returned result includes the right fired/skipped partition
    expect(result.fired_item_ids).toEqual([10]);
    expect(result.skipped_item_ids).toEqual([11, 12]);
    expect(result.kitchen_ticket_id).toBe(555);
    expect(result.consumed_line_count).toBe(3);

    // (g) COGS = 0.44 + 0.50 + 0.60 = 1.54
    expect(result.cogs_total).toBeCloseTo(1.54, 2);

    // (h) kitchen.fired event emitted once with the right payload
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'kitchen.fired',
      expect.objectContaining({
        kitchen_ticket_id: 555,
        order_id: 100,
        organization_id: 1,
        store_id: 1,
        consumed_line_count: 3,
        total_cost: expect.closeTo(1.54, 2),
        user_id: 42,
      }),
    );
  });

  it('is idempotent: re-firing the same already-consumed item is a no-op (no stock movement, no event)', async () => {
    // Order has the only target item already flagged
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-2',
      order_items: [makeOrderItem(10, 50, 'prepared', true)],
    });

    // No stock updates, no transaction, no event
    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).rejects.toBeInstanceOf(VendixHttpException);

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a fire request that contains only non-prepared items', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-3',
      order_items: [makeOrderItem(11, 51, 'service', false)],
    });

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [11] }),
    ).rejects.toBeInstanceOf(VendixHttpException);

    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
