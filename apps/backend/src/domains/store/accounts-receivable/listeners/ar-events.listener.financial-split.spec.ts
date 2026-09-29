import { ArEventsListener } from './ar-events.listener';

describe('ArEventsListener — financial account isolation from source-order AR', () => {
  const ar = { registerPayment: jest.fn(), createCreditSaleFromEvent: jest.fn() };
  const prisma = { accounts_receivable: { findFirst: jest.fn() } };
  const listener = new ArEventsListener(ar as any, prisma as any);
  const payment = {
    payment_id: 1,
    order_id: 9001,
    amount: 40,
    store_id: 2,
    organization_id: 1,
    user_id: 7,
    payment_method: 'cash',
  };
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.accounts_receivable.findFirst.mockResolvedValue({ id: 8 });
    ar.registerPayment.mockResolvedValue({});
  });

  it('does not apply a financial account payment to AR belonging to the common source order', async () => {
    await listener.handlePaymentReceived({
      ...payment,
      financial_account_id: 20,
    });
    expect(prisma.accounts_receivable.findFirst).not.toHaveBeenCalled();
    expect(ar.registerPayment).not.toHaveBeenCalled();
  });
  it('does not create a source-wide credit AR for a financial account event', async () => {
    await listener.handleCreditSaleCreated({
      order_id: 9001,
      financial_account_id: 20,
      total_amount: 100,
      customer_id: 8,
      store_id: 2,
      organization_id: 1,
    });
    expect(ar.createCreditSaleFromEvent).not.toHaveBeenCalled();
  });
  it('routes an order credit event through the lifecycle-safe writer', async () => {
    await listener.handleCreditSaleCreated({
      order_id: 9001, total_amount: 100, store_id: 2, customer_id: 8,
      organization_id: 1,
    });
    expect(ar.createCreditSaleFromEvent).toHaveBeenCalledWith({
      order_id: 9001, total_amount: 100, store_id: 2, due_date: undefined,
    });
  });
  it('preserves the legacy order payment contract', async () => {
    await listener.handlePaymentReceived(payment);
    expect(ar.registerPayment).toHaveBeenCalledWith(
      8,
      { amount: 40, payment_id: 1, payment_method: 'cash' },
      7,
    );
  });
  it('preserves the dedicated dispatch-route bypass', async () => {
    await listener.handlePaymentReceived({
      ...payment,
      source_type: 'dispatch_route',
    });
    expect(prisma.accounts_receivable.findFirst).not.toHaveBeenCalled();
  });
});
