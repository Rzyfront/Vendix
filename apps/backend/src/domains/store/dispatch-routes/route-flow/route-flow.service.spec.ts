import { Prisma } from '@prisma/client';
import { RouteFlowService } from './route-flow.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('RouteFlowService — settleStop (cash settlement event fan-out)', () => {
  let service: RouteFlowService;
  let prismaMock: any;
  let eventEmitterMock: any;
  let cashSettlementMock: any;
  let pdfExportMock: any;
  let context: any;

  const STORE_ID = 100;
  const ROUTE_ID = 7;
  const STOP_ID = 55;
  const USER_ID = 1;

  // A dispatched route in a state that allows settling.
  const buildRoute = (overrides: any = {}) => ({
    id: ROUTE_ID,
    store_id: STORE_ID,
    status: 'in_transit',
    route_number: 'PLN2606190001',
    stops: [],
    ...overrides,
  });

  // A stop whose dispatch_note has a $200 grand_total.
  const buildStop = (overrides: any = {}) => ({
    id: STOP_ID,
    route_id: ROUTE_ID,
    status: 'in_progress',
    is_prepaid: false,
    dispatch_note_id: 900,
    dispatch_note: {
      id: 900,
      dispatch_number: 'REM-1',
      grand_total: new Prisma.Decimal(200),
      customer_id: 42,
      sales_order_id: 5000,
      // Default remisión status. settleStop transitions confirmed → delivered;
      // dispatch() confirms draft → confirmed. Keep 'confirmed' as the default
      // so the pre-existing settle tests still pass unchanged.
      status: 'confirmed',
      order_id: null,
      sales_order: { id: 5000, order_number: 'SO-1', status: 'confirmed' },
    },
    ...overrides,
  });

  beforeEach(() => {
    context = {
      store_id: STORE_ID,
      organization_id: 1,
      user_id: USER_ID,
      is_super_admin: false,
    };

    prismaMock = {
      dispatch_routes: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      dispatch_route_stops: {
        findFirst: jest.fn(),
        update: jest.fn(),
        // `findMany` is now called by `refreshRouteTotals` (added in the
        // live-totals fix) to recompute the parent aggregates after each
        // settle/release. Return an empty list by default; individual tests
        // override the mock when they need to assert the recompute path.
        findMany: jest.fn().mockResolvedValue([]),
      },
      dispatch_route_stop_history: {
        create: jest.fn(),
      },
      // dispatch_notes is touched by markDispatchNoteDeliveredInTx (settle) and
      // the confirm-on-dispatch path. Echo back the merged row so the tx body
      // resolves; tests assert on the call args, not the return shape.
      dispatch_notes: {
        update: jest
          .fn()
          .mockImplementation((a: any) => ({ id: a.where.id, ...a.data })),
      },
      // store_settings drives the `dispatch.order_state_update_mode` lookup at
      // the top of settleStop. Default: no row → merge defaults → 'on_close'.
      store_settings: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // orders is only touched by advanceOrderToDelivered (live mode).
      orders: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      // $transaction executes the callback with the same mock acting as `tx`.
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    eventEmitterMock = { emit: jest.fn() };

    cashSettlementMock = {
      emitPaymentReceived: jest.fn(),
      emitCreditSale: jest.fn(),
      emitRefundCompleted: jest.fn(),
      emitWithholding: jest.fn(),
    };

    pdfExportMock = { generate: jest.fn() };

    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context);

    service = new RouteFlowService(
      prismaMock as any,
      eventEmitterMock as any,
      cashSettlementMock as any,
      pdfExportMock as any,
    );

    // Stub history/stop update so the transaction body resolves.
    prismaMock.dispatch_route_stops.update.mockImplementation((args: any) => ({
      id: STOP_ID,
      ...args.data,
    }));
    prismaMock.dispatch_route_stop_history.create.mockResolvedValue({});
  });

  afterEach(() => jest.clearAllMocks());

  // ── a) CONTADO (cash, fully delivered) ─────────────────────────────
  it('a) cash stop (collected fully, delivered): emits payment_received, not credit_sale', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 200,
      payment_method: 'cash',
    } as any);

    expect(cashSettlementMock.emitPaymentReceived).toHaveBeenCalledTimes(1);
    expect(cashSettlementMock.emitPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE_ID,
        route_id: ROUTE_ID,
        stop_id: STOP_ID,
        customer_id: 42,
        amount: 200, // collected + anticipo
        payment_method: 'cash',
      }),
    );
    expect(cashSettlementMock.emitCreditSale).not.toHaveBeenCalled();
    expect(cashSettlementMock.emitWithholding).not.toHaveBeenCalled();

    // The stop is updated with the right result/amounts.
    expect(prismaMock.dispatch_route_stops.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOP_ID },
        data: expect.objectContaining({
          status: 'delivered',
          result: 'delivered',
          collected_amount: 200,
          withholding_amount: 0,
          credit_amount: 0,
        }),
      }),
    );
  });

  // ── b) CRÉDITO (partial) ───────────────────────────────────────────
  it('b) credit stop (partial collection): emits credit_sale with amount = net - total_paid - withholding', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    // net=200, collected=120 → credit_amount = 200 - 120 - 0 = 80
    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'partial',
      collected_amount: 120,
      payment_method: 'cash',
    } as any);

    expect(cashSettlementMock.emitCreditSale).toHaveBeenCalledTimes(1);
    expect(cashSettlementMock.emitCreditSale).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE_ID,
        route_id: ROUTE_ID,
        stop_id: STOP_ID,
        customer_id: 42,
        amount: 80,
      }),
    );
    // Partial collection still triggers a payment for the collected portion.
    expect(cashSettlementMock.emitPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 120 }),
    );

    expect(prismaMock.dispatch_route_stops.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'partial',
          result: 'partial',
          collected_amount: 120,
          credit_amount: 80,
        }),
      }),
    );
  });

  // ── c) RETENCIÓN (withholding) ─────────────────────────────────────
  it('c) stop with withholding + breakdown: emits withholding with net_amount and the provided breakdown', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    // net=200, collected=185, withholding=15 → total_paid+withholding = 200 (covers net).
    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 185,
      withholding_amount: 15,
      withholding_breakdown: { retefuente: 10, reteiva: 5 },
      payment_method: 'cash',
    } as any);

    expect(cashSettlementMock.emitWithholding).toHaveBeenCalledTimes(1);
    expect(cashSettlementMock.emitWithholding).toHaveBeenCalledWith(
      expect.objectContaining({
        store_id: STORE_ID,
        route_id: ROUTE_ID,
        stop_id: STOP_ID,
        customer_id: 42,
        net_amount: 200,
        breakdown: { retefuente: 10, reteiva: 5 },
      }),
    );

    expect(prismaMock.dispatch_route_stops.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ withholding_amount: 15 }),
      }),
    );
  });

  it('c2) withholding without breakdown: falls back to { retefuente: withholding }', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 185,
      withholding_amount: 15,
      payment_method: 'cash',
    } as any);

    expect(cashSettlementMock.emitWithholding).toHaveBeenCalledWith(
      expect.objectContaining({
        net_amount: 200,
        breakdown: { retefuente: 15 },
      }),
    );
  });

  // ── d) PREPAID ─────────────────────────────────────────────────────
  it('d) prepaid stop: emits NONE of the cash settlement events', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(
      buildStop({ is_prepaid: true }),
    );

    // is_prepaid bypasses the collection-coverage check even with collected=0.
    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 0,
    } as any);

    expect(cashSettlementMock.emitPaymentReceived).not.toHaveBeenCalled();
    expect(cashSettlementMock.emitCreditSale).not.toHaveBeenCalled();
    expect(cashSettlementMock.emitRefundCompleted).not.toHaveBeenCalled();
    expect(cashSettlementMock.emitWithholding).not.toHaveBeenCalled();

    // The stop is still updated (settlement recorded) even when prepaid.
    expect(prismaMock.dispatch_route_stops.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'delivered' }),
      }),
    );
  });

  // ── e) LIVE order-state mode ───────────────────────────────────────
  it('e) live mode + linked COD order (shipped): advances order shipped→delivered on settle', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(
      buildStop({
        dispatch_note: { ...buildStop().dispatch_note, order_id: 7777 },
      }),
    );
    prismaMock.store_settings.findFirst.mockResolvedValue({
      settings: { dispatch: { order_state_update_mode: 'live' } },
    });
    prismaMock.orders.findFirst.mockResolvedValue({ id: 7777, state: 'shipped' });

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 200,
      payment_method: 'cash',
    } as any);

    // The COD order is advanced shipped → delivered inside the settle tx.
    expect(prismaMock.orders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 7777,
          store_id: STORE_ID,
          state: 'shipped',
        }),
        data: expect.objectContaining({ state: 'delivered' }),
      }),
    );
  });

  // ── f) ON_CLOSE mode (default): order state untouched at settle ─────
  it('f) on_close mode (default) + linked COD order: does NOT advance order state on settle', async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(
      buildStop({
        dispatch_note: { ...buildStop().dispatch_note, order_id: 7777 },
      }),
    );
    // store_settings default mock → null → 'on_close'.
    prismaMock.orders.findFirst.mockResolvedValue({ id: 7777, state: 'shipped' });

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 200,
      payment_method: 'cash',
    } as any);

    // Legacy behavior: order state advances only at route close, not at settle.
    expect(prismaMock.orders.updateMany).not.toHaveBeenCalled();
  });

  // ── g) DELIVERED → remisión transitions to 'delivered' + emits event ─
  it("g) result 'delivered' on a confirmed note: updates dispatch_note → delivered and emits dispatch_note.delivered", async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 200,
      payment_method: 'cash',
    } as any);

    // The remisión is transitioned to 'delivered' inside the settle tx.
    expect(prismaMock.dispatch_notes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'delivered' }),
      }),
    );
    // The delivered event is emitted post-commit for the inventory primitive.
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'dispatch_note.delivered',
      expect.objectContaining({ dispatch_note_id: 900 }),
    );
  });

  // ── h) PARTIAL → also delivers the remisión ────────────────────────
  it("h) result 'partial' on a confirmed note: updates dispatch_note → delivered and emits dispatch_note.delivered", async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    // net=200, collected=120 → partial (credit 80), still delivers the remisión.
    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'partial',
      collected_amount: 120,
      payment_method: 'cash',
    } as any);

    expect(prismaMock.dispatch_notes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 900 },
        data: expect.objectContaining({ status: 'delivered' }),
      }),
    );
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'dispatch_note.delivered',
      expect.objectContaining({ dispatch_note_id: 900 }),
    );
  });

  // ── i) REJECTED → does NOT deliver the remisión ────────────────────
  it("i) result 'rejected': does NOT transition the remisión to delivered nor emit the event", async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(buildStop());

    // rejected has no coverage requirement; collected=0 keeps cash emits silent.
    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'rejected',
      collected_amount: 0,
      payment_method: 'cash',
    } as any);

    // No dispatch_note.update with status: 'delivered'.
    const deliveredUpdate = prismaMock.dispatch_notes.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'delivered',
    );
    expect(deliveredUpdate).toBeUndefined();
    // No delivered event emitted.
    expect(eventEmitterMock.emit).not.toHaveBeenCalledWith(
      'dispatch_note.delivered',
      expect.anything(),
    );
  });

  // ── j) IDEMPOTENT: note already 'delivered' → no re-transition/re-emit ─
  it("j) note already 'delivered' + result 'delivered': idempotent, no re-update to delivered nor re-emit", async () => {
    prismaMock.dispatch_routes.findFirst.mockResolvedValue(buildRoute());
    // settleStop throws if stop.status === 'delivered', so keep the stop
    // 'in_progress' but the dispatch_note already 'delivered'.
    prismaMock.dispatch_route_stops.findFirst.mockResolvedValue(
      buildStop({
        status: 'in_progress',
        dispatch_note: { ...buildStop().dispatch_note, status: 'delivered' },
      }),
    );

    await service.settleStop(ROUTE_ID, STOP_ID, {
      result: 'delivered',
      collected_amount: 200,
      payment_method: 'cash',
    } as any);

    // Idempotent: the helper returns null for an already-delivered note, so no
    // dispatch_notes.update with status delivered and no delivered event.
    const deliveredUpdate = prismaMock.dispatch_notes.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.status === 'delivered',
    );
    expect(deliveredUpdate).toBeUndefined();
    expect(eventEmitterMock.emit).not.toHaveBeenCalledWith(
      'dispatch_note.delivered',
      expect.anything(),
    );
  });
});
