import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { OrderItemChangesService } from './order-item-changes.service';

const ORDER_ID = 100;
const VERSION = '2026-10-25T10:00:00.000Z';

const mkLine = (id: number, over: Record<string, any> = {}) => ({
  id,
  order_id: ORDER_ID,
  product_id: 10 + id,
  product_variant_id: null,
  product_name: `Producto ${id}`,
  variant_sku: null,
  quantity: 2,
  total_price: 20,
  discount_amount: null,
  weight: null,
  stock_units_consumed: null,
  inventory_consumed_at_fire: false,
  delivered_at: null,
  cancelled_at: null,
  notes: 'sin sal',
  skip_kds: true,
  cost_price: 3,
  products: { id: 10 + id, name: `Producto ${id}`, product_type: 'physical', track_inventory: false },
  product_variants: null,
  order_item_taxes: [{ id: id * 100, tax_amount: 2 }],
  kitchen_ticket_items: [],
  ...over,
});

const build = (lines: any[], orderOver: Record<string, any> = {}) => {
  const order = {
    id: ORDER_ID,
    store_id: 4,
    state: 'created',
    order_number: 'ORD-1',
    updated_at: new Date(VERSION),
    subtotal_amount: lines.reduce((s, l) => s + Number(l.total_price), 0),
    discount_amount: 0,
    tax_amount: lines.length * 2,
    tip_amount: 5,
    tip_type: 'fixed',
    tip_value: 5,
    shipping_cost: 0,
    grand_total: 100,
    coupon_code: null,
    active_financial_split_id: null,
    stores: { id: 4, organization_id: 1, industries: ['restaurant'] },
    payments: [],
    table_sessions: [],
    order_promotions: [],
    ...orderOver,
  };
  const db: any = {
    orders: { findFirst: jest.fn().mockResolvedValue(order), update: jest.fn() },
    order_items: {
      findMany: jest.fn().mockResolvedValue(lines),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 900 }),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    order_item_taxes: { update: jest.fn().mockResolvedValue({}), deleteMany: jest.fn() },
    products: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => ({
        id: where.id, name: 'P', product_type: 'prepared', product_variants: [],
      })),
    },
    product_variants: { findMany: jest.fn().mockResolvedValue([]) },
    product_tax_assignments: { findMany: jest.fn().mockResolvedValue([]) },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));

  const callOrder: string[] = [];
  const orderFlow = {
    getOrderItemCancelBlock: jest.fn().mockReturnValue(null),
    assertOrderItemsCancellableInTx: jest.fn().mockResolvedValue(undefined),
    classifyOrderItemCancellation: jest.fn().mockResolvedValue({
      blocked: null,
      requiresCancellationType: false,
      wasFired: false,
      preparedFired: false,
      resolvedType: 'before_fire',
    }),
    cancelOrderItemInTx: jest.fn().mockImplementation(async (_tx: any, p: any) => {
      callOrder.push('cancel');
      return { orderItemId: p.orderItemId, alreadyCancelled: false };
    }),
    runOrderItemCancelEffectsAfterCommit: jest.fn().mockImplementation(async () => {
      callOrder.push('effects');
    }),
    getOrder: jest.fn().mockResolvedValue(order),
    recalcOrderTotalsFromActiveLinesInTx: jest.fn().mockResolvedValue(undefined),
  };
  const ordersService = {
    assertTableOrderEditable: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({ id: ORDER_ID }),
  };
  const kitchen = {
    prepareFireContext: jest.fn().mockResolvedValue({ firedItemIds: [900] }),
    fireOrderItemsInTx: jest.fn().mockResolvedValue({ ticketId: 1, ticketIds: [1], firedItemSnapshots: [], cogsTotal: 0, consumedLineCount: 0 }),
    emitKitchenFiredAfterCommit: jest.fn().mockResolvedValue(undefined),
  };
  const stockLevel = {
    releaseReservationQuantity: jest.fn().mockResolvedValue(0),
    reserveStock: jest.fn(),
    getDefaultLocationForProduct: jest.fn(),
  };
  const validator = {
    resolveEffectiveTracking: jest.fn((p: any, v?: any) => v?.track_inventory_override ?? p.track_inventory),
    resolveInventoryPolicy: jest.fn().mockResolvedValue({ allowOversell: false }),
    findInsufficientLines: jest.fn().mockResolvedValue([]),
    assertLinesAvailable: jest.fn().mockResolvedValue([]),
  };
  const allocator = {
    allocateForLine: jest.fn().mockResolvedValue({ slices: [{ location_id: 1, quantity: 1 }], shortfall: 0, available: 99 }),
    absorbShortfall: jest.fn(),
  };
  const sse = { pushOrderEvent: jest.fn() };
  const audit = { logCustom: jest.fn().mockResolvedValue(undefined) };

  const service = new OrderItemChangesService(
    db, orderFlow as any, ordersService as any, kitchen as any,
    stockLevel as any, validator as any, allocator as any, sse as any, audit as any,
  );
  return { service, db, orderFlow, kitchen, stockLevel, sse, validator, callOrder, order };
};

describe('OrderItemChangesService (QUI-650)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 4, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a/b) update toca solo la línea editada y solo sus campos permitidos', async () => {
    const lines = [mkLine(1), mkLine(2), mkLine(3)];
    const { service, db, orderFlow } = build(lines);
    await service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }], expected_version: VERSION });

    expect(db.order_items.update).toHaveBeenCalledTimes(1);
    const arg = db.order_items.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 1 });
    const allowed = ['quantity', 'total_price', 'tax_amount_item', 'discount_amount', 'stock_units_consumed', 'updated_at'];
    expect(Object.keys(arg.data).every((k) => allowed.includes(k))).toBe(true);
    expect(arg.data.quantity).toBe(3);
    expect(Number(arg.data.total_price)).toBe(30);
    for (const forbidden of ['skip_kds', 'cost_price', 'notes', 'tip_amount', 'product_name', 'unit_price']) {
      expect(arg.data).not.toHaveProperty(forbidden);
    }
    // impuesto de la línea escalado, y solo el suyo
    expect(db.order_item_taxes.update).toHaveBeenCalledTimes(1);
    expect(db.order_item_taxes.update.mock.calls[0][0].where).toEqual({ id: 100 });
    expect(Number(db.order_item_taxes.update.mock.calls[0][0].data.tax_amount)).toBe(3);
    expect(db.order_items.create).not.toHaveBeenCalled();
    expect(db.order_items.delete).not.toHaveBeenCalled();
    expect(db.order_items.deleteMany).not.toHaveBeenCalled();
    expect(db.orders.update).not.toHaveBeenCalled(); // propina fija: la cabecera la toca solo el recalc
    expect(orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledTimes(1);
  });

  it('c) remove de una línea en cocina: skipTotalsRecalc + efectos post-commit; preview con comanda', async () => {
    const fired = mkLine(1, {
      inventory_consumed_at_fire: true,
      products: { id: 11, name: 'Pizza', product_type: 'prepared', track_inventory: false },
      kitchen_ticket_items: [{ id: 5, status: 'pending', kitchen_ticket_id: 7, kitchen_ticket: { id: 7, status: 'pending', daily_number: 12 } }],
    });
    const ctx = build([fired, mkLine(2)]);
    ctx.orderFlow.classifyOrderItemCancellation.mockResolvedValue({
      blocked: null, requiresCancellationType: false, wasFired: true, preparedFired: true, resolvedType: 'after_fire_reused',
    });
    const preview = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    const line = preview.lines[0];
    expect(line.kitchen_effect).toBe('cancel_ticket_item');
    expect(line.messages.join(' ')).toContain('comanda #12');
    expect(line.stock_effect).toBe('ingredients_reused');
    expect(preview.can_apply).toBe(true);

    await ctx.service.apply(ORDER_ID, { remove: [{ order_item_id: 1 }], reason: 'cliente se arrepintió', expected_version: VERSION });
    expect(ctx.orderFlow.cancelOrderItemInTx).toHaveBeenCalledWith(
      ctx.db,
      expect.objectContaining({ orderItemId: 1, reason: 'cliente se arrepintió', skipTotalsRecalc: true }),
    );
    expect(ctx.orderFlow.runOrderItemCancelEffectsAfterCommit).toHaveBeenCalledTimes(1);
    expect(ctx.callOrder).toEqual(['cancel', 'effects']);
    expect(ctx.db.order_items.deleteMany).not.toHaveBeenCalled();
  });

  it('d) reducir una línea disparada: blocked en preview y lanza en apply sin escribir', async () => {
    const fired = mkLine(1, { inventory_consumed_at_fire: true });
    const ctx = build([fired]);
    const preview = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 1 }] });
    expect(preview.lines[0].blocked).toBe(true);
    expect(preview.lines[0].blocked_reason).toContain('Ya está en cocina: no se puede reducir');
    expect(preview.can_apply).toBe(false);

    await expect(
      ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 1 }], expected_version: VERSION }),
    ).rejects.toBeInstanceOf(VendixHttpException);
    expect(ctx.db.order_items.update).not.toHaveBeenCalled();
    expect(ctx.sse.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('e) versión distinta -> ORD_EDIT_INVALID_STATE_001 sin escrituras', async () => {
    const ctx = build([mkLine(1)]);
    await expect(
      ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 5 }], expected_version: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_EDIT_INVALID_STATE_001.code });
    expect(ctx.db.order_items.update).not.toHaveBeenCalled();
    expect(ctx.db.order_items.create).not.toHaveBeenCalled();
    expect(ctx.orderFlow.cancelOrderItemInTx).not.toHaveBeenCalled();
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).not.toHaveBeenCalled();
  });

  it('f) add de un producto prepared en restaurante dispara a cocina dentro de la tx', async () => {
    const ctx = build([mkLine(1)]);
    ctx.db.products.findMany.mockResolvedValue([
      {
        id: 50, name: 'Pizza', base_price: 10000, is_on_sale: false, sale_price: null,
        is_sellable: true, state: 'active', product_type: 'prepared', track_inventory: false,
        price_unit_quantity: null, product_variants: [],
      },
    ]);
    const preview = await ctx.service.preview(ORDER_ID, { add: [{ product_id: 50, quantity: 1 }] });
    expect(preview.lines[0].kitchen_effect).toBe('fire');
    expect(preview.lines[0].messages).toContain('Irá a cocina al guardar');

    await ctx.service.apply(ORDER_ID, { add: [{ product_id: 50, quantity: 1 }], expected_version: VERSION });
    expect(ctx.db.order_items.create).toHaveBeenCalledTimes(1);
    expect(ctx.kitchen.prepareFireContext).toHaveBeenCalledWith(ORDER_ID, [900], ctx.db);
    expect(ctx.kitchen.fireOrderItemsInTx).toHaveBeenCalledWith(ctx.db, 4, expect.anything());
    expect(ctx.kitchen.emitKitchenFiredAfterCommit).toHaveBeenCalledTimes(1);
  });

  it('g) descuento line-driven: quitar una línea con descuento lo baja en ese monto', async () => {
    const lines = [mkLine(1, { discount_amount: 10 }), mkLine(2, { discount_amount: 20 })];
    const ctx = build(lines, { discount_amount: 30 });
    const preview = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(preview.totals.before.discount).toBe(30);
    expect(preview.totals.after.discount).toBe(20);

    await ctx.service.apply(ORDER_ID, { remove: [{ order_item_id: 1 }], reason: 'motivo ok', expected_version: VERSION });
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(
      ctx.db, expect.anything(), ORDER_ID, { discountOverride: 20 },
    );
  });

  it('h) si cancelOrderItemInTx lanza, el error se propaga sin éxito falso', async () => {
    const ctx = build([mkLine(1), mkLine(2)]);
    const boom = new VendixHttpException(ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE, 'boom');
    ctx.orderFlow.cancelOrderItemInTx.mockRejectedValue(boom);
    await expect(
      ctx.service.apply(ORDER_ID, { remove: [{ order_item_id: 1 }], reason: 'motivo ok', expected_version: VERSION }),
    ).rejects.toBe(boom);
    expect(ctx.orderFlow.runOrderItemCancelEffectsAfterCommit).not.toHaveBeenCalled();
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).not.toHaveBeenCalled();
    expect(ctx.sse.pushOrderEvent).not.toHaveBeenCalled();
  });

  it('valida el change-set: vacío, ids repetidos y remove sin motivo', async () => {
    const ctx = build([mkLine(1)]);
    await expect(ctx.service.preview(ORDER_ID, {})).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
    await expect(
      ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }], remove: [{ order_item_id: 1 }] }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
    await expect(
      ctx.service.apply(ORDER_ID, { remove: [{ order_item_id: 1 }], expected_version: VERSION }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
  });
});
