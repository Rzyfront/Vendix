import { ServiceDepositPaidListener } from './service-deposit-paid.listener';

describe('ServiceDepositPaidListener', () => {
  const event = (purpose: string) =>
    ({ store_id: 7, payment_request_id: 9, purpose, amount: 100, method: 'wompi', paid_at: new Date() }) as any;

  function build() {
    const deposits: any = { settlePaidRequest: jest.fn().mockResolvedValue(undefined) };
    const runner: any = { runInStoreContext: jest.fn((_id: number, fn: () => Promise<unknown>) => fn()) };
    return { listener: new ServiceDepositPaidListener(deposits, runner), deposits, runner };
  }

  it('settles a service_deposit request inside the store context', async () => {
    const { listener, deposits, runner } = build();
    await listener.onPaymentRequestPaid(event('service_deposit'));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(7, expect.any(Function));
    expect(deposits.settlePaidRequest).toHaveBeenCalledWith(expect.objectContaining({ payment_request_id: 9 }));
  });

  it('ignores requests of other purposes', async () => {
    const { listener, deposits, runner } = build();
    await listener.onPaymentRequestPaid(event('order'));
    expect(runner.runInStoreContext).not.toHaveBeenCalled();
    expect(deposits.settlePaidRequest).not.toHaveBeenCalled();
  });

  it('a failure is logged and never thrown to the emitter', async () => {
    const { listener, deposits } = build();
    deposits.settlePaidRequest.mockRejectedValue(new Error('boom'));
    await expect(listener.onPaymentRequestPaid(event('service_deposit'))).resolves.toBeUndefined();
  });
});
