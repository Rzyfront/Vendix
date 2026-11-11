import { Prisma } from '@prisma/client';
import { ProductionSaleLinkService } from './production-sale-link.service';
import { requestProductionSaleSync } from './production-sale-sync';

describe('ProductionSaleLinkService (QUI-995)', () => {
  const start = new Date('2026-11-10T15:00:00Z');
  let tx: any;
  let client: any;
  let service: ProductionSaleLinkService;
  let sequences: { next: jest.Mock };

  const sale = (items: any[], over: Record<string, unknown> = {}) => ({
    id: 77,
    store_id: 1,
    state: 'processing',
    created_at: new Date('2026-11-09T10:00:00Z'),
    fulfillment_schedule: { scheduled_start: start },
    order_items: items,
    ...over,
  });

  // Recipe 7 of product 50: yield 1, one item (component 99, 2 per unit, no waste).
  const recipe7 = {
    id: 7,
    product_id: 50,
    product_variant_id: null,
    waste_percent: 0,
    yield_quantity: 1,
    items: [
      { component_product_id: 99, quantity: 2, waste_percent: 0, waste_mode: 'percent', waste_absolute: null },
    ],
  };
  let lineConsumed = 0;
  // Planned lines a draft already has (default: the plan of recipe 7 for 5 units).
  let currentLines: Array<{ component_product_id: number; planned_qty: Prisma.Decimal }> = [];
  let recipesService: { explodeBom: jest.Mock };

  const setup = (s: any, existing: any[] = [], recipes: any[] = [recipe7]) => {
    lineConsumed = 0;
    currentLines = [{ component_product_id: 99, planned_qty: new Prisma.Decimal(10) }];
    tx = {
      production_orders: {
        findMany: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 100 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      production_order_lines: {
        count: jest.fn(async () => lineConsumed),
        findMany: jest.fn(async () => currentLines),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    client = {
      orders: { findFirst: jest.fn().mockResolvedValue(s) },
      recipes: { findMany: jest.fn().mockResolvedValue(recipes) },
      production_orders: {
        findFirst: jest.fn().mockResolvedValue(existing.length > 0 ? { id: existing[0].id } : null),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    sequences = { next: jest.fn().mockResolvedValue('OP-000001') };
    recipesService = { explodeBom: jest.fn().mockResolvedValue([]) };
    service = new ProductionSaleLinkService(
      { withoutScope: () => client } as any,
      sequences as any,
      {} as any,
      undefined,
      recipesService as any,
      {} as any,
    );
  };

  it('creates ONE order per product, grouping two lines of the same product (planned_qty = sum)', async () => {
    setup(sale([
      { id: 1, product_id: 50, quantity: 2 },
      { id: 2, product_id: 50, quantity: 3 },
    ]));
    await service.ensureForOrder(77);
    expect(tx.production_orders.create).toHaveBeenCalledTimes(1);
    expect(tx.production_orders.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 1,
        product_id: 50,
        recipe_id: 7,
        order_id: 77,
        status: 'draft',
        source: 'order',
        order_number: 'OP-000001',
        due_date: start,
      }),
      select: { id: true },
    });
    expect(Number(tx.production_orders.create.mock.calls[0][0].data.planned_qty)).toBe(5);
  });

  it('S1: a new sale order is created with one planned line per recipe item for the summed quantity, consumed 0', async () => {
    setup(sale([
      { id: 1, product_id: 50, quantity: 2 },
      { id: 2, product_id: 50, quantity: 3 },
    ]));
    await service.ensureForOrder(77);
    // 5 units x 2 per unit of component 99
    expect(tx.production_orders.create.mock.calls[0][0].data.lines).toEqual({
      create: [{ component_product_id: 99, planned_qty: new Prisma.Decimal(10), sort_order: 0 }],
    });
    expect(tx.production_order_lines.deleteMany).not.toHaveBeenCalled();
  });

  it('S1: the add-ons of the sale lines add their requirement (same expansion as the consumption) to the same component', async () => {
    const addon = (component_product_id: number, quantity: number, scope = 'per_unit') => ({
      scope,
      component_type: 'ingredient',
      component_product_id,
      component_variant_id: null,
      quantity,
    });
    setup(sale([
      // 2 units: add-on 99 x1 per unit (same component as the recipe) and 200 x1 per line
      { id: 1, product_id: 50, quantity: 2, order_item_options: [addon(99, 1), addon(200, 1, 'per_line')] },
      { id: 2, product_id: 50, quantity: 3, order_item_options: [addon(200, 2)] },
    ]));
    await service.ensureForOrder(77);
    // 99: recipe 5 x 2 = 10 + add-on 2 units x 1 = 12;  200: 1 (per line) + 2 x 3 = 7
    expect(tx.production_orders.create.mock.calls[0][0].data.lines.create).toEqual([
      { component_product_id: 99, planned_qty: new Prisma.Decimal(12), sort_order: 0 },
      { component_product_id: 200, planned_qty: new Prisma.Decimal(7), sort_order: 1 },
    ]);
  });

  it('S7: an add-on that cannot be expanded never blocks the production order; only the base recipe is planned', async () => {
    const failing = (component_type: string) => ({
      scope: 'per_unit',
      component_type,
      component_product_id: 300,
      component_variant_id: null,
      quantity: 1,
    });
    setup(sale([
      { id: 1, product_id: 50, quantity: 5, order_item_options: [failing('recipe'), failing('product')] },
    ]));
    const boom = new Error('BOM cycle');
    tx.recipes = { findMany: jest.fn().mockRejectedValue(boom) };
    tx.products = { findFirst: jest.fn().mockRejectedValue(boom) };
    recipesService.explodeBom.mockRejectedValue(boom);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    const result = await service.ensureForOrder(77);

    expect(result).toEqual([{ id: 100 }]);
    expect(tx.production_orders.create).toHaveBeenCalledTimes(1);
    expect(tx.production_orders.create.mock.calls[0][0].data.lines).toEqual({
      create: [{ component_product_id: 99, planned_qty: new Prisma.Decimal(10), sort_order: 0 }],
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Add-on plan skipped'));
  });

  it('S1: a draft whose sale quantity changes gets its lines rebuilt (delete by order id, recreate), only while nothing was consumed', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 8 }]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_order_lines.deleteMany).toHaveBeenCalledWith({ where: { order_id: 100 } });
    expect(tx.production_order_lines.createMany).toHaveBeenCalledWith({
      data: [
        { order_id: 100, component_product_id: 99, planned_qty: new Prisma.Decimal(16), sort_order: 0 },
      ],
    });
  });

  it('S1: a draft whose quantity did not change keeps its lines untouched', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 5 }]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: new Date('2026-11-01T00:00:00Z') }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_order_lines.deleteMany).not.toHaveBeenCalled();
    expect(tx.production_order_lines.createMany).not.toHaveBeenCalled();
  });

  it('A2: a draft whose add-ons change while its quantity stays the same gets its lines re-planned', async () => {
    setup(
      sale([
        {
          id: 1,
          product_id: 50,
          quantity: 5,
          order_item_options: [
            { scope: 'per_unit', component_type: 'ingredient', component_product_id: 200, component_variant_id: null, quantity: 1 },
          ],
        },
      ]),
      [{ id: 100, product_id: 50, recipe_id: 7, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    await service.ensureForOrder(77);
    // Same quantity and due date: the order row is not rewritten, only its plan.
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
    expect(tx.production_order_lines.deleteMany).toHaveBeenCalledWith({ where: { order_id: 100 } });
    expect(tx.production_order_lines.createMany).toHaveBeenCalledWith({
      data: [
        { order_id: 100, component_product_id: 99, planned_qty: new Prisma.Decimal(10), sort_order: 0 },
        { order_id: 100, component_product_id: 200, planned_qty: new Prisma.Decimal(5), sort_order: 1 },
      ],
    });
  });

  it('A2: a draft created before the plan existed (no lines) gets its planned lines on the next sync', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 5 }]),
      [{ id: 100, product_id: 50, recipe_id: 7, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    currentLines = [];
    await service.ensureForOrder(77);
    expect(tx.production_order_lines.createMany).toHaveBeenCalledWith({
      data: [{ order_id: 100, component_product_id: 99, planned_qty: new Prisma.Decimal(10), sort_order: 0 }],
    });
  });

  it('S1: lines with consumption are never rebuilt', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 8 }]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    lineConsumed = 1;
    await service.ensureForOrder(77);
    expect(tx.production_order_lines.deleteMany).not.toHaveBeenCalled();
    expect(tx.production_order_lines.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent: an existing order with the same quantity is neither created nor rewritten', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 5 }]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    const result = await service.ensureForOrder(77);
    expect(result).toEqual([{ id: 100 }]);
    expect(tx.production_orders.create).not.toHaveBeenCalled();
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
  });

  it('draft re-ensure adjusts planned_qty (guarded by status draft)', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 8 }]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: 100, status: 'draft' },
      data: expect.objectContaining({ due_date: start }),
    });
    expect(Number(tx.production_orders.updateMany.mock.calls[0][0].data.planned_qty)).toBe(8);
  });

  it('never rewrites an order that already started', async () => {
    setup(
      sale([{ id: 1, product_id: 50, quantity: 8 }]),
      [{ id: 100, product_id: 50, status: 'in_progress', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
  });

  it('cancels a draft whose lines are gone', async () => {
    setup(
      sale([]),
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: 100, status: 'draft' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
  });

  it('does nothing for a cancelled sale', async () => {
    setup(sale([{ id: 1, product_id: 50, quantity: 1 }], { state: 'cancelled' }));
    expect(await service.ensureForOrder(77)).toEqual([]);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('S5: a sale with no live production line and no linked order opens no transaction and reads no recipes', async () => {
    setup(sale([]));
    expect(await service.ensureForOrder(77)).toEqual([]);
    expect(client.production_orders.findFirst).toHaveBeenCalledWith({
      where: { store_id: 1, order_id: 77 },
      select: { id: true },
    });
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(client.recipes.findMany).not.toHaveBeenCalled();
    expect(tx.production_orders.findMany).not.toHaveBeenCalled();
  });

  it('S5: a sale with live production lines does not run the early-exit lookup and syncs as before', async () => {
    setup(sale([{ id: 1, product_id: 50, quantity: 2 }]));
    await service.ensureForOrder(77);
    expect(client.production_orders.findFirst).not.toHaveBeenCalled();
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.production_orders.create).toHaveBeenCalledTimes(1);
  });

  it('skips a product without an active recipe', async () => {
    setup(sale([{ id: 1, product_id: 50, quantity: 1 }]), [], []);
    await service.ensureForOrder(77);
    expect(tx.production_orders.create).not.toHaveBeenCalled();
  });

  it('retries once on a unique-constraint race', async () => {
    setup(sale([{ id: 1, product_id: 50, quantity: 1 }]));
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    client.$transaction.mockRejectedValueOnce(err);
    await service.ensureForOrder(77);
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });

  it('S21: a cancelled order is NOT revived when its sale is edited: it refreshes quantity and delivery and stays cancelled (replaces QUI-995 B1)', async () => {
    const later = new Date('2026-11-12T15:00:00Z');
    setup(
      sale([{ id: 3, product_id: 50, quantity: 2 }], { fulfillment_schedule: { scheduled_start: later } }),
      [{ id: 100, product_id: 50, status: 'cancelled', planned_qty: new Prisma.Decimal(1), due_date: start }],
    );
    const result = await service.ensureForOrder(77);
    expect(result).toEqual([{ id: 100 }]);
    expect(tx.production_orders.create).not.toHaveBeenCalled();
    expect(tx.production_orders.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.production_orders.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 100, status: 'cancelled' });
    expect(call.data).toEqual(expect.objectContaining({ due_date: later }));
    expect(call.data.status).toBeUndefined();
    expect(call.data.started_at).toBeUndefined();
    expect(Number(call.data.planned_qty)).toBe(2);
  });

  it('S28: an order cancelled from Planta with produced_qty > 0 is not revived by the next sale sync (even when the sale quantity changed)', async () => {
    setup(
      sale([{ id: 3, product_id: 50, quantity: 4 }]),
      [{ id: 100, product_id: 50, status: 'cancelled', produced_qty: new Prisma.Decimal(2), planned_qty: new Prisma.Decimal(1), due_date: start }],
    );
    const result = await service.ensureForOrder(77);
    expect(result).toEqual([{ id: 100 }]);
    expect(tx.production_orders.create).not.toHaveBeenCalled();
    for (const [arg] of tx.production_orders.updateMany.mock.calls) {
      expect(arg.where).toEqual({ id: 100, status: 'cancelled' });
      expect(arg.data.status).toBeUndefined();
    }
  });

  it('S21: a cancelled order whose quantity and delivery already match is not rewritten', async () => {
    setup(
      sale([{ id: 3, product_id: 50, quantity: 2 }]),
      [{ id: 100, product_id: 50, status: 'cancelled', planned_qty: new Prisma.Decimal(2), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
  });

  describe('planRestart (S21)', () => {
    const plan = (s: any, orders: any[]) => {
      client = {
        orders: { findFirst: jest.fn().mockResolvedValue(s) },
        production_orders: { findMany: jest.fn().mockResolvedValue(orders) },
      };
      service = new ProductionSaleLinkService({ withoutScope: () => client } as any, {} as any);
    };

    it('returns the sale state, the summed quantity of the live lines paired with the order and the delivery instant', async () => {
      plan(
        sale([
          { id: 1, product_id: 50, product_variant_id: 10, quantity: 2 },
          { id: 2, product_id: 50, product_variant_id: 10, quantity: 3 },
          { id: 3, product_id: 50, product_variant_id: 11, quantity: 9 },
        ]),
        [
          { id: 100, product_id: 50, product_variant_id: 10 },
          { id: 101, product_id: 50, product_variant_id: 11 },
        ],
      );
      await expect(service.planRestart(77, 100)).resolves.toEqual({
        sale_state: 'processing',
        qty: 5,
        due_date: start,
        // S1: the live lines paired with the order travel along for the restart plan.
        items: [
          { id: 1, product_id: 50, product_variant_id: 10, quantity: 2 },
          { id: 2, product_id: 50, product_variant_id: 10, quantity: 3 },
        ],
      });
      // Only live production lines are read (same filter ensureForOrder uses).
      expect(client.orders.findFirst.mock.calls[0][0].select.order_items.where).toEqual({
        cancelled_at: null,
        fulfillment_destination: 'production',
        product_id: { not: null },
      });
    });

    it('reports quantity 0 when no live line pairs with the order, and null when the sale is gone', async () => {
      plan(sale([{ id: 1, product_id: 51, quantity: 4 }]), [{ id: 100, product_id: 50, product_variant_id: null }]);
      await expect(service.planRestart(77, 100)).resolves.toMatchObject({ qty: 0 });
      plan(null, []);
      await expect(service.planRestart(77, 100)).resolves.toBeNull();
    });
  });

  it('leaves a cancelled order alone while its product is not in the sale', async () => {
    setup(
      sale([]),
      [{ id: 100, product_id: 50, status: 'cancelled', planned_qty: new Prisma.Decimal(1), due_date: start }],
    );
    await service.ensureForOrder(77);
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
  });

  it('QUI-995 F4: creates ONE order per product+variant and stores the sold variant', async () => {
    setup(sale([
      { id: 1, product_id: 50, product_variant_id: 10, quantity: 2 },
      { id: 2, product_id: 50, product_variant_id: 10, quantity: 1 },
      { id: 3, product_id: 50, product_variant_id: 11, quantity: 4 },
    ]));
    tx.production_orders.create
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    const result = await service.ensureForOrder(77);
    expect(result).toEqual([{ id: 101 }, { id: 102 }]);
    expect(tx.production_orders.create).toHaveBeenCalledTimes(2);
    const created = tx.production_orders.create.mock.calls.map((c: any) => c[0].data);
    expect(created.map((d: any) => [d.product_variant_id, Number(d.planned_qty)])).toEqual([
      [10, 3],
      [11, 4],
    ]);
  });

  it('QUI-995 F4: a variant order is matched by product AND variant (no duplicate on re-ensure)', async () => {
    setup(
      sale([{ id: 1, product_id: 50, product_variant_id: 10, quantity: 2 }]),
      [{ id: 100, product_id: 50, product_variant_id: 10, status: 'draft', planned_qty: new Prisma.Decimal(2), due_date: start }],
    );
    const result = await service.ensureForOrder(77);
    expect(result).toEqual([{ id: 100 }]);
    expect(tx.production_orders.create).not.toHaveBeenCalled();
    expect(tx.production_orders.updateMany).not.toHaveBeenCalled();
  });

  it('QUI-995 F4: a non-variant sale stores a NULL variant (previous behavior)', async () => {
    setup(sale([{ id: 1, product_id: 50, product_variant_id: null, quantity: 2 }]));
    await service.ensureForOrder(77);
    expect(tx.production_orders.create.mock.calls[0][0].data.product_variant_id).toBeNull();
  });

  it('requestProductionSaleSync swallows listener failures', async () => {
    const warn = jest.fn();
    await expect(
      requestProductionSaleSync({ emitAsync: jest.fn().mockRejectedValue(new Error('boom')) }, { warn }, { order_id: 1 }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('ProductionSaleLinkService.handleSaleCancelled (QUI-995)', () => {
  let client: any;
  let tx: any;
  let slm: any;
  let service: ProductionSaleLinkService;

  const setup = (linked: any[], lines: any[] = []) => {
    tx = {};
    client = {
      production_orders: {
        findMany: jest.fn().mockResolvedValue(linked),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order_items: { findMany: jest.fn().mockResolvedValue(lines) },
      stores: { findUnique: jest.fn().mockResolvedValue({ organization_id: 9 }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    slm = {
      releaseReservationQuantity: jest.fn(async (...args: any[]) => args[4]),
      getDefaultLocationForProduct: jest.fn().mockResolvedValue(4),
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { total_cost: 4500 } }),
    };
    emitter = { emit: jest.fn() };
    service = new ProductionSaleLinkService({ withoutScope: () => client } as any, {} as any, slm, emitter);
  };
  let emitter: any;
  const completed = { id: 100, product_id: 50, status: 'completed', planned_qty: 3, produced_qty: 5 };

  it('cancels draft and in_progress linked orders, status-guarded', async () => {
    setup([
      { id: 1, product_id: 50, status: 'draft', planned_qty: 1, produced_qty: null },
      { id: 2, product_id: 51, status: 'in_progress', planned_qty: 1, produced_qty: null },
    ]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(client.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] }, status: { in: ['draft', 'in_progress', 'released'] } },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(slm.releaseReservationQuantity).not.toHaveBeenCalled();
  });

  it('completed + release: reservation released as cancelled for min(produced, planned), no write-off', async () => {
    setup([completed]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'release' });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'cancelled', tx, { decrementOnHand: false });
    expect(slm.updateStock).not.toHaveBeenCalled();
  });

  it('completed + waste: reservation consumed and a damage movement written off', async () => {
    setup([completed]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste', reason: 'cliente se fue' });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'consumed', tx, { decrementOnHand: false });
    expect(slm.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 50, quantity_change: -3, movement_type: 'damage', location_id: 4 }),
      tx,
    );
  });

  it('completed + waste: emits production.sale_waste with the written-off cost after the movement', async () => {
    setup([{ ...completed, product: { name: 'Torta' } }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('production.sale_waste', {
      production_order_id: 100,
      order_id: 77,
      organization_id: 9,
      store_id: 1,
      product_name: 'Torta',
      quantity: 3,
      total_cost: 4500,
    });
  });

  it('completed + release: no accounting event (the goods stay in inventory)', async () => {
    setup([completed]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'release' });
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('waste writes off only what was still reserved after a partial delivery (QUI-995 B3)', async () => {
    setup([{ ...completed, planned_qty: 2, produced_qty: 2, product: { name: 'Torta' } }]);
    slm.releaseReservationQuantity.mockResolvedValueOnce(1);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(slm.updateStock).toHaveBeenCalledTimes(1);
    expect(slm.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 50, quantity_change: -1, movement_type: 'damage' }),
      tx,
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      'production.sale_waste',
      expect.objectContaining({ production_order_id: 100, quantity: 1 }),
    );
  });

  it('waste with nothing left reserved writes nothing off and emits nothing', async () => {
    setup([completed]);
    slm.releaseReservationQuantity.mockResolvedValueOnce(0);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(slm.updateStock).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('lines already committed (stock left with the delivery): no release, no write-off, no event', async () => {
    setup([completed], [{ product_id: 50, notes: null, inventory_committed: true, order_item_options: [] }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(slm.releaseReservationQuantity).not.toHaveBeenCalled();
    expect(slm.updateStock).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('S6: an omitted disposition releases (reuse) even when a linked line has add-ons or a note (was: waste)', async () => {
    setup([completed], [{ notes: 'Feliz cumple', order_item_options: [{ id: 1 }] }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'cancelled', tx, { decrementOnHand: false });
    expect(slm.updateStock).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('omitted disposition releases when lines are plain', async () => {
    setup([completed], [{ notes: null, order_item_options: [] }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'cancelled', tx, { decrementOnHand: false });
    expect(slm.updateStock).not.toHaveBeenCalled();
  });

  const completedB = { id: 101, product_id: 51, status: 'completed', planned_qty: 2, produced_qty: 2, order_number: 'OP-2', product: { name: 'Torta personalizada' } };
  const completedA = { ...completed, order_number: 'OP-1', product: { name: 'Torta' } };

  it('S6: each production order gets ITS own choice (A release, B waste)', async () => {
    setup([completedA, completedB]);
    await service.handleSaleCancelled({
      order_id: 77,
      store_id: 1,
      dispositions: [
        { production_order_id: 100, disposition: 'release' },
        { production_order_id: 101, disposition: 'waste' },
      ],
    });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'cancelled', tx, { decrementOnHand: false });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 51, null, 2, 'consumed', tx, { decrementOnHand: false });
    expect(slm.updateStock).toHaveBeenCalledTimes(1);
    expect(slm.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 51, quantity_change: -2, movement_type: 'damage' }),
      tx,
    );
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('production.sale_waste', expect.objectContaining({ production_order_id: 101, quantity: 2 }));
  });

  it('S6: with no choice at all every completed order is released (server default)', async () => {
    setup([completedA, completedB], [{ product_id: 51, notes: 'sin gluten', order_item_options: [{ id: 1 }] }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledTimes(2);
    for (const call of slm.releaseReservationQuantity.mock.calls) expect(call[5]).toBe('cancelled');
    expect(slm.updateStock).not.toHaveBeenCalled();
  });

  it('S6: the single productionDisposition keeps working for every order without its own choice, and a per-order choice wins over it', async () => {
    setup([completedA, completedB]);
    await service.handleSaleCancelled({
      order_id: 77,
      store_id: 1,
      disposition: 'waste',
      dispositions: [{ production_order_id: 100, disposition: 'release' }],
    });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 3, 'cancelled', tx, { decrementOnHand: false });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 51, null, 2, 'consumed', tx, { decrementOnHand: false });
  });

  it('S1: a failed write-off is reported (not thrown), keeps the other orders going and emits no waste event for it', async () => {
    setup([completedA, completedB]);
    client.$transaction.mockImplementation(async (cb: any) => {
      if (client.$transaction.mock.calls.length === 2) throw new Error('boom');
      return cb(tx);
    });
    const outcome = await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(outcome.unadjusted).toEqual([
      { production_order_id: 101, order_number: 'OP-2', product_id: 51, product_variant_id: null, reserved_qty: 2 },
    ]);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('production.sale_waste', expect.objectContaining({ production_order_id: 100 }));
  });

  it('S1: when every adjustment works the outcome reports nothing unadjusted', async () => {
    setup([completedA, completedB]);
    const outcome = await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(outcome.unadjusted).toEqual([]);
  });

  it('S1: a failed RELEASE is not reported as unadjusted (the general release returns it to sellable anyway)', async () => {
    setup([completedA]);
    client.$transaction.mockRejectedValue(new Error('boom'));
    const outcome = await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'release' });
    expect(outcome.unadjusted).toEqual([]);
  });

  it('S1: a failure BEFORE the loop keeps every waste order unadjusted (its goods stay reserved), a release order is not held', async () => {
    setup([completedA, completedB]);
    client.order_items.findMany.mockRejectedValue(new Error('db down'));
    const outcome = await service.onSaleCancelled({
      order_id: 77,
      store_id: 1,
      dispositions: [
        { production_order_id: 100, disposition: 'release' },
        { production_order_id: 101, disposition: 'waste' },
      ],
    });
    expect(outcome.unadjusted).toEqual([
      { production_order_id: 101, order_number: 'OP-2', product_id: 51, product_variant_id: null, reserved_qty: 2 },
    ]);
    expect(slm.updateStock).not.toHaveBeenCalled();
  });

  it('S1: a waste order whose goods already left with the delivery is settled (nothing to hold)', async () => {
    setup([completedB], [{ product_id: 51, inventory_committed: true, notes: null, order_item_options: [] }]);
    const outcome = await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(outcome.unadjusted).toEqual([]);
    expect(slm.releaseReservationQuantity).not.toHaveBeenCalled();
  });

  it('onSaleCancelled never throws (the cancellation already committed)', async () => {
    setup([completed]);
    client.production_orders.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.onSaleCancelled({ order_id: 77, store_id: 1 })).resolves.toEqual({ unadjusted: [] });
  });
  it('QUI-995 F5: a released order is cancelled with the sale like draft and in_progress', async () => {
    setup([{ id: 3, product_id: 50, status: 'released', planned_qty: 1, produced_qty: null }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(client.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [3] }, status: { in: ['draft', 'in_progress', 'released'] } },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(slm.releaseReservationQuantity).not.toHaveBeenCalled();
  });

  it('QUI-995 F5: partially_completed applies the disposition to what was produced and cancels the rest', async () => {
    setup([{ id: 4, product_id: 50, status: 'partially_completed', planned_qty: 5, produced_qty: 2 }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'release' });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, null, 2, 'cancelled', tx, { decrementOnHand: false });
    expect(client.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [4] }, status: 'partially_completed' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
  });

  it('QUI-995 F5: partially_completed with nothing produced releases nothing', async () => {
    setup([{ id: 4, product_id: 50, status: 'partially_completed', planned_qty: 5, produced_qty: null }]);
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(slm.releaseReservationQuantity).not.toHaveBeenCalled();
    expect(client.production_orders.updateMany).toHaveBeenCalled();
  });

  it('QUI-995 F4: a variant order releases and writes off ITS variant', async () => {
    setup(
      [{ ...completed, product_variant_id: 10, product: { name: 'Torta' } }],
      [{ product_id: 50, product_variant_id: 10, notes: null, inventory_committed: false, order_item_options: [] }],
    );
    await service.handleSaleCancelled({ order_id: 77, store_id: 1, disposition: 'waste' });
    expect(slm.releaseReservationQuantity).toHaveBeenCalledWith('order', 77, 50, 10, 3, 'consumed', tx, { decrementOnHand: false });
    expect(slm.getDefaultLocationForProduct).toHaveBeenCalledWith(50, 10, tx);
    expect(slm.updateStock).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 50, variant_id: 10, quantity_change: -3, movement_type: 'damage' }),
      tx,
    );
  });
});

describe('ProductionSaleLinkService — live-sync events (QUI-1002)', () => {
  const start = new Date('2026-11-10T15:00:00Z');
  let tx: any;
  let client: any;
  let emitter: { emit: jest.Mock };
  let service: ProductionSaleLinkService;
  const stored = (over: Record<string, unknown>) => ({
    id: 100,
    store_id: 1,
    order_id: 77,
    status: 'draft',
    started_at: null,
    produced_at: null,
    estimated_minutes: null,
    ...over,
  });

  const setup = (items: any[], existing: any[], afterCommit: any[]) => {
    tx = {
      production_orders: {
        findMany: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({ id: 100 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      production_order_lines: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    client = {
      orders: {
        findFirst: jest.fn().mockResolvedValue({
          id: 77,
          store_id: 1,
          state: 'processing',
          created_at: new Date('2026-11-09T10:00:00Z'),
          fulfillment_schedule: { scheduled_start: start },
          order_items: items,
        }),
      },
      recipes: { findMany: jest.fn().mockResolvedValue([{ id: 7, product_id: 50, product_variant_id: null }]) },
      production_orders: {
        findMany: jest.fn().mockResolvedValue(afterCommit),
        findFirst: jest.fn().mockResolvedValue(existing.length > 0 ? { id: existing[0].id } : null),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    emitter = { emit: jest.fn() };
    service = new ProductionSaleLinkService(
      { withoutScope: () => client } as any,
      { next: jest.fn().mockResolvedValue('OP-000001') } as any,
      undefined,
      emitter as any,
    );
  };
  const events = () => emitter.emit.mock.calls.filter((c) => c[0] === 'production_order.updated').map((c) => c[1]);

  it('a created order is emitted after the transaction commits, from the committed row', async () => {
    setup([{ id: 1, product_id: 50, quantity: 2 }], [], [stored({ id: 100 })]);
    await service.ensureForOrder(77);
    expect(client.production_orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [100] } } }),
    );
    expect(events()).toEqual([
      {
        type: 'production_order.updated',
        store_id: 1,
        id: 100,
        order_id: 77,
        status: 'draft',
        started_at: null,
        produced_at: null,
        estimated_minutes: null,
      },
    ]);
  });

  it('draft update, cancelled refresh and draft cancellation are each emitted', async () => {
    const draft = { id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start };
    setup([{ id: 1, product_id: 50, quantity: 8 }], [draft], [stored({ id: 100 })]);
    await service.ensureForOrder(77);
    expect(events().map((e) => e.id)).toEqual([100]);

    setup([{ id: 1, product_id: 50, quantity: 1 }], [{ ...draft, status: 'cancelled' }], [stored({ id: 100 })]);
    await service.ensureForOrder(77);
    expect(events().map((e) => e.id)).toEqual([100]);

    setup([], [draft], [stored({ id: 100, status: 'cancelled' })]);
    await service.ensureForOrder(77);
    expect(events()).toEqual([expect.objectContaining({ id: 100, status: 'cancelled' })]);
  });

  it('an idempotent run changes nothing and emits nothing', async () => {
    setup(
      [{ id: 1, product_id: 50, quantity: 5 }],
      [{ id: 100, product_id: 50, status: 'draft', planned_qty: new Prisma.Decimal(5), due_date: start }],
      [],
    );
    await service.ensureForOrder(77);
    expect(events()).toEqual([]);
    expect(client.production_orders.findMany).not.toHaveBeenCalled();
  });

  it('an emission or reload failure never breaks the sync', async () => {
    setup([{ id: 1, product_id: 50, quantity: 2 }], [], []);
    client.production_orders.findMany.mockRejectedValue(new Error('reload failed'));
    await expect(service.ensureForOrder(77)).resolves.toEqual([{ id: 100 }]);
  });

  it('a cancelled sale emits every order it cancelled', async () => {
    setup([], [], []);
    client.production_orders.findMany
      .mockResolvedValueOnce([
        { id: 1, product_id: 50, status: 'draft', planned_qty: 1, produced_qty: null, product: { name: 'A' } },
        { id: 2, product_id: 51, status: 'in_progress', planned_qty: 1, produced_qty: null, product: { name: 'B' } },
      ])
      .mockResolvedValueOnce([stored({ id: 1, status: 'cancelled' }), stored({ id: 2, status: 'cancelled' })]);
    client.production_orders.updateMany = jest.fn().mockResolvedValue({ count: 2 });
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(events().map((e) => [e.id, e.status])).toEqual([
      [1, 'cancelled'],
      [2, 'cancelled'],
    ]);
  });

  it('a cancelled sale emits its partially completed order once it is cancelled', async () => {
    setup([], [], []);
    client.production_orders.findMany
      .mockResolvedValueOnce([
        { id: 4, product_id: 50, status: 'partially_completed', planned_qty: 5, produced_qty: 2, product: { name: 'A' } },
      ])
      .mockResolvedValueOnce([stored({ id: 4, status: 'cancelled' })]);
    client.production_orders.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await service.handleSaleCancelled({ order_id: 77, store_id: 1 });
    expect(client.production_orders.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [4] }, status: 'partially_completed' },
      data: { status: 'cancelled', updated_at: expect.any(Date) },
    });
    expect(events().map((e) => [e.id, e.status])).toEqual([[4, 'cancelled']]);
  });
});
