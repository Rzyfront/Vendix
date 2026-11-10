import { KitchenFireService } from './kitchen-fire.service';
import { RequestContextService } from '../../../common/context/request-context.service';

jest.mock('../orders/order-flow/order-flow.service', () => ({
  OrderFlowService: class OrderFlowService {},
}));

/**
 * S20 — a waste re-cook and a post-cancel remake fire order lines that are
 * cancelled. Unlike the add-on specs, `prepareFireContext` and
 * `fireOrderItemsInTx` are NOT mocked here: the transaction mock keeps an
 * in-memory copy of the order lines and honors the `cancelled_at: null`
 * filters, so any step that re-filters cancelled rows fails for real.
 */
describe('KitchenFireService.resendOrderItems — cancelled lines (S20)', () => {
  const DISH = 50;
  const CANCELLED_AT = new Date('2026-09-23T10:00:00Z');

  type Row = {
    id: number;
    order_id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    product_variant_id: null;
    notes: null;
    inventory_consumed_at_fire: boolean;
    cancellation_type: string | null;
    cancelled_at: Date | null;
    addons_consumed_at: Date | null;
    products: Record<string, unknown>;
    product_variants: null;
    order_item_options: unknown[];
  };

  function row(id: number, over: Partial<Row> = {}): Row {
    return {
      id,
      order_id: 100,
      product_id: DISH,
      product_name: 'Torta',
      quantity: 2,
      product_variant_id: null,
      notes: null,
      inventory_consumed_at_fire: true,
      cancellation_type: 'after_fire_waste',
      cancelled_at: CANCELLED_AT,
      addons_consumed_at: new Date('2026-09-23T09:00:00Z'),
      products: {
        id: DISH,
        name: 'Torta',
        product_type: 'prepared',
        track_inventory: true,
        store_id: 1,
        kds_id: null,
        _count: { product_variants: 0 },
      },
      product_variants: null,
      order_item_options: [
        {
          scope: 'per_unit',
          component_type: 'ingredient',
          component_product_id: 700,
          component_variant_id: null,
          quantity: '80',
        },
      ],
      ...over,
    };
  }

  function harness(
    rows: Row[],
    opts: { state: string; schedule?: { produced_at: Date | null } | null },
  ) {
    const store = rows.map((r) => ({ ...r }));
    const matches = (r: Row, where: any): boolean => {
      if (where?.id !== undefined) {
        const ids: number[] = typeof where.id === 'number' ? [where.id] : where.id.in;
        if (!ids.includes(r.id)) return false;
      }
      if (where?.order_id !== undefined && r.order_id !== where.order_id) return false;
      if (where?.inventory_consumed_at_fire !== undefined &&
        r.inventory_consumed_at_fire !== where.inventory_consumed_at_fire) return false;
      if (where?.cancelled_at === null && r.cancelled_at !== null) return false;
      if (where?.addons_consumed_at === null && r.addons_consumed_at !== null) return false;
      return true;
    };
    const resets: number[][] = [];
    // Both readers (resend and prepareFireContext) pass the item filter at
    // `select.order_items.where`.
    const ordersFindFirst = jest.fn(async (args: any) => {
      const where = args?.select?.order_items?.where;
      return {
        id: 100,
        store_id: 1,
        order_number: 'ORD-100',
        table_sessions: [],
        order_items: store.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      };
    });

    const tx: any = {
      orders: { findFirst: ordersFindFirst },
      kds: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      kds_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      order_items: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = store.filter((r) => matches(r, where));
          if (data?.addons_consumed_at === null) resets.push(hit.map((r) => r.id));
          for (const r of hit) Object.assign(r, data);
          return { count: hit.length };
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order_fulfillment_schedules: { findFirst: jest.fn().mockResolvedValue(opts.schedule ?? null) },
      recipes: {
        findMany: jest.fn().mockResolvedValue([
          { id: 7, product_id: DISH, product_variant_id: null, is_active: true },
        ]),
      },
      products: { findFirst: jest.fn().mockResolvedValue({ is_batch_produced: false }) },
      kitchen_tickets: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => ({
          id: 55,
          items: data.items.create.map((c: any, i: number) => ({ id: i + 1, order_item_id: c.order_item_id })),
        })),
      },
      kitchen_ticket_items: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      kitchen_ticket_item_exclusions: { createMany: jest.fn() },
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 100 }]),
    };

    const recipesService = {
      explodeBom: jest.fn().mockResolvedValue([
        { component_product_id: 201, quantity: 100, depth: 1, path_recipe_ids: [7] },
      ]),
    };
    const stockLevelManager = {
      getDefaultLocationForProduct: jest.fn(async (pid: number) => 1000 + pid),
      updateStock: jest.fn().mockResolvedValue({ cost_snapshot: { total_cost: 10 } }),
    };
    const stockValidator = {
      resolveInventoryPolicy: jest.fn().mockResolvedValue({ allowIngredientOveruse: false }),
      assertIngredientsAvailable: jest.fn().mockResolvedValue([]),
      findInsufficientLines: jest.fn().mockResolvedValue([]),
    };
    const eventEmitter = { emit: jest.fn() };
    const service = new KitchenFireService(
      {} as any,
      recipesService as any,
      stockLevelManager as any,
      stockValidator as any,
      eventEmitter as any,
      { pushToStore: jest.fn() } as any,
      {} as any,
    );
    const prisma: any = {
      stores: { findUnique: jest.fn().mockResolvedValue({ industries: ['restaurant'] }) },
      orders: { findFirst: ordersFindFirst, findUnique: jest.fn().mockResolvedValue({ state: opts.state }) },
      kds: { findFirst: jest.fn().mockResolvedValue({ id: 5 }) },
      store_settings: { findFirst: jest.fn().mockResolvedValue(null) },
      kitchen_tickets: { findMany: jest.fn().mockResolvedValue([]) },
      kitchen_ticket_items: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: any) => Promise<unknown>) => fn(tx)),
    };
    (service as any).prisma = prisma;
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, organization_id: 2, user_id: 3 } as any);
    jest.spyOn(service as any, 'getBusinessDate').mockResolvedValue('2026-09-23');

    const moves = () =>
      stockLevelManager.updateStock.mock.calls.map(([p]: any[]) => [p.product_id, p.quantity_change, p.order_item_id]);
    const resend = (ids: number[], reason: 'remake_dish' | 'lost_command') =>
      service.resendOrderItems({ order_id: 100, order_item_ids: ids, reason });
    return { service, tx, store, resets, moves, resend, eventEmitter };
  }

  it('lost_command with a waste line: cooks again, consumes recipe and add-ons once, flag back to true', async () => {
    const h = harness([row(10)], { state: 'processing' });
    const res = await h.resend([10], 'lost_command');
    expect(res.ticketIds).toEqual([55]);
    expect(h.moves()).toEqual([
      [201, -200, 10],
      [700, -160, 10],
    ]);
    expect(h.store[0].inventory_consumed_at_fire).toBe(true);
    expect(h.resets).toEqual([[10]]);
    // The line stays cancelled: only the consumption markers are touched.
    expect(h.store[0].cancelled_at).toEqual(CANCELLED_AT);
  });

  it('lost_command keeps the add-on reset waste-only: a reused line is reprinted without consumption', async () => {
    const h = harness([row(10), row(11, { cancellation_type: 'after_fire_reused' })], { state: 'processing' });
    await h.resend([10, 11], 'lost_command');
    expect(h.resets).toEqual([[10]]);
    expect(h.moves().every(([, , id]) => id === 10)).toBe(true);
    expect(h.moves()).toHaveLength(2);
  });

  it('post-cancel remake: waste and reused lines are cooked once each, recipe and add-ons, and both reset the add-on marker', async () => {
    const h = harness(
      [row(10), row(11, { cancellation_type: 'after_fire_reused' })],
      { state: 'cancelled' },
    );
    await h.resend([10, 11], 'remake_dish');
    expect(h.resets).toEqual([[10, 11]]);
    const sorted = [...h.moves()].sort((a, b) => (a[2] as number) - (b[2] as number) || (a[0] as number) - (b[0] as number));
    expect(sorted).toEqual([
      [201, -200, 10],
      [700, -160, 10],
      [201, -200, 11],
      [700, -160, 11],
    ]);
    expect(h.store.every((r) => r.inventory_consumed_at_fire)).toBe(true);
  });

  it('post-cancel remake still consumes the add-ons when the scheduled production already started', async () => {
    const h = harness(
      [row(10, { cancellation_type: 'after_fire_reused' })],
      { state: 'cancelled', schedule: { produced_at: new Date('2026-09-23T08:00:00Z') } },
    );
    await h.resend([10], 'remake_dish');
    expect(h.moves()).toEqual([
      [201, -200, 10],
      [700, -160, 10],
    ]);
  });

  it('waste resend on a scheduled order that already produced consumes its reset add-ons too', async () => {
    const h = harness([row(10)], { state: 'processing', schedule: { produced_at: new Date() } });
    await h.resend([10], 'lost_command');
    expect(h.moves()).toContainEqual([700, -160, 10]);
  });

  it('control: lost_command without waste lines only reprints (no stock, no flag change, no add-on reset)', async () => {
    const h = harness(
      [row(10, { cancellation_type: null, cancelled_at: null })],
      { state: 'processing' },
    );
    const res = await h.resend([10], 'lost_command');
    expect(res.ticketIds).toEqual([55]);
    expect(h.moves()).toEqual([]);
    expect(h.resets).toEqual([]);
    expect(h.store[0].inventory_consumed_at_fire).toBe(true);
  });

  it('the normal fire keeps ignoring cancelled lines', async () => {
    const h = harness([row(10)], { state: 'processing' });
    await expect(h.service.prepareFireContext(100, [10], h.tx)).rejects.toMatchObject({
      errorCode: 'KITCHEN_FIRE_ITEM_NOT_FOUND',
    });
  });
});
