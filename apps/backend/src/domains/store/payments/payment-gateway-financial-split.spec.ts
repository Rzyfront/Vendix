import { PaymentGatewayService } from './services/payment-gateway.service';

describe('reserved financial account gateway', () => {
  let prisma: any, validators: any, gateway: PaymentGatewayService, processor: any, payment: any;
  beforeEach(() => {
    payment = { id: 9, order_id: 1, customer_id: 6, amount: '40.00', currency: 'COP', state: 'pending', store_payment_method_id: 3, financial_idempotency_key: 'stable-key',
      financial_account: { id: 2, role: 'payable', state: 'active', store_id: 10, split_id: 4, split: { state: 'active', source_order_id: 1 } },
      orders: { store_id: 10, active_financial_split_id: 4 }, gateway_response: { financial_request: { created_by_user_id: 7 } } };
    prisma = { payments: { findFirst: jest.fn().mockImplementation(async () => payment), updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() }, store_payment_methods: { findUnique: jest.fn().mockResolvedValue({ type: 'card', system_payment_method: { type: 'card' } }) } };
    validators = { validateOrder: jest.fn().mockResolvedValue({ valid: true, order: payment.orders }), validatePaymentMethod: jest.fn().mockResolvedValue(true), validatePaymentAmount: jest.fn().mockResolvedValue(true), validateCurrency: jest.fn().mockResolvedValue(true) };
    gateway = new PaymentGatewayService(prisma, validators, {} as any);
    processor = { isEnabled: jest.fn().mockReturnValue(true), processPayment: jest.fn().mockResolvedValue({ success: true, status: 'succeeded', transactionId: 'tx1', gatewayResponse: {} }) };
    gateway.registerProcessor('card', processor);
  });
  it('runs all validations excluding only its own reserved row and never creates a second payment', async () => {
    await gateway.processReservedPayment(9);
    expect(validators.validateOrder).toHaveBeenCalledWith(1, 10);
    expect(validators.validatePaymentAmount).toHaveBeenCalledWith(40, 1, 9);
    expect(validators.validatePaymentMethod).toHaveBeenCalledWith(3, 10);
    expect(validators.validateCurrency).toHaveBeenCalledWith('COP', 10);
    expect(prisma.payments.create).not.toHaveBeenCalled();
    expect(processor.processPayment).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'stable-key', customerId: 6, amount: 40 }));
  });
  it('does not let the generic payment path bypass split ownership via metadata', async () => {
    await expect(gateway.processPayment({ orderId: 1, storeId: 10, amount: 40, currency: 'COP', storePaymentMethodId: 3, idempotencyKey: 'x', metadata: { financial_account_id: 2, is_pos_payment: true } })).rejects.toThrow('cuentas independientes');
    expect(processor.processPayment).not.toHaveBeenCalled();
  });
  it('rejects a source/account mismatch before provider side effects', async () => {
    payment.financial_account.split.source_order_id = 5;
    await expect(gateway.processReservedPayment(9)).rejects.toThrow('reserva');
    expect(processor.processPayment).not.toHaveBeenCalled();
  });
  it('returns an already received payment without a second charge', async () => {
    payment.state = 'succeeded';
    expect((await gateway.processReservedPayment(9)).status).toBe('succeeded');
    expect(processor.processPayment).not.toHaveBeenCalled();
  });
  it('persists reference before processor and CAS prevents a late pending response regressing a callback', async () => {
    processor.processPayment.mockResolvedValue({ success: true, status: 'pending', nextAction: { type: 'await' } });
    await gateway.processReservedPayment(9);
    expect(prisma.payments.updateMany.mock.calls[0][0].data.gateway_reference).toBe('financial_10_9');
    expect(prisma.payments.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 9, state: 'pending', financial_account_id: 2 }, data: { gateway_response: { financial_request: { created_by_user_id: 7 }, nextAction: { type: 'await' } } } });
    expect(prisma.payments.updateMany.mock.invocationCallOrder[0]).toBeLessThan(processor.processPayment.mock.invocationCallOrder[0]);
  });
});
