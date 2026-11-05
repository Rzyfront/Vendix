import { RentalPrepayPaidListener } from './rental-prepay-paid.listener';

describe('RentalPrepayPaidListener', () => {
  const event = (purpose: string) =>
    ({ store_id: 7, payment_request_id: 9, purpose, amount: 100, method: 'wompi', paid_at: new Date() }) as any;

  function build() {
    const prepay: any = { settlePaidRequest: jest.fn().mockResolvedValue(undefined) };
    const runner: any = { runInStoreContext: jest.fn((_id: number, fn: () => Promise<unknown>) => fn()) };
    return { listener: new RentalPrepayPaidListener(prepay, runner), prepay, runner };
  }

  it('liquida una solicitud service_rental dentro del contexto de la tienda', async () => {
    const { listener, prepay, runner } = build();
    await listener.onPaymentRequestPaid(event('service_rental:77'));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(7, expect.any(Function));
    expect(prepay.settlePaidRequest).toHaveBeenCalledWith(expect.objectContaining({ payment_request_id: 9 }));
  });

  it('ignora el anticipo y las solicitudes de otros propósitos', async () => {
    const { listener, prepay, runner } = build();
    await listener.onPaymentRequestPaid(event('service_deposit'));
    await listener.onPaymentRequestPaid(event('order'));
    expect(runner.runInStoreContext).not.toHaveBeenCalled();
    expect(prepay.settlePaidRequest).not.toHaveBeenCalled();
  });

  it('un fallo se registra y nunca llega al emisor', async () => {
    const { listener, prepay } = build();
    prepay.settlePaidRequest.mockRejectedValue(new Error('boom'));
    await expect(listener.onPaymentRequestPaid(event('service_rental:77'))).resolves.toBeUndefined();
  });
});
