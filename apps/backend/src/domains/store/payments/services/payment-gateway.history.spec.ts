import { refunds_state_enum } from '@prisma/client';
import { PaymentGatewayService } from './payment-gateway.service';

/**
 * Plan order-truth-and-invoice-tz — `PaymentGatewayService.refundPayment`
 * (carril HTTP: controller → PaymentsService → aquí) registra
 * `refund_resolved` en `updateOrderAfterRefund` cuando la pasarela deja el
 * reembolso en estado terminal. Sin `source` explícito: nunca 'webhook'
 * (regresión corregida en fd8e677c6).
 */
afterEach(() => {
  jest.restoreAllMocks();
});

describe('PaymentGatewayService.refundPayment — refund_resolved', () => {
  const ORDER_ID = 3100;
  const STORE_ID = 77;
  const PAYMENT_ID = 450;
  const REFUND_ID = 990;

  const build = (refundState: refunds_state_enum) => {
    const prisma: any = {
      payments: {
        findFirst: jest.fn().mockResolvedValue({ id: PAYMENT_ID, order_id: ORDER_ID }),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({
          id: REFUND_ID,
          order_id: ORDER_ID,
          payment_id: PAYMENT_ID,
          amount: 15000,
          state: refundState,
          refund_transaction_id: 'gw-rf-1',
        }),
      },
      orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: STORE_ID,
          state: 'delivered',
          grand_total: 30000,
          payments: [{ id: PAYMENT_ID, state: 'succeeded', amount: 30000 }],
          refunds: [{ id: REFUND_ID, state: refundState, amount: 15000 }],
          stores: { organization_id: 8 },
        }),
        update: jest.fn(),
      },
    };
    const orderHistory = { record: jest.fn().mockResolvedValue(null) };
    const service = new PaymentGatewayService(
      prisma,
      {} as any,
      {} as any,
      undefined,
      orderHistory as any,
    );
    jest.spyOn(service, 'reversePaymentWithProcessor').mockResolvedValue({
      success: true,
      refundId: 'gw-rf-1',
      amount: 15000,
      status: refundState === 'completed' ? 'succeeded' : refundState === 'failed' ? 'failed' : 'pending',
    } as any);
    return { prisma, orderHistory, service };
  };

  it.each([refunds_state_enum.completed, refunds_state_enum.failed])('reembolso %s: registra refund_resolved con refund/payment/monto exactos y sin source', async (state) => {
    const { prisma, orderHistory, service } = build(state);

    await service.refundPayment('tx-1', 15000, 'cliente');

    expect(orderHistory.record).toHaveBeenCalledWith(prisma, {
      orderId: ORDER_ID,
      storeId: STORE_ID,
      organizationId: 8,
      type: 'refund_resolved',
      paymentId: PAYMENT_ID,
      amount: '15000',
      payload: {
        refund_id: REFUND_ID,
        target_state: state,
        payout_reference: 'gw-rf-1',
        payout_channel: 'gateway',
      },
    });
    for (const [, evt] of orderHistory.record.mock.calls) {
      expect(evt.source).toBeUndefined();
    }
  });

  it('reembolso processing (pasarela pending): no es resolución, no registra', async () => {
    const { orderHistory, service } = build(refunds_state_enum.processing);

    await service.refundPayment('tx-1', 15000, 'cliente');

    expect(orderHistory.record).not.toHaveBeenCalled();
  });

  it('reembolso parcial: refund_resolved sin state_changed (la orden no cambia de estado)', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.completed);

    await service.refundPayment('tx-1', 15000, 'cliente');

    expect(orderHistory.record).toHaveBeenCalledTimes(1);
    expect(orderHistory.record.mock.calls[0][1].type).toBe('refund_resolved');
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });
});
