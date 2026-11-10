import { KitchenFireService } from './kitchen-fire.service';

jest.mock('../orders/order-flow/order-flow.service', () => ({
  OrderFlowService: class OrderFlowService {},
}));

/**
 * QUI-1000 — the kitchen fire also consumes the add-ons of the fired dishes,
 * once, with the same helpers the scheduled-order production uses.
 */
describe('KitchenFireService — add-ons (QUI-1000)', () => {
  const DISH = 50;
  const BIZCOCHO = 900;

  function addon(overrides: Record<string, unknown> = {}) {
    return {
      scope: 'per_unit',
      component_type: 'ingredient',
      component_product_id: 700,
      component_variant_id: null,
      quantity: '80',
      ...overrides,
    };
  }

  function build(opts: { schedule?: { produced_at: Date | null } | null; available?: number; shortage?: boolean } = {}) {
    const recipesService = {
      explodeBom: jest.fn(async (id: number, mult: Record<number, number>) =>
        id === 90
          ? [{ component_product_id: 901, quantity: 200 * mult[90], depth: 1, path_recipe_ids: [90] }]
          : [{ component_product_id: 201, quantity: 100 * mult[id], depth: 1, path_recipe_ids: [id] }],
      ),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn(async (pid: number) => 1000 + pid),
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { total_cost: 10 } }),
    };
    const stockValidator = {
      resolveInventoryPolicy: jest.fn().mockResolvedValue({ allowIngredientOveruse: false }),
      assertIngredientsAvailable: opts.shortage
        ? jest.fn(async (demand: Array<{ product_id: number }>) => {
            // Only the add-on component (#700) is short.
            if (demand.some((l) => l.product_id === 700)) {
              throw Object.assign(new Error('short'), { errorCode: 'INV_STOCK_INSUFFICIENT_LINES' });
            }
            return [];
          })
        : jest.fn().mockResolvedValue([]),
      findInsufficientLines: jest.fn(async () =>
        opts.available === undefined ? [] : [{ product_id: BIZCOCHO, available: opts.available }],
      ),
    };
    const tx = {
      orders: { findFirst: jest.fn().mockResolvedValue({ id: 100, state: 'processing' }) },
      kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        updateMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ count: Array.isArray(where?.id?.in) ? where.id.in.length : 1 }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order_fulfillment_schedules: {
        findFirst: jest.fn().mockResolvedValue(opts.schedule ?? null),
      },
      recipes: {
        findMany: jest.fn(async ({ where }: any) =>
          where.product_id === BIZCOCHO ? [{ id: 90, product_variant_id: null }] : [],
        ),
      },
      products: { findFirst: jest.fn().mockResolvedValue({ is_batch_produced: true }) },
      kitchen_tickets: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 55, items: [{ id: 1, order_item_id: 10 }] }),
      },
      kitchen_ticket_items: { update: jest.fn().mockResolvedValue({}) },
      kitchen_ticket_item_exclusions: { createMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KitchenFireService(
      {} as any,
      recipesService as any,
      stockLevelManager as any,
      stockValidator as any,
      { emit: jest.fn() } as any,
      { pushToStore: jest.fn() } as any,
      {} as any,
    );
    return { service, tx, recipesService, stockLevelManager, stockValidator };
  }

  function context(options: unknown[] | undefined) {
    const orderItem = {
      id: 10,
      product_id: DISH,
      product_name: 'Torta',
      quantity: 2,
      product_variant_id: null,
      ...(options ? { order_item_options: options } : {}),
    };
    return {
      order: { id: 100, order_number: 'ORD-1' },
      firedItemIds: [10],
      skippedItemIds: [],
      preparedItems: [
        {
          orderItem,
          recipeId: 7,
          bomLines: [{ component_product_id: 201, quantity: 100, depth: 1, path_recipe_ids: [7] }],
        },
      ],
      recipeLessItems: [],
      locationByProduct: new Map<number, number>([[201, 1201]]),
      businessDate: '2026-11-09',
      user_id: 9,
    } as any;
  }

  const moves = (m: { updateStock: jest.Mock }) =>
    m.updateStock.mock.calls.map(([p]) => [p.product_id, p.quantity_change, p.order_item_id]);

  it('un plato sin adiciones descuenta exactamente como hoy y no consulta adiciones ni agenda', async () => {
    const { service, tx, stockLevelManager, stockValidator } = build();
    await service.fireOrderItemsInTx(tx as any, 1, context(undefined));
    expect(moves(stockLevelManager)).toEqual([[201, -200, 10]]);
    expect(tx.order_fulfillment_schedules.findFirst).not.toHaveBeenCalled();
    expect(tx.recipes.findMany).not.toHaveBeenCalled();
    // The only guard run is the in-tx one for the dish, with the dish demand alone.
    expect(stockValidator.assertIngredientsAvailable).toHaveBeenCalledTimes(1);
    expect(stockValidator.assertIngredientsAvailable.mock.calls[0][0]).toEqual([
      { product_id: 201, quantity: 200, used_by: 'Torta' },
    ]);
  });

  it('al mandar a cocina descuenta también el componente de cada adición (por unidad × cantidad)', async () => {
    const { service, tx, stockLevelManager } = build();
    await service.fireOrderItemsInTx(
      tx as any,
      1,
      context([addon(), addon({ scope: 'per_line', component_type: 'product', component_product_id: 800, quantity: '1' })]),
    );
    expect(moves(stockLevelManager)).toEqual([
      [201, -200, 10],
      [700, -160, 10],
      [800, -1, 10],
    ]);
    expect(tx.order_items.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { inventory_consumed_at_fire: true } }),
    );
  });

  it('una adición que es una receta se explota por su receta', async () => {
    const { service, tx, stockLevelManager } = build();
    // Ganache (product 20) has recipe 2; its product is not batch-produced.
    tx.products.findFirst.mockResolvedValue({ is_batch_produced: false });
    tx.recipes.findMany.mockImplementation(async ({ where }: any) =>
      where.product_id === 20 ? [{ id: 2, product_variant_id: null }] : [],
    );
    await service.fireOrderItemsInTx(
      tx as any,
      1,
      context([addon({ component_type: 'recipe', component_product_id: 20, quantity: '1' })]),
    );
    // 1 per unit x 2 units -> explode(recipe 2, 2) -> leaf 201 x 100 x 2
    expect(moves(stockLevelManager)).toEqual([
      [201, -200, 10],
      [201, -200, 10],
    ]);
  });

  it('QUI-990: una adición de lote usa su stock primero y solo explota el faltante', async () => {
    const { service, tx, stockLevelManager } = build({ available: 1 });
    await service.fireOrderItemsInTx(
      tx as any,
      1,
      context([addon({ component_type: 'recipe', component_product_id: BIZCOCHO, quantity: '1' })]),
    );
    // 2 needed, 1 on the shelf: 1 from stock + 1 produced (200 g flour).
    expect(moves(stockLevelManager)).toEqual([
      [201, -200, 10],
      [BIZCOCHO, -1, 10],
      [901, -200, 10],
    ]);
  });

  it('sin sobreventa: el faltante de una adición bloquea antes de mover stock y la guarda suma plato + adición', async () => {
    const { service, tx, stockLevelManager, stockValidator } = build({ shortage: true });
    await expect(service.fireOrderItemsInTx(tx as any, 1, context([addon()]))).rejects.toMatchObject({
      errorCode: 'INV_STOCK_INSUFFICIENT_LINES',
    });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    const demand = stockValidator.assertIngredientsAvailable.mock.calls.at(-1)![0];
    expect(demand).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product_id: 201, quantity: 200, used_by: 'Torta' }),
        expect.objectContaining({ product_id: 700, quantity: 160, used_by: 'Torta' }),
      ]),
    );
  });

  it('una sola vez: si la producción del pedido programado ya arrancó, el disparo no repite las adiciones', async () => {
    const { service, tx, stockLevelManager } = build({ schedule: { produced_at: new Date() } });
    await service.fireOrderItemsInTx(tx as any, 1, context([addon()]));
    expect(moves(stockLevelManager)).toEqual([[201, -200, 10]]);
  });

  describe('payload del ticket', () => {
    it('lista las adiciones con cantidad, imagen firmada (o null), nota y receta de la preparación', async () => {
      const { service } = build();
      const prisma = {
        products: {
          findMany: jest.fn().mockResolvedValue([
            { id: 700, product_images: [{ image_url: 'k/fresa.webp' }] },
            { id: BIZCOCHO, product_images: [] },
          ]),
        },
        recipes: { findMany: jest.fn().mockResolvedValue([{ id: 90, product_id: BIZCOCHO, product_variant_id: null }]) },
      };
      (service as any).prisma = prisma;
      (service as any).s3Service = { signUrl: jest.fn(async (k: string) => `signed:${k}`) };
      const ticket = {
        id: 55,
        items: [
          {
            id: 1,
            quantity: 2,
            order_item: {
              is_takeaway: false,
              order_item_options: [
                { id: 5, group_name: 'Extras', option_name: 'Fresas', scope: 'per_unit', component_type: 'ingredient', component_product_id: 700, component_variant_id: null, quantity: '80', uom: 'g', note: 'sin semillas' },
                { id: 6, group_name: 'Base', option_name: 'Bizcocho', scope: 'per_line', component_type: 'recipe', component_product_id: BIZCOCHO, component_variant_id: null, quantity: '1', uom: null, note: null },
              ],
            },
          },
          { id: 2, quantity: 1, order_item: { is_takeaway: true, order_item_options: [] } },
        ],
      };
      await (service as any).signTicketPayload(ticket);
      expect(ticket.items[0].addons).toEqual([
        expect.objectContaining({ name: 'Fresas', quantity: 160, image_url: 'signed:k/fresa.webp', note: 'sin semillas', recipe_id: null }),
        expect.objectContaining({ name: 'Bizcocho', quantity: 1, image_url: null, note: null, recipe_id: 90 }),
      ]);
      expect(ticket.items[0].order_item).toEqual({ is_takeaway: false });
      // A dish without add-ons keeps its payload and gets an empty list.
      expect(ticket.items[1].addons).toEqual([]);
      expect(ticket.items[1].order_item).toEqual({ is_takeaway: true });
    });
  });
});
