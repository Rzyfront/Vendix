import { RequestContextService } from '@common/context/request-context.service';
import {
  expandProduction,
  ProductionLineInput,
  ScheduledOrderProductionService,
} from './scheduled-order-production.service';

// Receta de la torta mediana (id 1): por unidad 300 g harina (#501) y 2 huevos (#502).
// Receta de la ganache (id 2): por g de ganache 0.6 g chocolate (#601) y 0.4 g crema (#602).
const RECIPES: Record<number, Array<{ component_product_id: number; quantity: number }>> = {
  1: [
    { component_product_id: 501, quantity: 300 },
    { component_product_id: 502, quantity: 2 },
  ],
  2: [
    { component_product_id: 601, quantity: 0.6 },
    { component_product_id: 602, quantity: 0.4 },
  ],
};
const RECIPE_BY_PRODUCT: Record<number, number> = { 10: 1, 20: 2 };

const findRecipe = jest.fn(async (product_id: number) => RECIPE_BY_PRODUCT[product_id] ?? null);
const explode = jest.fn(async (recipe_id: number, units: number) =>
  RECIPES[recipe_id].map((l) => ({ component_product_id: l.component_product_id, quantity: l.quantity * units })),
);

function torta(overrides: Partial<ProductionLineInput> = {}): ProductionLineInput {
  return {
    id: 1,
    product_id: 10,
    product_variant_id: null,
    quantity: 2,
    product_type: 'prepared',
    inventory_consumed: false,
    options: [
      // Fresas 80 g por unidad (insumo directo).
      { scope: 'per_unit', component_type: 'ingredient', component_product_id: 700, component_variant_id: null, quantity: 80 },
      // Ganache 150 g por unidad (mini-receta).
      { scope: 'per_unit', component_type: 'recipe', component_product_id: 20, component_variant_id: null, quantity: 150 },
      // Vela: una por línea (producto vendible).
      { scope: 'per_line', component_type: 'product', component_product_id: 800, component_variant_id: null, quantity: 1 },
    ],
    ...overrides,
  };
}

function qty(consumption: Array<{ product_id: number; quantity: number }>, product_id: number) {
  return consumption.find((c) => c.product_id === product_id)?.quantity;
}

describe('expandProduction', () => {
  it('consolida receta base + adiciones (por unidad × cantidad, por línea × 1)', async () => {
    const { consumption, consumed_line_ids } = await expandProduction([torta()], findRecipe, explode);
    expect(qty(consumption, 501)).toBe(600); // harina 300 × 2
    expect(qty(consumption, 502)).toBe(4);
    expect(qty(consumption, 700)).toBe(160); // fresas 80 × 2
    expect(qty(consumption, 601)).toBe(180); // ganache 150 × 2 × 0.6
    expect(qty(consumption, 602)).toBe(120);
    expect(qty(consumption, 800)).toBe(1); // vela por línea
    expect(consumed_line_ids).toEqual([1]);
  });

  it('suma el mismo insumo de varias líneas en un solo consumo', async () => {
    const { consumption } = await expandProduction(
      [torta({ options: [] }), torta({ id: 2, quantity: 1, options: [] })],
      findRecipe,
      explode,
    );
    expect(consumption.filter((c) => c.product_id === 501)).toEqual([
      { product_id: 501, variant_id: null, quantity: 900 },
    ]);
  });

  it('no repite la receta de una línea ya consumida; sus adiciones sí cuentan', async () => {
    const { consumption, consumed_line_ids } = await expandProduction(
      [torta({ inventory_consumed: true })],
      findRecipe,
      explode,
    );
    expect(qty(consumption, 501)).toBeUndefined();
    expect(qty(consumption, 700)).toBe(160);
    expect(consumed_line_ids).toEqual([]);
  });

  it('línea sin receta (vela suelta) no se marca: se descuenta al entregar', async () => {
    const { consumption, consumed_line_ids } = await expandProduction(
      [torta({ id: 5, product_id: 800, product_type: 'physical', quantity: 1, options: [] })],
      findRecipe,
      explode,
    );
    expect(consumption).toEqual([]);
    expect(consumed_line_ids).toEqual([]);
  });
});

describe('ScheduledOrderProductionService.start', () => {
  function build(lines: unknown[]) {
    const tx = {
      order_items: {
        findMany: jest.fn().mockResolvedValue(lines),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      recipes: {
        findMany: jest.fn(async ({ where }: { where: { product_id: number } }) =>
          RECIPE_BY_PRODUCT[where.product_id] ? [{ id: RECIPE_BY_PRODUCT[where.product_id], product_variant_id: null }] : [],
        ),
      },
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(9),
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { total_cost: 100 } }),
      releaseReservationQuantity: jest.fn().mockResolvedValue(0),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new ScheduledOrderProductionService(
      {} as any,
      { registerProductionStartHook: jest.fn() } as any,
      { explodeBom: jest.fn(async (id: number, mult: Record<number, number>) => explode(id, mult[id])) } as any,
      stockLevelManager as any,
      { resolveInventoryPolicy: jest.fn().mockResolvedValue({ allowIngredientOveruse: true }) } as any,
      eventEmitter as any,
      {} as any,
    );
    return { service, tx, stockLevelManager, eventEmitter };
  }

  const row = {
    id: 1,
    product_id: 10,
    product_variant_id: null,
    quantity: 2,
    inventory_consumed_at_fire: false,
    inventory_committed: false,
    products: { product_type: 'prepared' },
    order_item_options: [
      { scope: 'per_unit', component_type: 'ingredient', component_product_id: 700, component_variant_id: null, quantity: '80' },
    ],
  };

  it('consume con movimientos `consumption`, marca la línea y emite el costo tras el commit', async () => {
    const { service, tx, stockLevelManager, eventEmitter } = build([row]);
    const after = await service.start(tx as any, { id: 7, store_id: 3, order_id: 40 });

    const calls = stockLevelManager.updateStock.mock.calls.map(([p]) => [p.product_id, p.quantity_change, p.movement_type]);
    expect(calls).toEqual([
      [501, -600, 'consumption'],
      [502, -4, 'consumption'],
      [700, -160, 'consumption'],
    ]);
    expect(stockLevelManager.releaseReservationQuantity).toHaveBeenCalledWith(
      'order', 40, 10, null, 2, 'cancelled', tx, { decrementOnHand: false },
    );
    expect(tx.order_items.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] }, inventory_consumed_at_fire: false },
      data: { inventory_consumed_at_fire: true },
    });
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    (after as () => void)();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'scheduled_order.produced',
      expect.objectContaining({ schedule_id: 7, order_id: 40, total_cost: 300, consumed_line_count: 3 }),
    );
  });

  it('QUI-989: si al cobrar no se disparó nada, iniciar descuenta la receta base una sola vez, más las adiciones', async () => {
    const { service, tx, stockLevelManager } = build([row]);
    await service.start(tx as any, { id: 7, store_id: 3, order_id: 40 });
    const harina = stockLevelManager.updateStock.mock.calls.filter(([p]) => p.product_id === 501);
    expect(harina).toHaveLength(1);
    expect(harina[0][0].quantity_change).toBe(-600);
    expect(stockLevelManager.updateStock.mock.calls.some(([p]) => p.product_id === 700)).toBe(true);
  });

  it('segundo inicio sobre líneas ya consumidas y sin adiciones no mueve stock', async () => {
    const { service, tx, stockLevelManager } = build([
      { ...row, inventory_consumed_at_fire: true, order_item_options: [] },
    ]);
    await service.start(tx as any, { id: 7, store_id: 3, order_id: 40 });
    expect(stockLevelManager.updateStock).not.toHaveBeenCalled();
    expect(tx.order_items.updateMany).not.toHaveBeenCalled();
  });
});


describe('ScheduledOrderProductionService.sendToKitchen (QUI-989)', () => {
  function build(opts: { status?: string; items?: Array<{ id: number }> } = {}) {
    const schedule = { id: 7, store_id: 3, order_id: 40, status: opts.status ?? 'scheduled' };
    const client = {
      order_items: { findMany: jest.fn().mockResolvedValue(opts.items ?? [{ id: 11 }, { id: 12 }]) },
    };
    const prisma = {
      order_fulfillment_schedules: {
        findFirst: jest.fn().mockResolvedValue(schedule),
      },
      withoutScope: jest.fn().mockReturnValue(client),
    };
    const scheduledOrders = {
      registerProductionStartHook: jest.fn(),
      transition: jest.fn().mockResolvedValue({ ...schedule, status: 'in_production' }),
    };
    const kitchenFire = { fireOrderItems: jest.fn().mockResolvedValue({ ticketId: 1 }) };
    const service = new ScheduledOrderProductionService(
      prisma as any,
      scheduledOrders as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      kitchenFire as any,
    );
    return { service, client, scheduledOrders, kitchenFire };
  }

  let ctx: jest.SpyInstance;
  beforeEach(() => {
    ctx = jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
  });
  afterEach(() => ctx.mockRestore());

  it('dispara a cocina solo los platos preparados que no son de lote ni están ya enviados, y pasa el pedido a producción', async () => {
    const { service, client, scheduledOrders, kitchenFire } = build();
    await service.sendToKitchen(7);

    expect(client.order_items.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          order_id: 40,
          cancelled_at: null,
          skip_kds: false,
          inventory_consumed_at_fire: false,
          products: { product_type: 'prepared', is_batch_produced: false },
        }),
      }),
    );
    expect(kitchenFire.fireOrderItems).toHaveBeenCalledWith({ order_id: 40, order_item_ids: [11, 12] });
    expect(scheduledOrders.transition).toHaveBeenCalledWith(7, 'in_production', expect.any(String));
  });

  it('no repite el estado si el pedido ya está en producción', async () => {
    const { service, scheduledOrders, kitchenFire } = build({ status: 'in_production' });
    await service.sendToKitchen(7);
    expect(kitchenFire.fireOrderItems).toHaveBeenCalledTimes(1);
    expect(scheduledOrders.transition).not.toHaveBeenCalled();
  });

  it('es idempotente: sin platos pendientes no dispara y rechaza con SCHED_NOTHING_TO_SEND', async () => {
    const { service, kitchenFire } = build({ items: [] });
    await expect(service.sendToKitchen(7)).rejects.toMatchObject({
      errorCode: 'SCHED_NOTHING_TO_SEND',
    });
    expect(kitchenFire.fireOrderItems).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'delivered'])('rechaza un pedido %s con SCHED_KITCHEN_NOT_ALLOWED', async (status) => {
    const { service, kitchenFire } = build({ status });
    await expect(service.sendToKitchen(7)).rejects.toMatchObject({
      errorCode: 'SCHED_KITCHEN_NOT_ALLOWED',
    });
    expect(kitchenFire.fireOrderItems).not.toHaveBeenCalled();
  });
});
