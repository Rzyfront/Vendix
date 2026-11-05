import { OrderFlowService } from './order-flow.service';

/**
 * Seam of the station session settlement: once the deposit is applied and the
 * order is fully paid, the order is promoted like any paid POS order and the
 * invoice emitter (which reads `invoicing.pos.auto_emit`) runs.
 */
describe('OrderFlowService — settlePaidServiceSessionOrder', () => {
  const paid = (amount: number) => ({ state: 'succeeded', amount });

  const build = (opts: { state?: string; payments?: any[]; sessionId?: number | null; table?: boolean }) => {
    const state = { value: opts.state ?? 'draft' };
    const prisma: any = {
      table_sessions: { findFirst: jest.fn(async () => (opts.table ? { id: 910 } : null)) },
      orders: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => ({ channel: 'pos', delivery_type: 'direct_delivery', order_items: [] })),
      },
    };
    const commit = { commitOrderDelivery: jest.fn(async () => undefined) };
    const service = new OrderFlowService(
      prisma, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (service as any).orderStockCommit = commit;
    (service as any).stockValidator = { resolveInventoryPolicy: jest.fn(async () => ({ allowOversell: false })) };
    (service as any).eventEmitter = { emit: jest.fn() };
    jest.spyOn(service as any, 'getOrder').mockImplementation(async () => ({
      id: 5001,
      store_id: 105,
      state: state.value,
      order_number: 'SVC-77',
      delivery_type: 'direct_delivery',
      channel: 'pos',
      grand_total: 1000000,
      service_session_id: opts.sessionId === undefined ? 77 : opts.sessionId,
      active_financial_split_id: null,
      payments: opts.payments ?? [paid(400000), paid(600000)],
      order_items: [{ id: 1 }],
    }));
    const promote = jest
      .spyOn(service as any, 'promoteDraftToCreated')
      .mockImplementation(async () => { state.value = 'created'; return true; });
    const emitInvoice = jest
      .spyOn(service as any, 'emitPosSaleCompletedIfFullyPaid')
      .mockImplementation(async () => undefined);
    return { service, prisma, commit, promote, emitInvoice };
  };

  it('fully paid draft session order: promotes it, commits the sale and runs the invoice emitter', async () => {
    const h = build({});
    await h.service.settlePaidServiceSessionOrder(5001);
    expect(h.promote).toHaveBeenCalledWith(5001, 105);
    expect(h.prisma.orders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'processing' }) }),
    );
    expect(h.commit.commitOrderDelivery).toHaveBeenCalledTimes(1);
    expect(h.emitInvoice).toHaveBeenCalledWith(5001, 'service_session.settled');
  });

  it('with balance still open it neither promotes nor commits (the invoice emitter guards itself)', async () => {
    const h = build({ payments: [paid(400000)] });
    await h.service.settlePaidServiceSessionOrder(5001);
    expect(h.promote).not.toHaveBeenCalled();
    expect(h.commit.commitOrderDelivery).not.toHaveBeenCalled();
  });

  it('is idempotent: an order already in processing is not promoted again', async () => {
    const h = build({ state: 'processing' });
    await h.service.settlePaidServiceSessionOrder(5001);
    expect(h.promote).not.toHaveBeenCalled();
    expect(h.emitInvoice).toHaveBeenCalledTimes(1);
  });

  it('an order that is not backed by a station session is left alone', async () => {
    const h = build({ sessionId: null });
    await h.service.settlePaidServiceSessionOrder(5001);
    expect(h.promote).not.toHaveBeenCalled();
    expect(h.commit.commitOrderDelivery).not.toHaveBeenCalled();
    expect(h.emitInvoice).not.toHaveBeenCalled();
  });

  it('settlePaidTableOrder still ignores a session order without a table', async () => {
    const h = build({});
    await h.service.settlePaidTableOrder(5001);
    expect(h.promote).not.toHaveBeenCalled();
    expect(h.prisma.orders.updateMany).not.toHaveBeenCalled();
  });
});
