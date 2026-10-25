import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import { OrderItemChangesService } from './order-item-changes.service';
import { OrdersService } from '../orders.service';

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
  unit_price: 10,
  final_unit_price: 11,
  price_unit_quantity: null,
  applied_price_tier_id: null,
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
  order_item_taxes: [
    { id: id * 100, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 2, tax_type: 'iva', is_compound: false, is_inclusive: false },
  ],
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
    created_at: new Date('2026-10-20T10:00:00.000Z'),
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
    coupon_id: null,
    customer_id: 7,
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
    stock_reservations: { count: jest.fn().mockResolvedValue(0) },
    inventory_transactions: { findMany: jest.fn().mockResolvedValue([]) },
    product_categories: { findMany: jest.fn().mockResolvedValue([]) },
    coupon_uses: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    promotions: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Promo X' }, { id: 2, name: 'Promo Y' }]) },
    order_promotions: {
      deleteMany: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
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
  // Kernel REAL del editor (helpers puros del prototipo, sin dependencias).
  const realOrders: any = Object.create(OrdersService.prototype);
  const ordersService = {
    preservePersistedOrderLine: realOrders.preservePersistedOrderLine.bind(realOrders),
    applyGrossDiscountToPlannedLines: realOrders.applyGrossDiscountToPlannedLines.bind(realOrders),
    grossOfPlannedLines: realOrders.grossOfPlannedLines.bind(realOrders),
    toOrderItemTaxesCreate: realOrders.toOrderItemTaxesCreate.bind(realOrders),
    assertSaleVatAllowed: jest.fn().mockResolvedValue(undefined),
    assertTableOrderEditable: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({ id: ORDER_ID }),
  };
  const kitchen = {
    prepareFireContext: jest.fn().mockResolvedValue({ firedItemIds: [900] }),
    fireOrderItemsInTx: jest.fn().mockResolvedValue({ ticketId: 1, ticketIds: [1], firedItemSnapshots: [], cogsTotal: 0, consumedLineCount: 0 }),
    emitKitchenFiredAfterCommit: jest.fn().mockResolvedValue({ kitchen_ticket_id: 1, kitchen_ticket_ids: [1] }),
    previewIngredientShortfall: jest.fn().mockResolvedValue({ allowIngredientOveruse: true, shortages: [] }),
  };
  const promotionEngine = { quoteDiscounts: jest.fn().mockResolvedValue({ total_discount: 0, order_promotions_snapshot: [] }) };
  const coupons = { validate: jest.fn().mockResolvedValue({ coupon_id: 1, discount_amount: 10 }) };
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
    promotionEngine as any, coupons as any,
  );
  return { service, db, orderFlow, kitchen, stockLevel, sse, validator, callOrder, order, promotionEngine, coupons, allocator, ordersService };
};

// apply exige la version del preview (`updated_at|huella`): se obtiene del propio preview.
const applyV = async (ctx: any, dto: any) =>
  ctx.service.apply(ORDER_ID, {
    ...dto,
    expected_version: (await ctx.service.preview(ORDER_ID, dto)).version,
  });

describe('OrderItemChangesService (QUI-650)', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 4, user_id: 9 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a/b) update toca solo la línea editada y solo sus campos permitidos', async () => {
    const lines = [mkLine(1), mkLine(2), mkLine(3)];
    const { service, db, orderFlow } = build(lines);
    await applyV({ service }, { update: [{ order_item_id: 1, quantity: 3 }] });

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

    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'cliente se arrepintió'});
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
      applyV(ctx, { update: [{ order_item_id: 1, quantity: 1 }]}),
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

    await applyV(ctx, { add: [{ product_id: 50, quantity: 1 }]});
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

    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'});
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(
      ctx.db, expect.anything(), ORDER_ID, { discountOverride: 20 },
    );
  });

  it('h) si cancelOrderItemInTx lanza, el error se propaga sin éxito falso', async () => {
    const ctx = build([mkLine(1), mkLine(2)]);
    const boom = new VendixHttpException(ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE, 'boom');
    ctx.orderFlow.cancelOrderItemInTx.mockRejectedValue(boom);
    await expect(
      applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'}),
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
      applyV(ctx, { remove: [{ order_item_id: 1 }]}),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
  });

  const mkTracked = (id: number, over: Record<string, any> = {}) =>
    mkLine(id, {
      product_id: 11,
      products: { id: 11, name: 'Camisa', product_type: 'physical', track_inventory: true },
      ...over,
    });
  const sellable = (over: Record<string, any> = {}) => ({
    id: 11, name: 'Camisa', base_price: 10, is_on_sale: false, sale_price: null,
    is_sellable: true, state: 'active', product_type: 'physical', track_inventory: true,
    price_unit_quantity: null, product_variants: [], ...over,
  });

  it('a) cupón fijo $10 en qty 1 -> 3: el descuento se conserva y los impuestos siguen la convención del kernel', async () => {
    const line = mkLine(1, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 10,
      order_item_taxes: [{ id: 100, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 9, tax_type: 'iva', is_compound: false, is_inclusive: false }],
    });
    const ctx = build([line], { discount_amount: 10 });
    await applyV(ctx, { update: [{ order_item_id: 1, quantity: 3 }]});
    const data = ctx.db.order_items.update.mock.calls[0][0].data;
    expect(Number(data.total_price)).toBe(300);
    expect(Number(data.discount_amount)).toBe(10);
    // (300 - 10) × 0.10
    expect(Number(ctx.db.order_item_taxes.update.mock.calls[0][0].data.tax_amount)).toBe(29);
    // el descuento total no cambió: la cabecera no se toca
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(
      ctx.db, expect.anything(), ORDER_ID, undefined,
    );
  });

  it('b) ida y vuelta 3 -> 1 -> 3 no deriva por redondeo', async () => {
    const line = mkLine(1, {
      quantity: 3, unit_price: 33.33, total_price: 99.99, discount_amount: null,
      order_item_taxes: [],
    });
    const down = build([line]);
    await applyV(down, { update: [{ order_item_id: 1, quantity: 1 }]});
    const d1 = down.db.order_items.update.mock.calls[0][0].data;
    expect(Number(d1.total_price)).toBe(33.33);
    const up = build([{ ...line, quantity: 1, total_price: Number(d1.total_price) }]);
    await applyV(up, { update: [{ order_item_id: 1, quantity: 3 }]});
    expect(Number(up.db.order_items.update.mock.calls[0][0].data.total_price)).toBe(99.99);
  });

  it('c) con cupón, quitar una línea re-cotiza y redistribuye: las otras pasan a reprice (solo discount_amount/taxes)', async () => {
    const mk = (id: number) => mkLine(id, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5,
      order_item_taxes: [{ id: id * 100, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 9.5, tax_type: 'iva', is_compound: false, is_inclusive: false }],
    });
    const ctx = build([mk(1), mk(2)], { discount_amount: 10, coupon_code: 'FIJO10', coupon_id: 1 });
    const preview = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(preview.can_apply).toBe(true);
    const reprice = preview.lines.find((l) => l.action === 'reprice')!;
    expect(reprice.order_item_id).toBe(2);
    expect(reprice.quantity_before).toBe(reprice.quantity_after);
    expect(reprice.messages.join(' ')).toContain('Descuento $5');
    expect(preview.warnings.join(' ')).toContain('El descuento de la promoción/cupón se recalcula: $10 →');
    expect(preview.warnings.join(' ')).not.toContain('no se recalculan automáticamente');

    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'});
    const upd = ctx.db.order_items.update.mock.calls.find((c: any) => c[0].where.id === 2)!;
    expect(Object.keys(upd[0].data).sort()).toEqual(['discount_amount', 'updated_at']);
    expect(Number(upd[0].data.discount_amount)).toBeCloseTo(9.09, 2);
    expect(ctx.db.order_item_taxes.update).toHaveBeenCalledTimes(1);
    expect(ctx.db.orders.update).not.toHaveBeenCalled(); // el cupón sigue válido
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(
      ctx.db, expect.anything(), ORDER_ID, { discountOverride: expect.closeTo(9.09, 2) },
    );
  });

  it('c2) si D\' ≈ Σ descuentos de línea no se redistribuye y las líneas no tocadas quedan intactas', async () => {
    const mk = (id: number) => mkLine(id, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5, order_item_taxes: [],
    });
    const ctx = build([mk(1), mk(2)], { discount_amount: 10, coupon_code: 'X', coupon_id: 1 });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 10 });
    ctx.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    const p2 = await ctx.service.preview(ORDER_ID, { add: [{ product_id: 11, quantity: 1 }] });
    // el cupón ahora cubre 3 líneas (110 de bruto): 10 fijo siguen siendo 10 -> mismo Σ
    expect(p2.lines.some((l) => l.action === 'reprice')).toBe(false);
    expect(p2.warnings.join(' ')).not.toContain('se recalcula');
    await applyV(ctx, { add: [{ product_id: 11, quantity: 1 }]});
    expect(ctx.db.order_items.update).not.toHaveBeenCalled();
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(ctx.db, expect.anything(), ORDER_ID, undefined);
  });

  it('d) un cupón que deja de ser válido bloquea el plan (no se descarta solo)', async () => {
    const mk = (id: number) => mkLine(id, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5, order_item_taxes: [],
    });
    const ctx = build([mk(1), mk(2)], { discount_amount: 10, coupon_code: 'VENCE', coupon_id: 1 });
    ctx.coupons.validate.mockRejectedValue(new VendixHttpException(ErrorCodes.CPN_EXPIRED_001));
    const preview = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(preview.can_apply).toBe(false);
    // la re-cotización excluye los usos de ESTA orden (promociones con límite por cliente)
    expect(ctx.promotionEngine.quoteDiscounts).toHaveBeenCalledWith(expect.objectContaining({ exclude_order_id: ORDER_ID }));
    expect(preview.warnings.join(' ')).toContain('Con este cambio el cupón VENCE deja de aplicar (');
    expect(preview.warnings.join(' ')).toContain('Ajusta los productos para mantenerlo.');
    // se revalida excluyendo los usos de ESTA orden
    expect(ctx.coupons.validate).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENCE' }), expect.objectContaining({ excludeOrderId: ORDER_ID }));
    await expect(
      applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_EDIT_PROMOTION_INVALID_001.code });
    expect(ctx.db.orders.update).not.toHaveBeenCalled();
    expect(ctx.db.order_items.update).not.toHaveBeenCalled();
  });

  it('d2) si falla la re-cotización por error técnico: can_apply=false', async () => {
    const ctx = build([mkLine(1, { discount_amount: 2 }), mkLine(2)], { coupon_code: 'X', coupon_id: 1, discount_amount: 2 });
    ctx.promotionEngine.quoteDiscounts.mockRejectedValue(new Error('db down'));
    const preview = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 2 }] });
    expect(preview.can_apply).toBe(false);
    expect(preview.warnings).toContain('No se pudo recalcular la promoción; intenta de nuevo');
    await expect(
      applyV(ctx, { remove: [{ order_item_id: 2 }], reason: 'motivo ok'}),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('e) sin cupón ni promoción, agregar un producto no envía discountOverride', async () => {
    const ctx = build([mkLine(1, { discount_amount: 10 })], { discount_amount: 10.004 });
    ctx.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    await applyV(ctx, { add: [{ product_id: 11, quantity: 1 }]});
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(
      ctx.db, expect.anything(), ORDER_ID, undefined,
    );
  });

  it('f) apply devuelve kitchen.kitchen_ticket_ids cuando hubo fire (y stock_warnings vacío)', async () => {
    const ctx = build([mkLine(1)]);
    ctx.db.products.findMany.mockResolvedValue([
      sellable({ id: 50, name: 'Pizza', base_price: 10000, product_type: 'prepared', track_inventory: false }),
    ]);
    const res = await applyV(ctx, { add: [{ product_id: 50, quantity: 1 }]});
    expect(res.kitchen).toEqual({ kitchen_ticket_ids: [1], stock_warnings: [] });
    const none = build([mkLine(1)]);
    const r2 = await applyV(none, { update: [{ order_item_id: 1, quantity: 3 }]});
    expect(r2.kitchen).toEqual({ kitchen_ticket_ids: [], stock_warnings: [] });
  });

  it('f2) la sobreventa absorbida al reservar viaja en kitchen.stock_warnings', async () => {
    const ctx = build([mkTracked(1, { quantity: 1 })]);
    ctx.validator.resolveInventoryPolicy.mockResolvedValue({ allowOversell: true });
    ctx.allocator.allocateForLine.mockResolvedValue({ slices: [], shortfall: 2, available: 1 });
    (ctx.allocator as any).absorbShortfall.mockReturnValue([{ location_id: 1, quantity: 3 }]);
    ctx.stockLevel.getDefaultLocationForProduct.mockResolvedValue(1);
    const res = await applyV(ctx, { update: [{ order_item_id: 1, quantity: 4 }]});
    expect(res.kitchen.stock_warnings).toEqual([
      expect.objectContaining({ product_id: 11, kind: 'product', requested: 3, available: 1 }),
    ]);
  });

  it('g) liberación neta: bajar X y agregar X del mismo producto sin stock libre no bloquea', async () => {
    const ctx = build([mkTracked(1, { quantity: 5 })]);
    ctx.db.products.findMany.mockResolvedValue([sellable()]);
    ctx.validator.findInsufficientLines.mockImplementation(async (lines: any[]) =>
      lines.some((l) => l.quantity > 0)
        ? [{ product_id: 11, product_variant_id: null, product_name: 'Camisa', kind: 'product', requested: 3, available: 0 }]
        : [],
    );
    const preview = await ctx.service.preview(ORDER_ID, {
      update: [{ order_item_id: 1, quantity: 2 }],
      add: [{ product_id: 11, quantity: 3 }],
    });
    expect(preview.can_apply).toBe(true);
    expect(ctx.validator.findInsufficientLines).not.toHaveBeenCalled();
    // y si agrega más de lo liberado, la demanda neta bloquea
    const more = await ctx.service.preview(ORDER_ID, {
      update: [{ order_item_id: 1, quantity: 2 }],
      add: [{ product_id: 11, quantity: 5 }],
    });
    expect(more.can_apply).toBe(false);
    expect(ctx.validator.findInsufficientLines.mock.calls[0][0][0].quantity).toBe(2);
  });

  it('h) un draft sin mesa con reserva activa libera al bajar cantidad', async () => {
    const ctx = build([mkTracked(1, { quantity: 4 })], { state: 'draft' });
    ctx.db.stock_reservations.count.mockResolvedValue(1);
    const preview = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(preview.lines[0].stock_effect).toBe('release');
    await applyV(ctx, { update: [{ order_item_id: 1, quantity: 2 }]});
    expect(ctx.stockLevel.releaseReservationQuantity).toHaveBeenCalledWith('order', ORDER_ID, 11, undefined, 2, 'cancelled', ctx.db);
    // sin reserva ni mesa ni estado created: no libera
    const none = build([mkTracked(1, { quantity: 4 })], { state: 'draft' });
    const p2 = await none.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(p2.lines[0].stock_effect).toBe('none');
  });

  it('L5) insumos faltantes de un plato nuevo: bloquea con OFF y avisa con ON', async () => {
    const ctx = build([mkLine(1)]);
    ctx.db.products.findMany.mockResolvedValue([
      sellable({ id: 50, name: 'Pizza', base_price: 10000, product_type: 'prepared', track_inventory: false }),
    ]);
    const shortage = { product_id: 900, product_variant_id: null, product_name: 'Queso', kind: 'ingredient', requested: 200, available: 50, used_by: ['Pizza'] };
    ctx.kitchen.previewIngredientShortfall.mockResolvedValue({ allowIngredientOveruse: false, shortages: [shortage] });
    const off = await ctx.service.preview(ORDER_ID, { add: [{ product_id: 50, quantity: 2 }] });
    expect(off.can_apply).toBe(false);
    expect(off.lines[0].blocked_reason).toContain('Faltan insumos para Pizza: Queso');
    ctx.kitchen.previewIngredientShortfall.mockResolvedValue({ allowIngredientOveruse: true, shortages: [shortage] });
    const on = await ctx.service.preview(ORDER_ID, { add: [{ product_id: 50, quantity: 2 }] });
    expect(on.can_apply).toBe(true);
    expect(on.warnings.join(' ')).toContain('Faltan insumos para Pizza');
  });

  it('P1) al redistribuir, order_promotions se reconcilia con la re-cotización (update/delete/create)', async () => {
    const mk = (id: number) => mkLine(id, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5, order_item_taxes: [],
    });
    const ctx = build([mk(1), mk(2)], {
      discount_amount: 10, coupon_code: null, coupon_id: null,
      order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 3 }, { id: 72, promotion_id: 2, discount_amount: 1 }],
    });
    ctx.promotionEngine.quoteDiscounts.mockResolvedValue({
      total_discount: 4,
      order_promotions_snapshot: [
        { promotion_id: 1, discount_amount: 3 },
        { promotion_id: 3, discount_amount: 1 },
      ],
    });
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'});
    expect(ctx.promotionEngine.quoteDiscounts).toHaveBeenCalledWith(
      expect.objectContaining({ manual_promotion_ids: [1, 2] }),
    );
    // la que dejó de aplicar NO se borra: queda en 0
    expect(ctx.db.order_promotions.deleteMany).not.toHaveBeenCalled();
    expect(ctx.db.order_promotions.updateMany).toHaveBeenCalledTimes(2);
    const zero = ctx.db.order_promotions.updateMany.mock.calls.find((c: any) => c[0].where.promotion_id === 2)!;
    expect(Number(zero[0].data.discount_amount)).toBe(0);
    const kept1 = ctx.db.order_promotions.updateMany.mock.calls.find((c: any) => c[0].where.promotion_id === 1)!;
    expect(Number(kept1[0].data.discount_amount)).toBe(3);
    const created = ctx.db.order_promotions.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ order_id: ORDER_ID, promotion_id: 3 });
  });

  it('P2) sin cupón ni promociones no se toca order_promotions', async () => {
    const ctx = build([mkLine(1, { discount_amount: 2 }), mkLine(2)], { discount_amount: 2 });
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'});
    expect(ctx.promotionEngine.quoteDiscounts).not.toHaveBeenCalled();
    expect(ctx.db.order_promotions.deleteMany).not.toHaveBeenCalled();
    expect(ctx.db.order_promotions.updateMany).not.toHaveBeenCalled();
    expect(ctx.db.order_promotions.createMany).not.toHaveBeenCalled();
  });

  it('T1) tax_amount_item se re-tasa en la línea con cantidad cambiada y en las reprice', async () => {
    const mk = (id: number, qty: number, over: Record<string, any> = {}) => mkLine(id, {
      quantity: qty, unit_price: 100, total_price: 100 * qty, discount_amount: 5, tax_amount_item: 9.5,
      order_item_taxes: [{ id: id * 100, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 9.5 * qty, tax_type: 'iva', is_compound: false, is_inclusive: false }],
      ...over,
    });
    // cantidad cambiada: (300 - 5) × 0.1 = 29.5 sobre 3 unidades -> 9.83 por unidad
    const q = build([mk(1, 1)], { discount_amount: 5 });
    await applyV(q, { update: [{ order_item_id: 1, quantity: 3 }]});
    const d = q.db.order_items.update.mock.calls[0][0].data;
    expect(Number(d.tax_amount_item)).toBe(9.83);
    // reprice: la línea 2 pasa de descuento 5 a ~9.09 -> impuesto por unidad = 9.09
    const r = build([mk(1, 1), mk(2, 1)], { discount_amount: 10, coupon_code: 'FIJO10', coupon_id: 1 });
    await applyV(r, { remove: [{ order_item_id: 1 }], reason: 'motivo ok'});
    const upd = r.db.order_items.update.mock.calls.find((c: any) => c[0].where.id === 2)!;
    expect(Object.keys(upd[0].data).sort()).toEqual(['discount_amount', 'tax_amount_item', 'updated_at']);
    const taxRow = Number(r.db.order_item_taxes.update.mock.calls[0][0].data.tax_amount);
    expect(Number(upd[0].data.tax_amount_item)).toBeCloseTo(taxRow, 2);
  });

  it('1) línea custom sin order_item_taxes: su impuesto (tax_amount_item × unidades) cuenta en el preview', async () => {
    const custom = mkLine(1, {
      product_id: null, products: null, quantity: 2, unit_price: 10, total_price: 20,
      tax_amount_item: 1.5, order_item_taxes: [],
    });
    const ctx = build([custom, mkLine(2)]);
    const p = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 2, quantity: 3 }] });
    // línea 2: 30 × 0.1 = 3; custom intacta: 1.5 × 2 = 3
    expect(p.totals.after.tax).toBe(6);
    // y si se cambia la cantidad de la custom, el impuesto escala con su tasa implícita (15%)
    const q = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 4 }] });
    expect(q.totals.after.tax).toBe(8); // 40 × 0.15 + 2
  });

  it('3) header-only: descuento solo en cabecera -> sin redistribuir, sin override si D\' ≈ cabecera', async () => {
    const mk = (id: number) => mkLine(id, { quantity: 1, unit_price: 100, total_price: 100, discount_amount: null });
    const ctx = build([mk(1), mk(2)], { discount_amount: 10, coupon_code: 'WEB10', coupon_id: 1 });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 10 });
    const same = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(same.lines.some((l) => l.action === 'reprice')).toBe(false);
    expect(same.totals.after.discount).toBe(10);
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(ctx.db, expect.anything(), ORDER_ID, undefined);
    expect(ctx.db.order_item_taxes.update).not.toHaveBeenCalled();

    // D' distinto: solo cambia la cabecera; las líneas y sus impuestos no se tocan
    const diff = build([mk(1), mk(2)], { discount_amount: 10, coupon_code: 'WEB10', coupon_id: 1 });
    diff.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 7 });
    const p = await diff.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.warnings.join(' ')).toContain('El descuento de la promoción/cupón se recalcula: $10 → $7');
    expect(p.totals.after.discount).toBe(7);
    expect(p.lines.some((l) => l.action === 'reprice')).toBe(false);
    await applyV(diff, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(diff.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(diff.db, expect.anything(), ORDER_ID, { discountOverride: 7 });
    expect(diff.db.order_items.update).not.toHaveBeenCalled();
    expect(diff.db.order_item_taxes.update).not.toHaveBeenCalled();
  });

  it('4) order_promotions se sincroniza si el descuento cambió aunque no haya redistribución', async () => {
    const mk = (id: number) => mkLine(id, { quantity: 1, unit_price: 100, total_price: 100, discount_amount: null });
    const ctx = build([mk(1), mk(2)], {
      discount_amount: 10, coupon_code: null, coupon_id: null,
      order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 10 }],
    });
    ctx.promotionEngine.quoteDiscounts.mockResolvedValue({
      total_discount: 6, order_promotions_snapshot: [{ promotion_id: 1, discount_amount: 6 }],
    });
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(ctx.db, expect.anything(), ORDER_ID, { discountOverride: 6 });
    expect(ctx.db.order_promotions.updateMany).toHaveBeenCalledTimes(1);
    expect(Number(ctx.db.order_promotions.updateMany.mock.calls[0][0].data.discount_amount)).toBe(6);
    // sin cambio de descuento: no se toca
    const quiet = build([mk(1), mk(2)], { discount_amount: 10, order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 10 }] });
    quiet.promotionEngine.quoteDiscounts.mockResolvedValue({
      total_discount: 10, order_promotions_snapshot: [{ promotion_id: 1, discount_amount: 10 }],
    });
    await applyV(quiet, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(quiet.db.order_promotions.updateMany).not.toHaveBeenCalled();
  });

  it('5) update sin cambio real y nada más -> 422 "No hay cambios para aplicar" en preview y apply', async () => {
    const ctx = build([mkLine(1)]);
    await expect(ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }] }))
      .rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code, message: expect.stringContaining('No hay cambios para aplicar') });
    await expect(ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }], expected_version: VERSION }))
      .rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
    // con otro cambio real el update vacío se ignora sin error
    const two = build([mkLine(1), mkLine(2)]);
    const ok = await two.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }], remove: [{ order_item_id: 2 }] });
    expect(ok.lines).toHaveLength(1);
    expect(ok.lines[0].action).toBe('remove');
  });

  it('6) la version es updated_at|huella: apply rechaza si cambian los precios entre preview y apply', async () => {
    const ctx = build([mkLine(1)]);
    const p = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }] });
    expect(p.version).toMatch(new RegExp(`^${VERSION.replace(/[.]/g, '\\.')}\\|[0-9a-f]{16}$`));
    // el precio de la línea cambió después del preview
    ctx.db.order_items.findMany.mockResolvedValue([mkLine(1, { unit_price: 12, total_price: 24 })]);
    await expect(
      ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }], expected_version: p.version }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.ORD_EDIT_INVALID_STATE_001.code,
      message: expect.stringContaining('Los precios o el estado de la orden cambiaron'),
    });
    expect(ctx.db.order_items.update).not.toHaveBeenCalled();
    // y con el mismo estado aplica
    ctx.db.order_items.findMany.mockResolvedValue([mkLine(1)]);
    await expect(
      ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }], expected_version: p.version }),
    ).resolves.toBeDefined();
  });

  it('B) compuerta F4 de IVA en líneas agregadas: blocked en preview y lanza en apply', async () => {
    const ctx = build([mkLine(1)]);
    ctx.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    ctx.ordersService.assertSaleVatAllowed.mockRejectedValue(
      new VendixHttpException(ErrorCodes.ORD_ITEM_CHANGES_INVALID_001, 'No eres responsable de IVA'),
    );
    const p = await ctx.service.preview(ORDER_ID, { add: [{ product_id: 11, quantity: 1 }] });
    expect(ctx.ordersService.assertSaleVatAllowed).toHaveBeenCalledWith([
      expect.objectContaining({ product_id: 11, tax_amount_item: expect.anything() }),
    ]);
    expect(p.can_apply).toBe(false);
    expect(p.lines[0].blocked_reason).toBe('No eres responsable de IVA');
    await expect(applyV(ctx, { add: [{ product_id: 11, quantity: 1 }] })).rejects.toMatchObject({
      errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code,
    });
    expect(ctx.db.order_items.create).not.toHaveBeenCalled();
  });

  it('C) insumos reutilizados por un remove se acreditan: intercambiar el mismo plato no se bloquea de más', async () => {
    const fired = mkLine(1, {
      inventory_consumed_at_fire: true,
      products: { id: 11, name: 'Pizza', product_type: 'prepared', track_inventory: false },
      kitchen_ticket_items: [{ id: 5, status: 'in_preparation', kitchen_ticket_id: 7, kitchen_ticket: { id: 7, status: 'in_preparation', daily_number: 3 } }],
    });
    const mkCtx = (returnedQty: number) => {
      const ctx = build([fired, mkLine(2)]);
      ctx.orderFlow.classifyOrderItemCancellation.mockResolvedValue({
        blocked: null, requiresCancellationType: false, wasFired: true, preparedFired: true, resolvedType: 'after_fire_reused',
      });
      ctx.db.products.findMany.mockResolvedValue([
        sellable({ id: 50, name: 'Pizza', base_price: 10000, product_type: 'prepared', track_inventory: false }),
      ]);
      ctx.kitchen.previewIngredientShortfall.mockResolvedValue({
        allowIngredientOveruse: false,
        shortages: [{ product_id: 900, product_variant_id: null, product_name: 'Queso', kind: 'ingredient', requested: 200, available: 50, used_by: ['Pizza'] }],
      });
      ctx.db.inventory_transactions.findMany.mockResolvedValue([
        { product_id: 900, product_variant_id: null, quantity_change: -returnedQty },
      ]);
      return ctx;
    };
    const dto = { remove: [{ order_item_id: 1, cancellation_type: 'after_fire_reused' as const }], add: [{ product_id: 50, quantity: 1 }] };
    const full = await mkCtx(200).service.preview(ORDER_ID, dto);
    expect(full.can_apply).toBe(true);
    const partial = await mkCtx(100).service.preview(ORDER_ID, dto);
    expect(partial.can_apply).toBe(false); // 50 + 100 < 200
    expect(partial.lines.find((l) => l.action === 'add')!.blocked_reason).toContain('Faltan insumos para Pizza');
  });

  it('D) la línea nueva persiste el tax_amount_item de su plan fiscal', async () => {
    const ctx = build([mkLine(1)]);
    ctx.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    await applyV(ctx, { add: [{ product_id: 11, quantity: 2 }] });
    const data = ctx.db.order_items.create.mock.calls[0][0].data;
    expect(Number(data.tax_amount_item)).toBe(0); // sin impuestos de catálogo
    expect(data).toHaveProperty('tax_amount_item');
  });

  const rowless = (id: number, over: Record<string, any> = {}) => mkLine(id, {
    product_id: null, products: null, quantity: 1, unit_price: 100, total_price: 100,
    discount_amount: 5, tax_amount_item: 9.5, tax_rate: 0.1, order_item_taxes: [], ...over,
  });

  it('R3-1) línea custom con descuento sin filas: reprice a 3.03 deja el impuesto en 9.70 (sin doble descuento)', async () => {
    const withRows = mkLine(1, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5,
      order_item_taxes: [{ id: 100, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 9.5, tax_type: 'iva', is_compound: false, is_inclusive: false }],
    });
    for (const withRate of [true, false]) {
      const ctx = build([withRows, rowless(2, withRate ? {} : { tax_rate: null })], { discount_amount: 10, coupon_code: 'FIJO', coupon_id: 1 });
      ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 3.33 });
      const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
      expect(p.totals.after.tax).toBeCloseTo(9.7, 2);
      await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
      const upd = ctx.db.order_items.update.mock.calls.find((c: any) => c[0].where.id === 2)![0].data;
      expect(Number(upd.discount_amount)).toBeCloseTo(3.03, 2);
      expect(Number(upd.tax_amount_item)).toBeCloseTo(9.7, 2);
    }
  });

  it('R3-1b) sin cupón, línea custom con descuento de qty 1 a 2: impuesto 19.50', async () => {
    const ctx = build([rowless(1)], { discount_amount: 5 });
    const p = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(p.totals.after.tax).toBe(19.5);
    await applyV(ctx, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(Number(ctx.db.order_items.update.mock.calls[0][0].data.tax_amount_item)).toBe(9.75);
  });

  it('R3-2) las categorías se resuelven por producto y viajan a la promoción y al cupón', async () => {
    const ctx = build([mkLine(1, { discount_amount: 5 }), mkLine(2, { discount_amount: 5 })], { discount_amount: 10, coupon_code: 'CAT', coupon_id: 1 });
    ctx.db.product_categories.findMany.mockResolvedValue([{ product_id: 12, category_id: 5 }]);
    await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    const quote = ctx.promotionEngine.quoteDiscounts.mock.calls[0][0];
    expect(quote.items[0]).toMatchObject({ product_id: 12, category_ids: [5] });
    const cp = ctx.coupons.validate.mock.calls[0][0];
    expect(cp.items[0]).toMatchObject({ product_id: 12, category_ids: [5] });
  });

  it('R3-3) se re-cotiza a la fecha de la orden (as_of / asOf = created_at)', async () => {
    const ctx = build([mkLine(1, { discount_amount: 5 }), mkLine(2, { discount_amount: 5 })], { discount_amount: 10, coupon_code: 'C', coupon_id: 1 });
    await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(ctx.promotionEngine.quoteDiscounts).toHaveBeenCalledWith(expect.objectContaining({ as_of: ctx.order.created_at }));
    expect(ctx.coupons.validate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ asOf: ctx.order.created_at, orderCouponId: 1, orderState: 'created' }));
  });

  it('R3-4) preview y apply coinciden al centavo en una línea custom con descuento (3.33, imp 0.63, desc 0.5, qty 1 -> 7)', async () => {
    const line = rowless(1, { unit_price: 3.33, total_price: 3.33, discount_amount: 0.5, tax_amount_item: 0.63, tax_rate: null });
    const ctx = build([line], { discount_amount: 0.5 });
    const p = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 7 }] });
    await applyV(ctx, { update: [{ order_item_id: 1, quantity: 7 }] });
    const persisted = Number(ctx.db.order_items.update.mock.calls[0][0].data.tax_amount_item);
    // lo que recalc lee: tax_amount_item redondeado × unidades
    expect(p.totals.after.tax).toBe(Math.round(persisted * 7 * 100) / 100);
  });

  it('R3-5) orden mixta: se conserva la parte manual de la cabecera', async () => {
    const mk = (id: number) => mkLine(id, { quantity: 1, unit_price: 100, total_price: 100, discount_amount: 2.5, order_item_taxes: [] });
    const ctx = build([mk(1), mk(2)], { discount_amount: 15 });
    const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.warnings).toContain('El descuento manual de la orden ($10) se mantiene');
    expect(p.totals.after.discount).toBe(12.5); // 2.5 de la línea restante + 10 manual
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(ctx.db, expect.anything(), ORDER_ID, { discountOverride: 12.5 });
  });

  it('R3-6a) coupon_uses.discount_applied de ESTA orden sigue al nuevo descuento del cupón', async () => {
    const ctx = build([mkLine(1, { discount_amount: 5 }), mkLine(2, { discount_amount: 5 })], { discount_amount: 10, coupon_code: 'C', coupon_id: 1 });
    ctx.db.coupon_uses.findFirst.mockResolvedValue({ id: 33, discount_applied: 10 });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 6 });
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.db.coupon_uses.update).toHaveBeenCalledTimes(1);
    expect(ctx.db.coupon_uses.update.mock.calls[0][0].where).toEqual({ id: 33 });
    // solo el monto del cupón (como registerUse en checkout)
    expect(Number(ctx.db.coupon_uses.update.mock.calls[0][0].data.discount_applied)).toBe(6);
  });

  it('R3-7) mensaje propio al editar una orden cobrada o terminal', async () => {
    const paid = build([mkLine(1)]);
    paid.orderFlow.getOrderItemCancelBlock.mockReturnValue({
      code: ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
      message: 'No se puede cancelar un ítem de una orden ya cobrada',
      reason: 'paid',
    });
    const p = await paid.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }] });
    expect(p.lines[0].blocked_reason).toBe('No se pueden modificar los productos de una orden ya cobrada');
    const done = build([mkLine(1)], { state: 'draft' });
    done.orderFlow.getOrderItemCancelBlock.mockReturnValue({
      code: ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
      message: "No se puede cancelar un ítem en estado 'finished'",
      reason: 'terminal_state',
    });
    const p2 = await done.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }] });
    expect(p2.lines[0].blocked_reason).toBe("No se pueden modificar los productos de una orden en estado 'draft'");
  });

  it('R3-7b) apply: la guarda transaccional de cancelación se reescribe usando details.reason', async () => {
    const ctx = build([mkLine(1)]);
    ctx.orderFlow.assertOrderItemsCancellableInTx.mockRejectedValue(
      new VendixHttpException(ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE, 'No se puede cancelar un ítem de una orden ya cobrada', { reason: 'paid' }),
    );
    await expect(
      ctx.service.apply(ORDER_ID, { update: [{ order_item_id: 1, quantity: 3 }], expected_version: `${VERSION}|x` }),
    ).rejects.toMatchObject({ message: 'No se pueden modificar los productos de una orden ya cobrada' });
  });

  it('R4-1) línea legacy sin filas y tax_amount_item null: el preview no inventa impuesto (= recalc)', async () => {
    const legacy = mkLine(1, {
      product_id: null, products: null, quantity: 1, unit_price: 100, total_price: 100,
      discount_amount: null, tax_amount_item: null, tax_rate: 0.19, order_item_taxes: [],
    });
    const ctx = build([legacy], { discount_amount: 0, tax_amount: 0 });
    const p = await ctx.service.preview(ORDER_ID, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(p.totals.after.tax).toBe(0);
    await applyV(ctx, { update: [{ order_item_id: 1, quantity: 2 }] });
    expect(ctx.db.order_items.update.mock.calls[0][0].data).not.toHaveProperty('tax_amount_item');
    // en reprice con cupón fijo tampoco aparece impuesto
    const rows = mkLine(2, {
      quantity: 1, unit_price: 100, total_price: 100, discount_amount: 5,
      order_item_taxes: [{ id: 200, tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.1, tax_amount: 9.5, tax_type: 'iva', is_compound: false, is_inclusive: false }],
    });
    const c2 = build([rows, { ...legacy, id: 3, discount_amount: 0 }], { discount_amount: 5, coupon_code: 'F', coupon_id: 1 });
    c2.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 8 });
    const p2 = await c2.service.preview(ORDER_ID, { update: [{ order_item_id: 2, quantity: 2 }] });
    // 200 - desc, impuesto solo de la línea con filas; la legacy aporta 0
    const legacyTax = p2.totals.after.tax - Number((p2.totals.after.tax).toFixed(2));
    expect(legacyTax).toBe(0);
    expect(p2.totals.after.tax).toBeLessThanOrEqual(20);
  });

  it('R4-2) re-cotiza solo con las promociones de la orden (pausadas incluidas)', async () => {
    const ctx = build([mkLine(1, { discount_amount: 5 }), mkLine(2, { discount_amount: 5 })], {
      discount_amount: 10, order_promotions: [{ id: 71, promotion_id: 4 }],
    });
    await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(ctx.promotionEngine.quoteDiscounts).toHaveBeenCalledWith(
      expect.objectContaining({ order_scope: { promotion_ids: [4] }, manual_promotion_ids: [4] }),
    );
  });

  it('R4-3) coupon_uses.discount_applied no se toca si el descuento no cambia (aunque la fila difiera)', async () => {
    const ctx = build([mkLine(1, { discount_amount: 5, order_item_taxes: [] })], { discount_amount: 5, coupon_code: 'C', coupon_id: 1 });
    ctx.db.coupon_uses.findFirst.mockResolvedValue({ id: 33, discount_applied: 7 });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 5 });
    ctx.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    await applyV(ctx, { add: [{ product_id: 11, quantity: 1 }] });
    expect(ctx.db.coupon_uses.update).not.toHaveBeenCalled();
  });

  it('R4-3b) coupon_uses guarda SOLO el monto del cupón: promo $5 + cupón que pasa de 10 a 12 -> 12, no 17', async () => {
    const mk = (id: number) => mkLine(id, { quantity: 1, unit_price: 100, total_price: 100, discount_amount: 7.5, order_item_taxes: [] });
    const ctx = build([mk(1), mk(2)], {
      discount_amount: 15, coupon_code: 'C', coupon_id: 1,
      order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 5 }],
    });
    ctx.promotionEngine.quoteDiscounts.mockResolvedValue({ total_discount: 5, order_promotions_snapshot: [{ promotion_id: 1, discount_amount: 5 }] });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 12 });
    ctx.db.coupon_uses.findFirst.mockResolvedValue({ id: 33, discount_applied: 10 });
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(Number(ctx.db.coupon_uses.update.mock.calls[0][0].data.discount_applied)).toBe(12);
  });

  it('R5-2) una promoción que deja de aplicar queda en 0 (no se borra) y vuelve a aplicar al re-agregar', async () => {
    const mk = (id: number, d = 2.5) => mkLine(id, { quantity: 1, unit_price: 100, total_price: 100, discount_amount: d, order_item_taxes: [] });
    const base = { discount_amount: 5, order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 5 }] };
    const ctx = build([mk(1), mk(2)], base);
    ctx.promotionEngine.quoteDiscounts.mockResolvedValue({ total_discount: 0, order_promotions_snapshot: [] });
    const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.warnings).toContain('La promoción «Promo X» deja de aplicar con este cambio ($5 → $0)');
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.db.order_promotions.deleteMany).not.toHaveBeenCalled();
    expect(Number(ctx.db.order_promotions.updateMany.mock.calls[0][0].data.discount_amount)).toBe(0);
    // la fila en 0 sigue en el alcance y vuelve a aplicar
    const back = build([mk(2, 0)], { discount_amount: 0, order_promotions: [{ id: 71, promotion_id: 1, discount_amount: 0 }] });
    back.promotionEngine.quoteDiscounts.mockResolvedValue({ total_discount: 4, order_promotions_snapshot: [{ promotion_id: 1, discount_amount: 4 }] });
    back.db.products.findMany.mockResolvedValue([sellable({ track_inventory: false })]);
    const p2 = await back.service.preview(ORDER_ID, { add: [{ product_id: 11, quantity: 1 }] });
    expect(back.promotionEngine.quoteDiscounts).toHaveBeenCalledWith(expect.objectContaining({ order_scope: { promotion_ids: [1] } }));
    expect(p2.warnings).toContain('La promoción «Promo X» vuelve a aplicar');
    await applyV(back, { add: [{ product_id: 11, quantity: 1 }] });
    expect(Number(back.db.order_promotions.updateMany.mock.calls[0][0].data.discount_amount)).toBe(4);
  });

  it('R5-3) sin reserva (draft sin mesa) el preview de remove no promete liberar stock', async () => {
    const ctx = build([mkTracked(1, { quantity: 2 }), mkLine(2)], { state: 'draft' });
    const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.lines[0].stock_effect).toBe('none');
    expect(p.lines[0].messages.join(' ')).not.toContain('Se liberará la reserva');
    const reserved = build([mkTracked(1, { quantity: 2 }), mkLine(2)], { state: 'created' });
    const p2 = await reserved.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p2.lines[0].stock_effect).toBe('release');
  });

  it('R4-4) recorte del descuento de cabecera: warning "se ajusta de $A a $B"', async () => {
    const ctx = build([mkLine(1), mkLine(2)], { discount_amount: 500 });
    const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.warnings.join(' ')).toMatch(/El descuento de la orden se ajusta de \$500 a \$\d+(\.\d+)? porque supera el nuevo total/);
    expect(p.warnings.join(' ')).not.toContain('se mantiene igual');
  });

  it('R4-5) cabecera 0 con cupón: no se redistribuye en líneas, solo cambia la cabecera', async () => {
    const ctx = build([mkLine(1), mkLine(2)], { discount_amount: 0, coupon_code: 'C', coupon_id: 1 });
    ctx.coupons.validate.mockResolvedValue({ coupon_id: 1, discount_amount: 10 });
    const p = await ctx.service.preview(ORDER_ID, { remove: [{ order_item_id: 1 }] });
    expect(p.lines.some((l) => l.action === 'reprice')).toBe(false);
    expect(p.warnings.join(' ')).toContain('El descuento de la promoción/cupón se recalcula: $0 → $10');
    await applyV(ctx, { remove: [{ order_item_id: 1 }], reason: 'motivo ok' });
    expect(ctx.db.order_item_taxes.update).not.toHaveBeenCalled();
    expect(ctx.orderFlow.recalcOrderTotalsFromActiveLinesInTx).toHaveBeenCalledWith(ctx.db, expect.anything(), ORDER_ID, { discountOverride: 10 });
  });

  it('R4-6) si findOne falla post-commit: { order: null, reload_required: true } sin lanzar', async () => {
    const ctx = build([mkLine(1)]);
    ctx.ordersService.findOne.mockRejectedValue(new Error('boom'));
    const res: any = await applyV(ctx, { update: [{ order_item_id: 1, quantity: 3 }] });
    expect(res.order).toBeNull();
    expect(res.reload_required).toBe(true);
    expect(res.summary).toBeDefined();
    expect(res.kitchen).toEqual({ kitchen_ticket_ids: [], stock_warnings: [] });
    expect(ctx.db.order_items.update).toHaveBeenCalled();
  });

  it('R4-7) un change-set que deja la orden sin productos se rechaza en preview y apply', async () => {
    const ctx = build([mkLine(1), mkLine(2)]);
    const dto = { remove: [{ order_item_id: 1 }, { order_item_id: 2 }], reason: 'motivo ok' };
    await expect(ctx.service.preview(ORDER_ID, dto)).rejects.toMatchObject({
      errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code,
      message: expect.stringContaining('La orden debe tener al menos un producto; para anularla usa Cancelar orden'),
    });
    await expect(
      ctx.service.apply(ORDER_ID, { ...dto, expected_version: `${VERSION}|x` }),
    ).rejects.toMatchObject({ errorCode: ErrorCodes.ORD_ITEM_CHANGES_INVALID_001.code });
    expect(ctx.orderFlow.cancelOrderItemInTx).not.toHaveBeenCalled();
  });
});
