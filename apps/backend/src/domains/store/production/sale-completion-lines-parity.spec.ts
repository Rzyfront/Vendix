import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ProductionOrdersService } from './production-orders.service';

/**
 * S2 — a sale-linked completion writes its lines (recipe + add-ons merged per
 * component) while the stock calls and the `production.completed` payload stay
 * exactly as before. Expected stock/event values captured from develop c8b7674ea.
 */
const D = (n: number) => new Prisma.Decimal(n);
const ctx = { store_id: 1, organization_id: 1, user_id: 42, is_super_admin: false };
const UNIT_COST: Record<number, number> = { 99: 1.37, 98: 2.111, 200: 0.77, 50: 0 };


function world(opts: { addonsConsumedAt?: Date | null; addonClaimCount?: number; initialLines?: any[] }) {
  const order: any = {
    id: 100, store_id: 1, product_id: 50, recipe_id: 7, order_id: 77, product_variant_id: null,
    planned_qty: D(3), produced_qty: null, status: 'in_progress', estimated_minutes: null,
    product: { id: 50, name: 'Torta', sku: 'T', stock_unit: 'u', is_batch_produced: true, preparation_time_minutes: null },
    product_variant: null,
    recipe: {
      id: 7, yield_quantity: D(10), yield_unit: 'u', waste_percent: D(0), preparation_notes: null,
      items: [
        { component_product_id: 99, quantity: D(10), waste_percent: D(0), waste_mode: 'percent', waste_absolute: D(0), component_product: { id: 99, name: 'Harina', sku: 'H', stock_unit: 'g' } },
        { component_product_id: 98, quantity: D(4), waste_percent: D(0), waste_mode: 'percent', waste_absolute: D(0), component_product: { id: 98, name: 'Azucar', sku: 'A', stock_unit: 'g' } },
      ],
    },
  };
  const saleLine = {
    id: 501, product_id: 50, product_variant_id: null, quantity: 3,
    addons_consumed_at: opts.addonsConsumedAt ?? null,
    order_item_options: [
      { scope: 'per_unit', component_type: 'ingredient', component_product_id: 200, component_variant_id: null, quantity: 2 },
      { scope: 'per_line', component_type: 'ingredient', component_product_id: 99, component_variant_id: null, quantity: 5 },
    ],
  };
  let nextId = 1;
  const rows: any[] = (opts.initialLines ?? []).map((l) => ({ id: nextId++, order_id: 100, consumed_qty: D(0), unit_cost: null, total_cost: null, cost_snapshot: null, ...l }));
  const lines = {
    findMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
    create: jest.fn(async ({ data }: any) => { rows.push({ id: nextId++, ...data }); return data; }),
    createMany: jest.fn(async ({ data }: any) => { for (const d of data) rows.push({ id: nextId++, consumed_qty: D(0), unit_cost: null, total_cost: null, cost_snapshot: null, ...d }); return { count: data.length }; }),
    update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
  };
  const stockCalls: any[] = [];
  const stock = {
    updateStock: jest.fn(async (args: any) => {
      stockCalls.push(args);
      const u = UNIT_COST[args.product_id] ?? 0;
      return { cost_snapshot: { unit_cost: u, total_cost: Number((Math.abs(args.quantity_change) * u).toFixed(4)), stock_value: 0 } };
    }),
    getDefaultLocationForProduct: jest.fn(async () => 1),
    reserveStock: jest.fn(async () => undefined),
  };
  const events: any[] = [];
  const emitter = { emit: jest.fn((name: string, payload: any) => { events.push({ name, payload }); return true; }) };
  const tx: any = {
    production_order_lines: lines,
    production_orders: {
      count: jest.fn(async () => 0),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: any) => ({ ...order, status: 'completed', ...data })),
    },
    order_items: {
      findMany: jest.fn(async ({ where }: any) => (where.inventory_committed === false ? [] : [saleLine])),
      updateMany: jest.fn(async () => ({ count: opts.addonClaimCount ?? 1 })),
    },
    orders: { findFirst: jest.fn(async () => ({ id: 77, state: 'processing' })) },
    $queryRaw: jest.fn(async () => [{ id: 77, state: 'processing' }]),
  };
  const prisma: any = {
    production_order_lines: lines,
    production_orders: { findFirst: jest.fn(async () => order), findMany: jest.fn(async () => []), count: jest.fn(async () => 0), aggregate: jest.fn() },
    orders: { findFirst: jest.fn() },
    order_items: { findMany: jest.fn(async () => []) },
    recipes: { findMany: jest.fn(async () => []) },
    products: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new ProductionOrdersService(
    prisma, stock as any,
    { assertIngredientsAvailable: jest.fn(async () => []), resolveInventoryPolicy: jest.fn(async () => ({ allowOversell: false, allowIngredientOveruse: true })) } as any,
    emitter as any, {} as any,
    { commitOrderLines: jest.fn(async () => ({ totalCost: 0, committedItemCount: 1 })) } as any,
    { signUrl: jest.fn(async (k: string) => `signed:${k}`) } as any,
  );
  const dump = () => ({
    lines: rows.map((r) => ({
      component: r.component_product_id, planned: Number(r.planned_qty), consumed: Number(r.consumed_qty),
      unit_cost: r.unit_cost == null ? null : Number(r.unit_cost), total_cost: r.total_cost == null ? null : Number(r.total_cost),
      entries: ((r.cost_snapshot as any)?.entries ?? []).map(({ at, ...e }: any) => e),
    })).sort((a, b) => a.component - b.component),
    stock: stockCalls.map((c) => ({ ...c })),
    events: events.filter((e) => e.name === 'production.completed').map((e) => e.payload),
  });
  return { service, dump };
}


const reason = 'Producción #100 – Torta';
const addonReason = 'Producción #100 – adiciones (pedido #77)';
const consume = (product_id: number, quantity_change: number, r: string) => ({
  product_id, location_id: 1, quantity_change, movement_type: 'consumption', reason: r,
  source_module: 'production', create_movement: true, validate_availability: false, allow_negative: true,
});

describe('sale-linked completion — lines, stock calls and event payload', () => {
  beforeEach(() => jest.spyOn(RequestContextService, 'getContext').mockReturnValue(ctx as any));
  afterEach(() => jest.restoreAllMocks());

  it('stock calls and the production.completed payload are unchanged; the add-on of a recipe component merges into its line', async () => {
    const w = world({
      initialLines: [
        { component_product_id: 99, planned_qty: D(8), sort_order: 0 },
        { component_product_id: 98, planned_qty: D(1), sort_order: 1 },
        { component_product_id: 200, planned_qty: D(6), sort_order: 2 },
      ],
    });
    await w.service.complete(100, { produced_qty: 3 } as any);
    const d = w.dump();
    expect(d.stock).toEqual([
      consume(99, -3, reason),
      consume(98, -1, reason),
      consume(200, -6, addonReason),
      consume(99, -5, addonReason),
      { product_id: 50, location_id: 1, quantity_change: 3, movement_type: 'production', reason, source_module: 'production', create_movement: true, unit_cost: 5.897 },
    ]);
    expect(d.events).toEqual([
      { production_order_id: 100, organization_id: 1, store_id: 1, product_id: 50, product_name: 'Torta', produced_qty: 3, produced_unit_cost: 5.897, total_cost: 17.691, consumed_line_count: 4, user_id: 42 },
    ]);
    expect(d.lines).toEqual([
      { component: 98, planned: 1, consumed: 1, unit_cost: 2.111, total_cost: 2.111, entries: [{ quantity: 1, unit_cost: 2.111, total_cost: 2.111 }] },
      // recipe 3 + add-on 5 in ONE line and ONE entry; cost 4.11 + 6.85
      { component: 99, planned: 8, consumed: 8, unit_cost: 1.37, total_cost: 10.96, entries: [{ quantity: 8, unit_cost: 1.37, total_cost: 10.96 }] },
      { component: 200, planned: 6, consumed: 6, unit_cost: 0.77, total_cost: 4.62, entries: [{ quantity: 6, unit_cost: 0.77, total_cost: 4.62 }] },
    ]);
  });
});
