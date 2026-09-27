import { WebhookHandlerService } from './webhook-handler.service';
import { Prisma } from '@prisma/client';

describe('WebhookHandlerService reserved POS Wompi settlement', () => {
  const make = () => {
    const order: any = { id: 12, store_id: 3, state: 'pending_payment' };
    const payment: any = { id: 77, order_id: 12, state: 'pending',
      gateway_reference: 'vendix_3_12_77',
      gateway_response: { payment_type: 'online', pos_reserved_payment: true } };
    const tx: any = {
      $queryRaw: jest.fn(async () => [{ id: 12, state: order.state }]),
      payments: {
        findFirst: jest.fn(async () => payment),
        updateMany: jest.fn(async ({ data }) => {
          payment.state = data.state;
          payment.gateway_response = data.gateway_response;
          return { count: 1 };
        }),
      },
      orders: {
        updateMany: jest.fn(async ({ data }) => { order.state = data.state; return { count: 1 }; }),
        findUnique: jest.fn(async () => ({ ...order, grand_total: 11900,
          payments: [{ state: payment.state, amount: 11900 }] })),
      },
      wallet_transactions: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma: any = {
      withoutScope: () => ({ orders: { findUnique: jest.fn(async () => order) } }),
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const storeRunner: any = { runInStoreContext: jest.fn((_storeId, fn) => fn()) };
    const handler = new WebhookHandlerService(prisma, {} as any, storeRunner,
      {} as any, {} as any, {} as any, {} as any);
    const accounting = jest.spyOn(handler as any, 'emitPaymentReceivedAccounting').mockResolvedValue(undefined);
    const confirm = jest.spyOn(handler as any, 'confirmOrderPaid').mockResolvedValue(undefined);
    const cancel = jest.spyOn(handler as any, 'cancelOrderIfOpen').mockResolvedValue(undefined);
    return { handler, order, payment, tx, accounting, confirm, cancel };
  };

  it('reopens an adopted order instead of cancelling it on Wompi decline', async () => {
    const { handler, order, tx, cancel } = make();
    await (handler as any).updatePaymentStatus('vendix_3_12_77', 'failed',
      { transaction: { id: 'w-1', status: 'DECLINED' } },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(order.state).toBe('created');
    expect(tx.orders.updateMany).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('emits the receipt once even if approval is replayed', async () => {
    const { handler, accounting, confirm } = make();
    const apply = () => (handler as any).updatePaymentStatus('vendix_3_12_77', 'succeeded',
      { transaction: { id: 'w-1', status: 'APPROVED' } },
      { matchedPayment: { id: 77, order_id: 12 } });
    await apply();
    await apply();
    expect(accounting).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalled();
  });

  it('keeps the reserved wallet identity after settlement so a paid retry stays idempotent', async () => {
    const { handler, payment, accounting, tx } = make();
    payment.gateway_reference = 'pos_wallet_3_12_77';
    payment.gateway_response = { pos_reserved_payment: true, wallet_id: 9 };
    await (handler as any).updatePaymentStatus(payment.gateway_reference, 'succeeded',
      { wallet_transaction_id: 40 },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(payment.gateway_response).toEqual(expect.objectContaining({
      pos_reserved_payment: true, wallet_id: 9, wallet_transaction_id: 40,
    }));
    await (handler as any).updatePaymentStatus(payment.gateway_reference, 'succeeded',
      { wallet_transaction_id: 40 },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(tx.payments.updateMany).toHaveBeenCalledTimes(1);
    expect(accounting).toHaveBeenCalledTimes(1);
  });

  it('flags approval after a declined adopted attempt for reconciliation, never a second sale receipt', async () => {
    const { handler, order, payment, accounting, confirm } = make();
    order.state = 'created';
    payment.state = 'failed';
    await (handler as any).updatePaymentStatus('vendix_3_12_77', 'succeeded',
      { transaction: { id: 'w-1', status: 'APPROVED' } },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(payment.gateway_response.reconciliation_required).toBe(true);
    expect(accounting).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('reopens a rejected wallet attempt only if no completed debit exists', async () => {
    const { handler, order, payment, tx, cancel } = make();
    payment.gateway_reference = 'pos_wallet_3_12_77';
    tx.wallet_transactions.findFirst.mockResolvedValueOnce(null);
    await (handler as any).updatePaymentStatus(payment.gateway_reference, 'failed',
      { rejection_reason: 'insufficient' },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(order.state).toBe('created');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not fail a wallet reservation after a competing debit already committed', async () => {
    const { handler, order, payment, tx } = make();
    payment.gateway_reference = 'pos_wallet_3_12_77';
    tx.wallet_transactions.findFirst.mockResolvedValue({ id: 40 });
    await (handler as any).updatePaymentStatus(payment.gateway_reference, 'failed',
      { rejection_reason: 'stale validation' },
      { matchedPayment: { id: 77, order_id: 12 } });
    expect(payment.state).toBe('pending');
    expect(order.state).toBe('pending_payment');
    expect(tx.payments.updateMany).not.toHaveBeenCalled();
  });

  it('settles a wallet only when the completed ledger matches payment, owner and store', async () => {
    const { handler } = make();
    const payment: any = { id: 77, order_id: 12, amount: new Prisma.Decimal(11900),
      gateway_reference: 'pos_wallet_3_12_77',
      gateway_response: { pos_reserved_payment: true, wallet_id: 9 },
      orders: { store_id: 3, customer_id: 5 },
      store_payment_method: { system_payment_method: { type: 'wallet' } } };
    const walletTx: any = { id: 40, wallet_id: 9, amount: new Prisma.Decimal(11900),
      balance_after: new Prisma.Decimal(8100), wallet: { store_id: 3, customer_id: 5 } };
    (handler as any).prisma = { withoutScope: () => ({
      payments: { findUnique: jest.fn().mockResolvedValue(payment) },
      wallet_transactions: { findFirst: jest.fn().mockResolvedValue(walletTx) },
    }) };
    const cas = jest.spyOn(handler as any, 'updatePaymentStatus').mockResolvedValue({});
    await handler.settleReservedWalletPayment(77, 'wallet_40');
    expect(cas).toHaveBeenCalledWith('pos_wallet_3_12_77', 'succeeded',
      expect.objectContaining({ wallet_transaction_id: 40 }),
      expect.objectContaining({ extraUpdate: { transaction_id: 'wallet_40' } }));
    walletTx.wallet.customer_id = 6;
    await expect(handler.settleReservedWalletPayment(77, 'wallet_40')).rejects.toThrow();
    expect(cas).toHaveBeenCalledTimes(1);
  });

  it('allocates only this payment share of tip, subtotal and tax after a prior partial payment', async () => {
    const order: any = { id: 12, store_id: 3, order_number: 'P-12',
      subtotal_amount: new Prisma.Decimal(100), tax_amount: new Prisma.Decimal(10),
      shipping_cost: new Prisma.Decimal(0), discount_amount: new Prisma.Decimal(0),
      tip_amount: new Prisma.Decimal(10), grand_total: new Prisma.Decimal(120),
      currency: 'COP', customer_id: 5, stores: { organization_id: 2 }, order_items: [] };
    const payment: any = { id: 77, order_id: 12, amount: new Prisma.Decimal(60),
      currency: 'COP', gateway_response: { pos_reserved_payment: true }, orders: order,
      store_payment_method: { system_payment_method: { type: 'wompi', display_name: 'Wompi' } } };
    const client: any = {
      payments: { findUnique: jest.fn().mockResolvedValue(payment),
        findMany: jest.fn().mockResolvedValue([{ amount: new Prisma.Decimal(60) }]) },
      orders: { findUnique: jest.fn().mockResolvedValue(order) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const eventEmitter: any = { emit: jest.fn() };
    const handler = new WebhookHandlerService({ withoutScope: () => client } as any,
      eventEmitter, {} as any, {} as any, {} as any, {} as any, {} as any);
    await (handler as any).emitPaymentReceivedAccounting(77);
    const payload = eventEmitter.emit.mock.calls.find(([name]) => name === 'payment.received')?.[1];
    expect(payload).toBeDefined();
    expect(payload.amount).toBe(60);
    expect(payload.subtotal_amount).toBe(50);
    expect(payload.tax_amount).toBe(5);
    expect(payload.tip_amount).toBe(5);
    expect(payload.subtotal_amount + payload.tax_amount + payload.tip_amount).toBe(60);
  });

  it('does not emit accounting for an unreconciled partial share and marks the captured payment', async () => {
    const order: any = { id: 12, store_id: 3, subtotal_amount: 100, tax_amount: 10,
      shipping_cost: 0, discount_amount: 0, tip_amount: 10, grand_total: 120,
      currency: 'COP', stores: { organization_id: 2 }, order_items: [] };
    const payment: any = { id: 77, order_id: 12, amount: new Prisma.Decimal(61),
      gateway_response: { pos_reserved_payment: true }, orders: order,
      store_payment_method: { system_payment_method: { type: 'wompi' } } };
    const client: any = {
      payments: { findUnique: jest.fn().mockResolvedValue(payment),
        findMany: jest.fn().mockResolvedValue([{ amount: new Prisma.Decimal(60) }]) },
      orders: { findUnique: jest.fn().mockResolvedValue(order) },
      order_items: { findMany: jest.fn().mockResolvedValue([]) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const events: any = { emit: jest.fn() };
    const handler = new WebhookHandlerService({ withoutScope: () => client } as any,
      events, {} as any, {} as any, {} as any, {} as any, {} as any);
    await (handler as any).emitPaymentReceivedAccounting(77);
    expect(events.emit).not.toHaveBeenCalled();
    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
