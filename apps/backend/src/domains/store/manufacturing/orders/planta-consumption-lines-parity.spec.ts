import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ProductionOrdersService } from '../../production/production-orders.service';
import { ManufacturingOrdersService } from './manufacturing-orders.service';

/**
 * Planta parity (S2/S7): with `persistLines` moved from `onProduced` into
 * `complete()`, the same inputs must store the same consumed_qty, unit_cost,
 * total_cost and cost_snapshot.entries as before, and the stock calls and the
 * `production.completed` payload must not change. The expected numbers below
 * were captured from the pre-change code (develop c8b7674ea) with these mocks.
 */
const D = (n: number) => new Prisma.Decimal(n);
const ctx = { store_id: 1, organization_id: 1, user_id: 42, is_super_admin: false };
const UNIT_COST: Record<number, number> = { 99: 1.37, 98: 2.111, 97: 0.333, 200: 0.77, 50: 0 };
const comp = (id: number) => ({ id, name: `C${id}`, sku: `S${id}`, stock_unit: 'g' });

const recipe = () => ({
  id: 7,
  yield_quantity: D(4),
  yield_unit: 'u',
  waste_percent: D(10),
  preparation_notes: null,
  items: [
    { id: 1, component_product_id: 99, quantity: D(8), waste_percent: D(0), waste_mode: 'percent', waste_absolute: D(0), component_product: comp(99) },
    { id: 2, component_product_id: 98, quantity: D(3), waste_percent: D(5), waste_mode: 'percent', waste_absolute: D(0), component_product: comp(98) },
    { id: 3, component_product_id: 97, quantity: D(1.5), waste_percent: D(0), waste_mode: 'absolute', waste_absolute: D(0.5), component_product: comp(97) },
  ],
});

function makeWorld(initialLines: any[], orderOver: Record<string, unknown> = {}) {
  const order: any = {
    id: 1, store_id: 1, product_id: 50, recipe_id: 7, order_number: 'OP-1', status: 'in_progress',
    planned_qty: D(10), produced_qty: null, actual_cost: null, unit_cost: null, batch_id: null,
    location_id: null, order_id: null, estimated_minutes: null,
    product: { id: 50, name: 'Mesa', sku: 'M', stock_unit: 'u', is_batch_produced: true, preparation_time_minutes: null },
    product_variant: null, sale_order: null, recipe: recipe(),
    ...orderOver,
  };
  let nextId = 1;
  const rows: any[] = initialLines.map((l) => ({
    id: nextId++, order_id: 1, consumed_qty: D(0), unit_cost: null, total_cost: null, cost_snapshot: null, sort_order: 0, ...l,
  }));
  const lines = {
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => !where?.order_id || r.order_id === where.order_id).map((r) => ({ ...r }))),
    findFirst: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => x.order_id === where.order_id && x.component_product_id === where.component_product_id);
      return r ? { ...r } : null;
    }),
    count: jest.fn(async ({ where }: any) => rows.filter((r) => r.order_id === where.order_id && Number(r.consumed_qty) > 0).length),
    create: jest.fn(async ({ data }: any) => { const r = { id: nextId++, consumed_qty: D(0), unit_cost: null, total_cost: null, cost_snapshot: null, sort_order: 0, ...data }; rows.push(r); return { ...r }; }),
    createMany: jest.fn(async ({ data }: any) => { for (const d of data) rows.push({ id: nextId++, consumed_qty: D(0), unit_cost: null, total_cost: null, cost_snapshot: null, ...d }); return { count: data.length }; }),
    update: jest.fn(async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return { ...r }; }),
    deleteMany: jest.fn(async ({ where }: any) => { const keep = rows.filter((r) => r.order_id !== where.order_id); const n = rows.length - keep.length; rows.length = 0; rows.push(...keep); return { count: n }; }),
  };
  const stockCalls: any[] = [];
  const stock = {
    updateStock: jest.fn(async (args: any) => {
      stockCalls.push(args);
      const qty = Math.abs(args.quantity_change);
      const u = UNIT_COST[args.product_id] ?? 0;
      return { cost_snapshot: { unit_cost: u, total_cost: Number((qty * u).toFixed(4)), stock_value: 0 } };
    }),
    getDefaultLocationForProduct: jest.fn(async () => 1),
    reserveStock: jest.fn(async () => undefined),
  };
  const events: any[] = [];
  const emitter = { emit: jest.fn((name: string, payload: any) => { events.push({ name, payload }); return true; }) };
  const orderUpdate = jest.fn(async ({ data }: any) => { Object.assign(order, data); return { ...order }; });
  const tx: any = {
    production_orders: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: orderUpdate,
      count: jest.fn(async () => 0),
    },
    production_order_lines: lines,
    inventory_batches: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 1 })), update: jest.fn() },
  };
  const prisma: any = {
    production_orders: {
      findFirst: jest.fn(async () => ({ ...order, lines: rows.filter((r) => r.order_id === 1).map((r) => ({ ...r, component_product: comp(r.component_product_id) })) })),
      update: orderUpdate,
    },
    production_order_lines: lines,
    inventory_locations: { findFirst: jest.fn(async () => ({ id: 1 })) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const validator = {
    assertIngredientsAvailable: jest.fn(async () => []),
    resolveInventoryPolicy: jest.fn(async () => ({ allowOversell: false, allowIngredientOveruse: false })),
  };
  const production = new ProductionOrdersService(prisma, stock as any, validator as any, emitter as any);
  const settings = { get: jest.fn(async () => ({ default_input_location_id: null, default_output_location_id: null, cost_method: 'cpp', lot_required: false })) };
  const planta = new ManufacturingOrdersService(
    prisma, production, { calculateCost: jest.fn(async () => ({ unit_cost: 1 })) } as any,
    settings as any, { next: jest.fn(async () => 'OP-1') } as any, stock as any, emitter as any,
  );
  const dump = () => ({
    lines: rows
      .map((r) => ({
        component: r.component_product_id,
        planned: Number(r.planned_qty),
        consumed: Number(r.consumed_qty),
        unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
        total_cost: r.total_cost == null ? null : Number(r.total_cost),
        entries: ((r.cost_snapshot as any)?.entries ?? []).map(({ at, ...e }: any) => e),
      }))
      .sort((a, b) => a.component - b.component || a.planned - b.planned),
    stock: stockCalls.map((c) => ({ ...c })),
    events: events
      .filter((e) => e.name === 'production.completed')
      .map((e) => ({ name: e.name, payload: { ...e.payload } })),
    order: {
      status: order.status,
      produced_qty: order.produced_qty == null ? null : Number(order.produced_qty),
      actual_cost: order.actual_cost == null ? null : Number(order.actual_cost),
      unit_cost: order.unit_cost == null ? null : Number(order.unit_cost),
    },
  });
  return { order, rows, planta, production, dump, tx, prisma, stock };
}

// Planta create plan for 10 units: 99 -> 22, 98 -> 9, 97 -> 6 (computeComponentRequirements)
const plantaPlan = () => [
  { component_product_id: 99, planned_qty: D(22), sort_order: 0 },
  { component_product_id: 98, planned_qty: D(9), sort_order: 1 },
  { component_product_id: 97, planned_qty: D(6), sort_order: 2 },
];


const line = (component: number, planned: number, consumed: number, unit_cost: number, total_cost: number, entries: Array<[number, number, number]>) => ({
  component, planned, consumed, unit_cost, total_cost,
  entries: entries.map(([quantity, u, t]) => ({ quantity, unit_cost: u, total_cost: t })),
});

describe('Planta consumption lines — parity with the pre-change persistLines', () => {
  beforeEach(() => jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any));
  afterEach(() => jest.restoreAllMocks());

  it('single complete stores the same lines, stock calls and event payload', async () => {
    const w = makeWorld(plantaPlan());
    await w.planta.complete(1, {} as any);
    const d = w.dump();
    expect(d.lines).toEqual([
      line(97, 6, 6, 0.333, 1.998, [[6, 0.333, 1.998]]),
      line(98, 9, 9, 2.111, 18.999, [[9, 2.111, 18.999]]),
      line(99, 22, 22, 1.37, 30.14, [[22, 1.37, 30.14]]),
    ]);
    expect(d.order).toEqual({ status: 'completed', produced_qty: 10, actual_cost: 51.137, unit_cost: 5.1137 });
    expect(d.stock.map((s: any) => [s.product_id, s.quantity_change, s.movement_type, s.costing_method ?? null, s.source_module])).toEqual([
      [99, -22, 'consumption', 'weighted_average', 'manufacturing'],
      [98, -9, 'consumption', 'weighted_average', 'manufacturing'],
      [97, -6, 'consumption', 'weighted_average', 'manufacturing'],
      [50, 10, 'production', null, 'manufacturing'],
    ]);
    expect(d.events).toHaveLength(1);
    expect(d.events[0].payload).toMatchObject({
      production_order_id: 1, produced_qty: 10, produced_unit_cost: 5.1137, consumed_line_count: 3, source_module: 'manufacturing',
      lines: [
        { component_product_id: 99, consumed_qty: 22, cost_snapshot: { unit_cost: 1.37, total_cost: 30.14, stock_value: 0 } },
        { component_product_id: 98, consumed_qty: 9, cost_snapshot: { unit_cost: 2.111, total_cost: 18.999, stock_value: 0 } },
        { component_product_id: 97, consumed_qty: 6, cost_snapshot: { unit_cost: 0.333, total_cost: 1.998, stock_value: 0 } },
      ],
    });
    expect(d.events[0].payload.total_cost).toBeCloseTo(51.137, 6);
  });

  it('two partial completes (3 then 7) accumulate exactly once each, one entry per delivery', async () => {
    const w = makeWorld(plantaPlan());
    await w.planta.complete(1, { produced_qty: 3 } as any);
    expect(w.dump().lines).toEqual([
      line(97, 6, 2, 0.333, 0.666, [[2, 0.333, 0.666]]),
      line(98, 9, 3, 2.111, 6.333, [[3, 2.111, 6.333]]),
      line(99, 22, 7, 1.37, 9.59, [[7, 1.37, 9.59]]),
    ]);
    expect(w.dump().order).toEqual({ status: 'partially_completed', produced_qty: 3, actual_cost: 16.589, unit_cost: 5.5297 });
    await w.planta.complete(1, { produced_qty: 7 } as any);
    expect(w.dump().lines).toEqual([
      line(97, 6, 6, 0.333, 1.998, [[2, 0.333, 0.666], [4, 0.333, 1.332]]),
      line(98, 9, 9, 2.111, 18.999, [[3, 2.111, 6.333], [6, 2.111, 12.666]]),
      line(99, 22, 22, 1.37, 30.14, [[7, 1.37, 9.59], [15, 1.37, 20.55]]),
    ]);
    expect(w.dump().order).toEqual({ status: 'completed', produced_qty: 10, actual_cost: 51.137, unit_cost: 5.1137 });
  });

  it('a consumed component with no planned line gets one (planned = consumed) and then accumulates', async () => {
    const w = makeWorld([{ component_product_id: 99, planned_qty: D(22), sort_order: 0 }]);
    await w.planta.complete(1, { produced_qty: 4 } as any);
    await w.planta.complete(1, { produced_qty: 6 } as any);
    expect(w.dump().lines).toEqual([
      line(97, 2, 5, 0.333, 1.665, [[2, 0.333, 0.666], [3, 0.333, 0.999]]),
      line(98, 3, 8, 2.111, 16.888, [[3, 2.111, 6.333], [5, 2.111, 10.555]]),
      line(99, 22, 22, 1.37, 30.14, [[9, 1.37, 12.33], [13, 1.37, 17.81]]),
    ]);
  });

  it('a delivery after consumption stored by the old code appends to its entries and blends the unit cost', async () => {
    const w = makeWorld(
      [
        { component_product_id: 99, planned_qty: D(22), consumed_qty: D(9), unit_cost: D(1.2), total_cost: D(10.8), cost_snapshot: { entries: [{ quantity: 9, unit_cost: 1.2, total_cost: 10.8, at: 'x' }] }, sort_order: 0 },
        { component_product_id: 98, planned_qty: D(9), consumed_qty: D(4), unit_cost: D(2), total_cost: D(8), cost_snapshot: { entries: [{ quantity: 4, unit_cost: 2, total_cost: 8, at: 'x' }] }, sort_order: 1 },
        { component_product_id: 97, planned_qty: D(6), sort_order: 2 },
      ],
      { status: 'partially_completed', produced_qty: D(4), actual_cost: D(18.8) },
    );
    await w.planta.complete(1, {} as any);
    expect(w.dump().lines).toEqual([
      line(97, 6, 3, 0.333, 0.999, [[3, 0.333, 0.999]]),
      line(98, 9, 9, 2.0617, 18.555, [[4, 2, 8], [5, 2.111, 10.555]]),
      line(99, 22, 22, 1.3005, 28.61, [[9, 1.2, 10.8], [13, 1.37, 17.81]]),
    ]);
    expect(w.dump().order).toEqual({ status: 'completed', produced_qty: 10, actual_cost: 48.164, unit_cost: 4.8164 });
  });

  it('a restaurant completion keeps its stock calls and event payload, and now stores its lines', async () => {
    const w = makeWorld([], { order_number: null, planned_qty: D(8) });
    await w.production.complete(1, { produced_qty: 8 } as any);
    const d = w.dump();
    expect(d.stock.map((s: any) => [s.product_id, s.quantity_change, s.movement_type, s.source_module])).toEqual([
      [99, -18, 'consumption', 'production'],
      [98, -7, 'consumption', 'production'],
      [97, -4, 'consumption', 'production'],
      [50, 8, 'production', 'production'],
    ]);
    expect(d.events[0].payload).not.toHaveProperty('lines');
    expect(d.events[0].payload).not.toHaveProperty('source_module');
    expect(d.lines).toEqual([
      line(97, 4, 4, 0.333, 1.332, [[4, 0.333, 1.332]]),
      line(98, 7, 7, 2.111, 14.777, [[7, 2.111, 14.777]]),
      line(99, 18, 18, 1.37, 24.66, [[18, 1.37, 24.66]]),
    ]);
  });
});
