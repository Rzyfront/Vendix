import { PaymentGatewayService } from './payment-gateway.service';

describe('PaymentGatewayService.processReservedPosPayment', () => {
  const make = (overrides: Record<string, unknown> = {}) => {
    const payment: any = {
      id: 77, order_id: 12, amount: 11900, currency: 'COP', state: 'pending',
      gateway_reference: null, store_payment_method_id: 4,
      gateway_response: { payment_type: 'online' },
      orders: { id: 12, store_id: 3, customer_id: 5, currency: 'COP',
        grand_total: 11900, payments: [{ id: 77, state: 'pending', amount: 11900 }],
        state: 'pending_payment', channel: 'pos', active_financial_split_id: null },
      store_payment_method: { id: 4, state: 'enabled', custom_config: {},
        system_payment_method: { type: 'wompi', is_active: true } },
      ...overrides,
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 12, state: 'pending_payment' }]),
      payments: {
        findFirst: jest.fn().mockResolvedValue(payment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma: any = {
      payments: { findFirst: jest.fn().mockResolvedValue({ order_id: 12 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn((fn) => fn(tx)),
    };
    const validator: any = { validateOrder: jest.fn().mockResolvedValue({ valid: true, order: payment.orders }),
      validatePaymentMethod: jest.fn().mockResolvedValue(true),
      validatePaymentAmount: jest.fn().mockResolvedValue(true),
      validateCurrency: jest.fn().mockResolvedValue(true) };
    const encryption: any = { decryptConfig: jest.fn().mockReturnValue({ public_key: 'pk' }) };
    const gateway = new PaymentGatewayService(prisma, validator, {} as any, encryption);
    const processor: any = { isEnabled: jest.fn().mockReturnValue(true), processPayment: jest.fn().mockResolvedValue({
      success: true, status: 'pending', transactionId: 'wompi-tx',
      gatewayResponse: { id: 'wompi-tx', reference: 'vendix_3_12_77', status: 'PENDING' },
      nextAction: { type: 'await' },
    }) };
    gateway.registerProcessor('wompi', processor);
    return { gateway, prisma, tx, validator, processor, encryption };
  };

  it('uses only the reserved order amount/currency and a stable provider key', async () => {
    const { gateway, tx, validator, processor } = make();
    await gateway.processReservedPosPayment(77, 3, { wompi_payment_method: { type: 'NEQUI', phone_number: '3001234567' } });
    expect(tx.payments.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gateway_reference: 'vendix_3_12_77' }),
    }));
    expect(validator.validatePaymentAmount).toHaveBeenCalledWith(11900, 12, 77);
    expect(processor.processPayment).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 12, amount: 11900, currency: 'COP', storeId: 3,
      idempotencyKey: 'pos-reserved-77',
      metadata: expect.objectContaining({ reference: 'vendix_3_12_77' }),
    }));
  });

  it('rejects a split source before calling the processor', async () => {
    const { gateway, processor } = make({ orders: { id: 12, store_id: 3,
      customer_id: 5, currency: 'COP', grand_total: 11900,
      payments: [{ id: 77, state: 'pending', amount: 11900 }],
      channel: 'pos', active_financial_split_id: 9 } });
    await expect(gateway.processReservedPosPayment(77, 3, { wompi_payment_method: { type: 'CARD' } }))
      .rejects.toThrow();
    expect(processor.processPayment).not.toHaveBeenCalled();
  });

  it('rejects wallet substitution on a resumed reservation', async () => {
    const { gateway } = make({ store_payment_method: { id: 4, state: 'enabled',
      system_payment_method: { type: 'wallet', is_active: true } },
      gateway_reference: 'pos_wallet_3_12_77',
      gateway_response: { payment_type: 'online', wallet_id: 6 } });
    await expect(gateway.processReservedPosPayment(77, 3, { wallet_id: 7 }))
      .rejects.toThrow();
  });

  it('rejects a reservation that no longer matches the locked unpaid balance', async () => {
    const { gateway, processor } = make({ orders: { id: 12, store_id: 3,
      customer_id: 5, currency: 'COP', grand_total: 12000,
      payments: [{ id: 77, state: 'pending', amount: 11900 }],
      channel: 'pos', active_financial_split_id: null } });
    await expect(gateway.processReservedPosPayment(77, 3,
      { wompi_payment_method: { type: 'NEQUI' } })).rejects.toThrow();
    expect(processor.processPayment).not.toHaveBeenCalled();
  });
});
