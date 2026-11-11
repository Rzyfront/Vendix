import { Prisma } from '@prisma/client';
import { ProductionOrdersService } from './production-orders.service';
import { RequestContextService } from '../../../common/context/request-context.service';

/**
 * Planned vs consumed supplies per production order (`production_order_lines`):
 * planned lines at creation, generic persistence in `complete()`, the detail
 * `lines` and the supplies of the whole day.
 */

/** Stateful stand-in for `tx.production_order_lines`. */
const makeLinesMock = (initial: Array<Record<string, unknown>> = []) => {
  const rows: any[] = initial.map((r, i) => ({
    id: i + 1,
    consumed_qty: new Prisma.Decimal(0),
    unit_cost: null,
    total_cost: null,
    cost_snapshot: null,
    ...r,
  }));
  let nextId = 100;
  return {
    rows,
    findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    findFirst: jest.fn(async () => null),
    count: jest.fn(async () => rows.filter((r) => Number(r.consumed_qty) > 0).length),
    create: jest.fn(async ({ data }: any) => {
      rows.push({ id: nextId++, ...data });
      return data;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        rows.push({
          id: nextId++,
          consumed_qty: new Prisma.Decimal(0),
          unit_cost: null,
          total_cost: null,
          cost_snapshot: null,
          ...d,
        });
      }
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    deleteMany: jest.fn(async () => {
      const count = rows.length;
      rows.length = 0;
      return { count };
    }),
  };
};

const ctx = { store_id: 1, organization_id: 1, user_id: 42, is_super_admin: false };

describe('ProductionOrdersService — planned lines at creation (S1)', () => {
  let prisma: any;
  let service: ProductionOrdersService;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
    prisma = {
      products: {
        findFirst: jest.fn().mockResolvedValue({
          id: 50,
          name: 'Salsa',
          product_type: 'physical',
          is_batch_produced: true,
          store_id: 1,
        }),
      },
      recipes: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          product_id: 50,
          is_active: true,
          yield_quantity: new Prisma.Decimal(10),
          yield_unit: 'u',
          waste_percent: new Prisma.Decimal(10),
          items: [
            {
              component_product_id: 99,
              quantity: new Prisma.Decimal(5),
              waste_percent: new Prisma.Decimal(0),
              waste_mode: 'percent',
              waste_absolute: null,
            },
            {
              component_product_id: 98,
              quantity: new Prisma.Decimal(2),
              waste_percent: new Prisma.Decimal(0),
              waste_mode: 'percent',
              waste_absolute: null,
            },
          ],
        }),
      },
      production_orders: {
        create: jest.fn().mockResolvedValue({ id: 100, store_id: 1 }),
      },
    };
    service = new ProductionOrdersService(prisma, {} as any, {} as any, { emit: jest.fn() } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('S1: a manual order is created with one planned line per recipe item (computeComponentRequirements) and consumed 0', async () => {
    await service.create({ product_id: 50, recipe_id: 7, planned_qty: 20 } as any);

    const data = prisma.production_orders.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ store_id: 1, product_id: 50, recipe_id: 7, status: 'draft' });
    expect(Number(data.planned_qty)).toBe(20);
    // round(5 * 2 * 1.1) = 11 and round(2 * 2 * 1.1) = 4
    expect(data.lines.create).toEqual([
      { component_product_id: 99, planned_qty: new Prisma.Decimal(11), sort_order: 0 },
      { component_product_id: 98, planned_qty: new Prisma.Decimal(4), sort_order: 1 },
    ]);
    // consumed_qty is not written: the column default (0) applies.
    expect(data.lines.create[0]).not.toHaveProperty('consumed_qty');
  });
});

describe('ProductionOrdersService.getDetail — lines (S3 backend)', () => {
  let prisma: any;
  let service: ProductionOrdersService;

  const order = {
    id: 100,
    store_id: 1,
    product_id: 50,
    recipe_id: 7,
    order_id: null,
    status: 'in_progress',
    planned_qty: new Prisma.Decimal(10),
    product: { id: 50, name: 'Salsa', sku: 'S', stock_unit: 'u', is_batch_produced: true },
    product_variant: null,
    recipe: { id: 7, items: [] },
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
    prisma = {
      production_orders: { findFirst: jest.fn().mockResolvedValue(order) },
      production_order_lines: { findMany: jest.fn().mockResolvedValue([]) },
      recipes: { findMany: jest.fn().mockResolvedValue([]) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ProductionOrdersService(prisma, {} as any, {} as any, { emit: jest.fn() } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('includes the order lines with the component product, ordered by sort_order', async () => {
    const lines = [
      {
        id: 1,
        component_product_id: 99,
        planned_qty: new Prisma.Decimal(11),
        consumed_qty: new Prisma.Decimal(11),
        unit_cost: new Prisma.Decimal(2),
        total_cost: new Prisma.Decimal(22),
        component_product: { id: 99, name: 'Harina', sku: 'H', stock_unit: 'g' },
      },
    ];
    prisma.production_order_lines.findMany.mockResolvedValue(lines);

    const detail: any = await service.getDetail(100);

    expect(prisma.production_order_lines.findMany).toHaveBeenCalledWith({
      where: { order_id: 100 },
      orderBy: { sort_order: 'asc' },
      include: {
        component_product: { select: { id: true, name: true, sku: true, stock_unit: true } },
      },
    });
    expect(detail.lines).toEqual(lines);
  });

  it('an order without lines returns lines: []', async () => {
    const detail: any = await service.getDetail(100);
    expect(detail.lines).toEqual([]);
  });
});

describe('ProductionOrdersService.complete — generic consumption lines (S2)', () => {
  let prisma: any;
  let tx: any;
  let lines: ReturnType<typeof makeLinesMock>;
  let stock: { updateStock: jest.Mock; getDefaultLocationForProduct: jest.Mock };
  let service: ProductionOrdersService;
  let order: any;

  const recipe = (items: any[]) => ({
    id: 7,
    yield_quantity: new Prisma.Decimal(10),
    yield_unit: 'u',
    waste_percent: new Prisma.Decimal(0),
    items: items.map((i) => ({
      waste_percent: new Prisma.Decimal(0),
      component_product: { id: i.component_product_id, name: `C${i.component_product_id}` },
      ...i,
    })),
  });

  const build = (over: Record<string, unknown> = {}, items?: any[]) => {
    order = {
      id: 5,
      store_id: 1,
      product_id: 50,
      status: 'in_progress',
      planned_qty: new Prisma.Decimal(10),
      produced_qty: null,
      product: { id: 50, name: 'Mesa', sku: 'M', stock_unit: 'u', is_batch_produced: true },
      recipe: recipe(
        items ?? [{ component_product_id: 99, quantity: new Prisma.Decimal(10) }],
      ),
      ...over,
    };
    prisma.production_orders.findFirst.mockResolvedValue(order);
  };

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
    stock = {
      updateStock: jest.fn().mockResolvedValue({
        cost_snapshot: { unit_cost: 2, total_cost: 8, stock_value: 0 },
      }),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(1),
    };
    lines = makeLinesMock();
    tx = {
      production_orders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 5, ...data })),
      },
      production_order_lines: lines,
    };
    prisma = {
      production_orders: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    service = new ProductionOrdersService(
      prisma,
      stock as any,
      {
        assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
        resolveInventoryPolicy: jest
          .fn()
          .mockResolvedValue({ allowOversell: false, allowIngredientOveruse: true }),
      } as any,
      { emit: jest.fn() } as any,
    );
    build();
  });

  afterEach(() => jest.restoreAllMocks());

  it('S2: a restaurant completion accumulates consumed_qty and cost on the planned line, from the updateStock cost snapshot', async () => {
    lines.rows.push({
      id: 1,
      order_id: 5,
      component_product_id: 99,
      planned_qty: new Prisma.Decimal(10),
      consumed_qty: new Prisma.Decimal(0),
      unit_cost: null,
      total_cost: null,
      cost_snapshot: null,
    });

    await service.complete(5, { produced_qty: 10 });

    expect(lines.update).toHaveBeenCalledTimes(1);
    const arg = lines.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 1 });
    expect(Number(arg.data.consumed_qty)).toBe(10);
    expect(Number(arg.data.total_cost)).toBe(8);
    expect(Number(arg.data.unit_cost)).toBe(0.8);
    expect(arg.data.cost_snapshot.entries).toEqual([
      expect.objectContaining({ quantity: 10, unit_cost: 2, total_cost: 8 }),
    ]);
    // Stock calls are the same as before: one consumption + one production credit.
    expect(stock.updateStock).toHaveBeenCalledTimes(2);
    expect(lines.createMany).not.toHaveBeenCalled();
    expect(lines.create).not.toHaveBeenCalled();
  });

  it('S2: an order with no lines (created before the deploy) first gets its planned lines from the recipe, then accumulates', async () => {
    await service.complete(5, { produced_qty: 10 });

    expect(lines.createMany).toHaveBeenCalledTimes(1);
    expect(lines.createMany.mock.calls[0][0].data).toEqual([
      {
        order_id: 5,
        component_product_id: 99,
        planned_qty: new Prisma.Decimal(10),
        sort_order: 0,
      },
    ]);
    expect(lines.create).not.toHaveBeenCalled();
    expect(lines.update).toHaveBeenCalledTimes(1);
    expect(Number(lines.update.mock.calls[0][0].data.consumed_qty)).toBe(10);
    expect(Number(lines.rows[0].planned_qty)).toBe(10);
  });

  it('S2: a consumed component with no planned line keeps the current behavior (line created with planned = consumed)', async () => {
    lines.rows.push({
      id: 1,
      order_id: 5,
      component_product_id: 777,
      planned_qty: new Prisma.Decimal(1),
      consumed_qty: new Prisma.Decimal(0),
      unit_cost: null,
      total_cost: null,
      cost_snapshot: null,
    });

    await service.complete(5, { produced_qty: 10 });

    expect(lines.create).toHaveBeenCalledTimes(1);
    const data = lines.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ order_id: 5, component_product_id: 99 });
    expect(Number(data.planned_qty)).toBe(10);
    expect(Number(data.consumed_qty)).toBe(10);
    expect(Number(data.total_cost)).toBe(8);
    expect(Number(data.unit_cost)).toBe(0.8);
  });

  it('S2/S7: two partial deliveries (Planta hook, no persistence of its own) accumulate consumed and cost exactly once each', async () => {
    build({}, [{ component_product_id: 99, quantity: new Prisma.Decimal(10) }]);
    lines.rows.push({
      id: 1,
      order_id: 5,
      component_product_id: 99,
      planned_qty: new Prisma.Decimal(10),
      consumed_qty: new Prisma.Decimal(0),
      unit_cost: null,
      total_cost: null,
      cost_snapshot: null,
    });
    const onProduced = jest.fn().mockResolvedValue({ status: 'partially_completed' });
    const options = { allowPartialBatch: true, sourceModule: 'manufacturing', onProduced };

    await service.complete(5, { produced_qty: 4 }, options);
    expect(Number(lines.rows[0].consumed_qty)).toBe(4);
    expect(Number(lines.rows[0].total_cost)).toBe(8);

    order.status = 'partially_completed';
    order.produced_qty = new Prisma.Decimal(4);
    await service.complete(5, { produced_qty: 6 }, options);

    // 4 + 6 consumed, 8 + 8 cost, one entry per delivery, no double count.
    expect(Number(lines.rows[0].consumed_qty)).toBe(10);
    expect(Number(lines.rows[0].total_cost)).toBe(16);
    expect(Number(lines.rows[0].unit_cost)).toBe(1.6);
    expect(lines.rows[0].cost_snapshot.entries).toHaveLength(2);
    expect(lines.update).toHaveBeenCalledTimes(2);
    // the hook still receives the consumptions of the delivery (event payload unchanged)
    expect(onProduced).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        consumptions: [expect.objectContaining({ component_product_id: 99, consumed_qty: 6 })],
      }),
    );
  });
});

describe('ProductionOrdersService.findDaySupplies (S4)', () => {
  let prisma: any;
  let service: ProductionOrdersService;

  const comp = (id: number, name: string) => ({
    id,
    name,
    sku: `SKU-${id}`,
    stock_unit: 'g',
  });
  const line = (id: number, name: string, planned: number, consumed: number) => ({
    component_product_id: id,
    planned_qty: new Prisma.Decimal(planned),
    consumed_qty: new Prisma.Decimal(consumed),
    component_product: comp(id, name),
  });

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any);
    prisma = {
      production_orders: {
        findMany: jest.fn().mockResolvedValue([
          // completed, A consumed above plan
          {
            id: 1,
            status: 'completed',
            lines: [line(1, 'Harina', 10, 12), line(2, 'Azúcar', 5, 5)],
          },
          // in progress, B partially consumed
          {
            id: 2,
            status: 'partially_completed',
            lines: [line(1, 'Harina', 4, 0), line(2, 'Azúcar', 6, 2)],
          },
          // completed before the deploy: no lines
          { id: 3, status: 'completed', lines: [] },
          // waiting
          { id: 4, status: 'draft', lines: [line(1, 'Harina', 3, 0)] },
        ]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } }),
      },
    };
    service = new ProductionOrdersService(prisma, {} as any, {} as any, { emit: jest.fn() } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('aggregates planned, consumed, pending and difference per supply, sorted by name, with the L3 shape and no cost', async () => {
    const result = await service.findDaySupplies({ date: '2026-11-10' });

    expect(result).toEqual({
      date: '2026-11-10',
      timezone: 'America/Bogota',
      orders_total: 4,
      orders_completed: 2,
      orders_without_breakdown: 1,
      supplies: [
        // Azúcar: planned 5+6, consumed 5+2, pending max(6-2,0)=4, difference (5-5)=0
        { product_id: 2, name: 'Azúcar', sku: 'SKU-2', unit: 'g', planned: 11, consumed: 7, pending: 4, difference: 0 },
        // Harina: planned 10+4+3, consumed 12, pending 4+3, difference 12-10
        { product_id: 1, name: 'Harina', sku: 'SKU-1', unit: 'g', planned: 17, consumed: 12, pending: 7, difference: 2 },
      ],
    });
    for (const supply of result.supplies) {
      expect(Object.keys(supply).sort()).toEqual(
        ['consumed', 'difference', 'name', 'pending', 'planned', 'product_id', 'sku', 'unit'],
      );
    }
  });

  it('reads ALL the orders of the day with the same membership as findDay (carried-over in, cancelled out), no pagination, no cost columns', async () => {
    await service.findDaySupplies({ date: '2026-11-10' });

    const arg = prisma.production_orders.findMany.mock.calls[0][0];
    const localStart = new Date('2026-11-10T05:00:00.000Z');
    const localEnd = new Date('2026-11-11T04:59:59.999Z');
    const naiveStart = new Date('2026-11-10T00:00:00.000Z');
    const naiveEnd = new Date('2026-11-10T23:59:59.999Z');
    expect(arg.where.status).toEqual({ not: 'cancelled' });
    expect(arg.where.OR).toEqual([
      { order_id: { not: null }, due_date: { gte: localStart, lte: localEnd } },
      { order_id: null, due_date: { gte: naiveStart, lte: naiveEnd } },
      { due_date: null, created_at: { gte: localStart, lte: localEnd } },
      { status: { in: ['in_progress', 'partially_completed'] }, order_id: { not: null }, due_date: { lt: localStart } },
      { status: { in: ['in_progress', 'partially_completed'] }, order_id: null, due_date: { lt: naiveStart } },
      { status: { in: ['in_progress', 'partially_completed'] }, due_date: null, created_at: { lt: localStart } },
    ]);
    expect(arg).not.toHaveProperty('take');
    expect(arg).not.toHaveProperty('skip');
    expect(JSON.stringify(arg.select)).not.toMatch(/cost/);
  });

  it('a day with no orders returns empty supplies and zero totals', async () => {
    prisma.production_orders.findMany.mockResolvedValue([]);
    const result = await service.findDaySupplies({ date: '2026-11-10' });
    expect(result).toEqual({
      date: '2026-11-10',
      timezone: 'America/Bogota',
      orders_total: 0,
      orders_completed: 0,
      orders_without_breakdown: 0,
      supplies: [],
    });
  });

  it('S7: findDay keeps its response shape and the same day filter (no supplies, no extra reads)', async () => {
    prisma.production_orders.findMany.mockResolvedValue([]);
    const day: any = await service.findDay({ date: '2026-11-10' });

    expect(Object.keys(day).sort()).toEqual(
      ['cards', 'date', 'next_cursor', 'server_now', 'summary', 'timezone'],
    );
    const dayWhere = prisma.production_orders.findMany.mock.calls[0][0].where;
    await service.findDaySupplies({ date: '2026-11-10' });
    expect(prisma.production_orders.findMany.mock.calls[1][0].where).toEqual(dayWhere);
  });
});
