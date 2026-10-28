import { PaymentFromDispatchRouteListener } from './payment-from-dispatch-route.listener';

describe('PaymentFromDispatchRouteListener — withholding hand-off', () => {
  const build = () => {
    const orderFlow = { applyDispatchCodPayment: jest.fn().mockResolvedValue(undefined) };
    const runner = { runInStoreContext: jest.fn((_s: number, fn: () => unknown) => fn()) };
    const listener = new PaymentFromDispatchRouteListener(orderFlow as any, runner as any);
    return { listener, orderFlow };
  };
  const base = {
    source_type: 'dispatch_route', store_id: 2, dispatch_note_id: 9, stop_id: 4, amount: 100,
  };

  it('folds the route breakdown into a typed object and total', async () => {
    const { listener, orderFlow } = build();
    await listener.handlePaymentReceived({
      ...base,
      withholding_breakdown: [
        { code: 'retefuente', amount: 15 },
        { code: 'reteiva', amount: 5 },
      ],
    });
    expect(orderFlow.applyDispatchCodPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        correlationKey: 'dispatch_route_stop:4',
        withholdingAmount: 20,
        withholdingBreakdown: { retefuente: 15, reteiva: 5 },
      }),
    );
  });

  it('no withholding: the call carries no withholding fields (unchanged)', async () => {
    const { listener, orderFlow } = build();
    await listener.handlePaymentReceived({ ...base, withholding_breakdown: [] });
    const arg = orderFlow.applyDispatchCodPayment.mock.calls[0][0];
    expect(arg).not.toHaveProperty('withholdingAmount');
    expect(arg).not.toHaveProperty('withholdingBreakdown');
  });

  it('amount 0 con retención: igual aplica (crédito con W y sin efectivo)', async () => {
    const { listener, orderFlow } = build();
    await listener.handlePaymentReceived({
      ...base, amount: 0, withholding_breakdown: [{ code: 'reteiva', amount: 7 }],
    });
    expect(orderFlow.applyDispatchCodPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 0, withholdingAmount: 7 }),
    );
  });

  it('amount 0 sin retención: no hace nada', async () => {
    const { listener, orderFlow } = build();
    await listener.handlePaymentReceived({ ...base, amount: 0, withholding_breakdown: [] });
    expect(orderFlow.applyDispatchCodPayment).not.toHaveBeenCalled();
  });
});
