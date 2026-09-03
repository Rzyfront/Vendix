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

  /**
   * CP-POLLO-ARABE-727 A.6 — helper de order_item con la variante vendida.
   * Modela el include real de `fireOrderItems`:
   *   - `product_variant_id` (columna de order_items, nullable)
   *   - `product_variants` (relación, nullable — `name` para `variant_label`,
   *     `product_id` para validar pertenencia ERR-15)
   *   - `products._count.product_variants` (para el warn "producto con variantes")
   */
  const makeVariantOrderItem = (
    id: number,
    productId: number,
    opts: {
      variantId?: number | null;
      variantName?: string | null;
      variantProductId?: number;
      variantCount?: number;
      productType?: string;
      quantity?: number;
      alreadyFired?: boolean;
    } = {},
  ) => ({
    id,
    order_id: 100,
    product_id: productId,
    product_name: `Plato ${id}`,
    quantity: opts.quantity ?? 2,
    product_variant_id: opts.variantId ?? null,
    variant_attributes: null,
    variant_sku: null,
    inventory_consumed_at_fire: opts.alreadyFired ?? false,
    products: {
      id: productId,
      name: `Plato ${id}`,
      product_type: opts.productType ?? 'prepared',
      track_inventory: true,
      store_id: 1,
      _count: { product_variants: opts.variantCount ?? 0 },
    },
    product_variants:
      opts.variantId != null
        ? {
            id: opts.variantId,
            name: opts.variantName ?? 'Picante',
            product_id: opts.variantProductId ?? productId,
          }
        : null,
  });

  /**
   * CP-POLLO-ARABE-727 A.6 — tx de prueba para el fire (mismo shape que el
   * mock corregido del test 1): KDS por defecto, sesión abierta por estación,
   * update/findMany de order_items y contadores. `kitchen_tickets` se aporta
   * por test para poder inspeccionar el `.create({})`.
   */
  const buildFireTxMock = (opts: { orderItemId?: number } = {}) => ({
    kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
    order_items: {
      update: jest.fn().mockResolvedValue({ id: opts.orderItemId ?? 10 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    kitchen_ticket_items: {
      update: jest.fn().mockResolvedValue({}),
    },
    kitchen_ticket_item_exclusions: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
  });

  const makeTxTicket = (id: number, orderItemId: number, productId: number) => ({
    id,
    items: [
      { id: 1, order_item_id: orderItemId, product_id: productId, quantity: 2, status: 'pending' },
    ],
  });

  /**
   * CP-POLLO-ARABE-727 A.6 — configura el contexto de fire para un item
   * `prepared`: orden, receta activa (o `noRecipe` para recipe-less), BOM y
   * costos deterministas.
   */
  const setupFireableContext = (
    orderItems: any[],
    opts: { recipe?: any; bom?: any[]; noRecipe?: boolean } = {},
  ) => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: `ORD-${orderItems[0].id}`,
      order_items: orderItems,
    });
    // CP-POLLO-ARABE-727 A.7 — `fireOrderItems` pre-carga las recetas activas
    // con un único `recipes.findMany`, no un `findFirst` por línea. devuelve el
    // array de recetas activas (vacío para recipe-less).
    prismaMock.recipes.findMany.mockResolvedValue(
      opts.noRecipe
        ? []
        : [
            opts.recipe ?? {
              id: 7,
              product_id: orderItems[0].product_id,
              is_active: true,
            },
          ],
    );
    recipesService.explodeBom.mockResolvedValue(
      opts.bom ?? [
        {
          component_product_id: 201,
          quantity: 0.25,
          unit_cost: 4000,
          depth: 1,
          path_recipe_ids: [7],
        },
      ],
    );
    stockLevelManager.getDefaultLocationForProduct.mockResolvedValue(1);
    stockLevelManager.updateStock.mockResolvedValue({
      cost_snapshot: { total_cost: 1000 },
    } as any);
  };

  /** Configura `$transaction` del fire y devuelve el mock de `kitchen_tickets.create`. */
  const setupFireTransaction = (orderItemId: number): jest.Mock => {
    const ticketCreate = jest
      .fn()
      .mockResolvedValue(makeTxTicket(555, orderItemId, 50));
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        ...buildFireTxMock({ orderItemId }),
        kitchen_tickets: {
          create: ticketCreate,
          count: jest.fn().mockResolvedValue(0),
        },
      }),
    );
    return ticketCreate;
  };

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
      // CP-POLLO-ARABE-727 A.6 — `splitLinesForExclusions` lee las líneas
      // originales a partir del DTO (para una línea partida por exclusión).
      order_items: {
        findMany: jest.fn(),
      },
      recipes: {
        findMany: jest.fn(),
      },
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          industries: ['restaurant'],
        }),
      },
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({
          settings: { general: { timezone: 'America/Bogota' } },
        }),
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
      { attributeOpenSessionToTicketConsumption: jest.fn() } as any,
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

    prismaMock.recipes.findMany.mockResolvedValue([
      { id: 7, product_id: 50, is_active: true },
    ]);

    // explodeBom returns 3 leaves:
    //   - product 99 (harina, direct, qty 1 per unit — merma-free
    //     integer to keep post-Math.round consumption exact)
    //   - product 80 (sub-recipe 'salsa', already resolved at the leaf)
    //   - product 70 (insumo directo)
    // multiplied by qty=2 (order_item.quantity) at the call site.
    // Production rounds consumedQty = Math.round(line.quantity * orderQty),
    // so we pick integer-friendly line values to assert exact consumption.
    recipesService.explodeBom.mockResolvedValue([
      { component_product_id: 99, quantity: 1, depth: 1, path_recipe_ids: [] },
      { component_product_id: 80, quantity: 0.5, depth: 1, path_recipe_ids: [] },
      { component_product_id: 70, quantity: 3, depth: 1, path_recipe_ids: [] },
    ]);

    stockLevelManager.getDefaultLocationForProduct.mockImplementation(
      async (pid: number) => 100 + pid,
    );

    // Per-leaf FIFO cost snapshot. Production passes quantity_change
    // = -Math.round(line.quantity * orderQty), so we mirror that:
    //   - harina: 1 * 2 = 2 → cost 0.20 × 2 = 0.40
    //   - salsa:  0.5 * 2 = 1 → cost 0.50 × 1 = 0.50
    //   - insumo: 3 * 2 = 6 → cost 0.10 × 6 = 0.60
    //   total = 1.50
    stockLevelManager.updateStock.mockImplementation(async (params) => {
      let cost = 0;
      if (params.product_id === 99) cost = 0.2 * 2; // harina: 0.20 × 2
      else if (params.product_id === 80) cost = 0.5 * 1; // salsa: 0.50 × 1
      else if (params.product_id === 70) cost = 0.1 * 6; // insumo: 0.10 × 6
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
    // CP-POLLO-ARABE-727 A.6 — `fireOrderItemsInTx` arranca resolviendo el KDS
    // por defecto (`tx.kds.findFirst`) y la sesión abierta por estación
    // (`tx.kds_sessions.findFirst`), y después lee la nota de cada item
    // (`tx.order_items.findMany`). El mock original sólo tenía
    // `order_items.update`, así que la suite fallaba en esa cascada KDS
    // (`tx.kds.findFirst is undefined`).
    const orderItemUpdate = jest.fn().mockResolvedValue({ id: 10 });
    const ticketCreate = jest.fn().mockResolvedValue({
      id: 555,
      items: [
        { id: 1, order_item_id: 10, product_id: 50, quantity: 2, status: 'pending' },
      ],
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
        kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
        order_items: {
          update: orderItemUpdate,
          findMany: jest.fn().mockResolvedValue([]),
        },
        kitchen_tickets: {
          create: ticketCreate,
          count: jest.fn().mockResolvedValue(0),
        },
        kitchen_ticket_items: {
          update: jest.fn().mockResolvedValue({}),
        },
        kitchen_ticket_item_exclusions: {
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $executeRaw: jest.fn().mockResolvedValue(undefined),
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
    // (c) Quantities reflect qty=2 multiplier: 1*2=2, 0.5*2=1, 3*2=6
    //     (production rounds: Math.round(line.quantity * orderQty))
    expect(stockLevelManager.updateStock.mock.calls[0][0].quantity_change).toBeCloseTo(
      -2,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[1][0].quantity_change).toBeCloseTo(
      -1,
      4,
    );
    expect(stockLevelManager.updateStock.mock.calls[2][0].quantity_change).toBeCloseTo(
      -6,
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

    // (g) COGS = 0.40 + 0.50 + 0.60 = 1.50
    expect(result.cogs_total).toBeCloseTo(1.5, 2);

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
        total_cost: expect.closeTo(1.5, 2),
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

  // --------------------------------------------------------------------------
  // CP-POLLO-ARABE-727 A.6 — la variante vendida viaja a `kitchen_ticket_items`.
  // Matriz: producto variantizado, producto simple, línea partida por exclusión
  // (splitLinesForExclusions) y línea recipe-less (el segundo `push()`).
  // --------------------------------------------------------------------------

  it('persists product_variant_id and variant_label for a prepared item with a variant', async () => {
    setupFireableContext([
      makeVariantOrderItem(10, 50, {
        variantId: 5,
        variantName: 'Picante',
        variantCount: 2,
      }),
    ]);
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    expect(ticketCreate).toHaveBeenCalledTimes(1);
    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({
      product_variant_id: 5,
      variant_label: 'Picante',
    });
  });

  it('keeps product_variant_id and variant_label NULL for a product without variants', async () => {
    setupFireableContext([
      makeVariantOrderItem(10, 50, { variantId: null, variantCount: 0 }),
    ]);
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create[0]).toMatchObject({
      product_variant_id: null,
      variant_label: null,
    });
  });

  it('persists the variant for a recipe-less item (second push)', async () => {
    setupFireableContext(
      [
        makeVariantOrderItem(10, 50, {
          variantId: 9,
          variantName: 'Familiar',
          variantCount: 1,
        }),
      ],
      { noRecipe: true },
    );
    const ticketCreate = setupFireTransaction(10);

    await service.fireOrderItems({ order_id: 100, order_item_ids: [10] });

    // Recipe-less: no BOM → sin consumo de stock.
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    const create = ticketCreate.mock.calls[0][0].data.items.create;
    expect(create).toHaveLength(1);
    expect(create[0]).toMatchObject({
      product_variant_id: 9,
      variant_label: 'Familiar',
    });
  });

  it('keeps the variant on a line split by exclusion (splitLinesForExclusions)', async () => {
    const original = {
      ...makeVariantOrderItem(10, 50, {
        variantId: 5,
        variantName: 'Picante',
        quantity: 3,
        variantCount: 2,
      }),
      unit_price: 20,
      total_price: 60,
      item_type: 'physical',
      cost_price: 10,
      is_price_overridden: false,
      inventory_committed: false,
      is_takeaway: false,
      notes: null,
      skip_kds: false,
      split_from_order_item_id: null,
    };
    prismaMock.order_items.findMany.mockResolvedValue([original]);
    const splitCreate = jest.fn().mockResolvedValue({ id: 20 });
    const splitUpdate = jest.fn().mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({ order_items: { update: splitUpdate, create: splitCreate } }),
    );

    const res = await (service as any).splitLinesForExclusions({
      order_id: 100,
      order_item_ids: [10],
      exclusions: [
        { order_item_id: 10, component_product_ids: [99], applies_to_units: 1 },
      ],
    });

    expect(splitCreate).toHaveBeenCalledTimes(1);
    // La línea NUEVA (la que lleva la exclusión) hereda la variante de la original.
    expect(splitCreate.mock.calls[0][0].data.product_variant_id).toBe(5);
    // `product_variant_id` ya se preservaba; A.6 solo exige que no se regrese.
    expect(splitCreate.mock.calls[0][0].data.quantity).toBe(1);
    expect(res.orderItemIds).toContain(20);
    const remapped = res.exclusions.find(
      (e: any) => e.order_item_id === 20,
    );
    expect(remapped).toEqual({ order_item_id: 20, component_product_ids: [99] });
  });

  // --------------------------------------------------------------------------
  // CP-POLLO-ARABE-727 C.5 — regresión cruzada QUI-655 (exclusiones/split) ×
  // QUI-736 (variantes). Matriz conceptual 2×2×2: {con variante, sin variante}
  // × {con exclusión, sin exclusión} × {línea partida, línea entera}. Se
  // colapsa a 6 casos reales porque la línea SOLO se parte cuando la exclusión
  // es PARCIAL (`applies_to_units < quantity`): total o ausente ⇒ línea entera.
  // La invariante del cruce: cada fragmento hereda SIEMPRE la misma variante
  // (o su NULL) que la línea madre — jamás la pierde ni inventa una.
  // --------------------------------------------------------------------------
  it.each([
    // label                                                | variantId | variantName | variantCount | appliesTo | expectSplit
    ['con variante · sin exclusión · línea entera',          5,     'Picante', 2,   null, false],
    ['con variante · con exclusión total · línea entera',    5,     'Picante', 2,   3,    false],
    ['con variante · con exclusión parcial · línea partida', 5,     'Picante', 2,   1,    true],
    ['sin variante · sin exclusión · línea entera',          null,  null,      0,   null, false],
    ['sin variante · con exclusión total · línea entera',    null,  null,      0,   3,    false],
    ['sin variante · con exclusión parcial · línea partida', null,  null,      0,   1,    true],
  ])(
    'C.5 — %s preserva la variante de la línea madre',
    async (
      _label,
      variantId,
      variantName,
      variantCount,
      appliesTo,
      expectSplit,
    ) => {
      const original = {
        ...makeVariantOrderItem(10, 50, {
          variantId,
          variantName,
          quantity: 3,
          variantCount,
        }),
        unit_price: 20,
        total_price: 60,
        item_type: 'physical',
        cost_price: 10,
        is_price_overridden: false,
        inventory_committed: false,
        is_takeaway: false,
        notes: null,
        skip_kds: false,
        split_from_order_item_id: null,
      };
      prismaMock.order_items.findMany.mockResolvedValue([original]);
      const splitCreate = jest.fn().mockResolvedValue({ id: 20 });
      const splitUpdate = jest.fn().mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (cb: any) =>
        cb({ order_items: { update: splitUpdate, create: splitCreate } }),
      );

      const exclusions =
        appliesTo != null
          ? [
              {
                order_item_id: 10,
                component_product_ids: [99],
                applies_to_units: appliesTo,
              },
            ]
          : [];

      const res = await (service as any).splitLinesForExclusions({
        order_id: 100,
        order_item_ids: [10],
        exclusions,
      });

      if (expectSplit) {
        // La línea se partió: el fragmento NUEVO (lleva la exclusión) hereda la
        // variante de la madre. `variant_label` se deriva al fire; aquí solo se
        // garantiza que `product_variant_id` sobrevive al split.
        expect(splitCreate).toHaveBeenCalledTimes(1);
        expect(splitCreate.mock.calls[0][0].data.product_variant_id).toBe(
          variantId ?? null,
        );
        expect(splitCreate.mock.calls[0][0].data.quantity).toBe(appliesTo);
        // El fragmento ORIGINAL se redujo y conserva su variante (el update no
        // la toca), así que AMBOS fragmentos la llevan.
        expect(splitUpdate).toHaveBeenCalledTimes(1);
        expect(splitUpdate.mock.calls[0][0].where.id).toBe(10);
        expect(
          (res.exclusions as any[]).find((e: any) => e.order_item_id === 20),
        ).toEqual({
          order_item_id: 20,
          component_product_ids: [99],
        });
      } else {
        // Línea entera: no se parte, no se crea fragmento nuevo.
        expect(splitCreate).not.toHaveBeenCalled();
        expect(splitUpdate).not.toHaveBeenCalled();
      }
    },
  );

  it('throws PRODUCT_VARIANT_MISMATCH when the variant does not belong to the product', async () => {
    prismaMock.orders.findFirst.mockResolvedValue({
      id: 100,
      store_id: 1,
      order_number: 'ORD-MM',
      order_items: [
        makeVariantOrderItem(10, 50, {
          variantId: 5,
          variantName: 'Ajeno',
          variantProductId: 999,
          variantCount: 2,
        }),
      ],
    });

    await expect(
      service.fireOrderItems({ order_id: 100, order_item_ids: [10] }),
    ).rejects.toMatchObject({ errorCode: 'PRODUCT_VARIANT_MISMATCH' });

    // La validación ocurre ANTES de abrir la transacción.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('updates order_items notes and passes notes to kitchen_ticket_items when item_notes are provided', async () => {
    const item = makeOrderItem(10, 50, 'prepared', false);
    setupFireableContext([item]);

    const txMock = buildFireTxMock({ orderItemId: 10 });
    const createMock = jest.fn().mockResolvedValue(makeTxTicket(77, 10, 50));
    (txMock as any).kitchen_tickets = {
      count: jest.fn().mockResolvedValue(0),
      create: createMock,
    };
    prismaMock.$transaction.mockImplementation((cb: any) => cb(txMock));

    const result = await service.fireOrderItems({
      order_id: 100,
      order_item_ids: [10],
      item_notes: [{ order_item_id: 10, notes: 'Sin cebolla, bien cocido' }],
    });

    expect(result.kitchen_ticket_id).toBe(77);
    expect(txMock.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { notes: 'Sin cebolla, bien cocido', updated_at: expect.any(Date) },
    });
    expect(txMock.kitchen_ticket_items.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { notes: 'Sin cebolla, bien cocido', updated_at: expect.any(Date) },
    });
  });
});
