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

  const build = (
    refundState: refunds_state_enum,
    opts: { refundAmount?: number; orderState?: string } = {},
  ) => {
    const refundAmount = opts.refundAmount ?? 15000;
    const prisma: any = {
      payments: {
        findFirst: jest.fn().mockResolvedValue({ id: PAYMENT_ID, order_id: ORDER_ID }),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({
          id: REFUND_ID,
          order_id: ORDER_ID,
          payment_id: PAYMENT_ID,
          amount: refundAmount,
          state: refundState,
          refund_transaction_id: 'gw-rf-1',
          reason: 'cliente',
        }),
      },
      orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: ORDER_ID,
          store_id: STORE_ID,
          state: opts.orderState ?? 'delivered',
          grand_total: 30000,
          payments: [{ id: PAYMENT_ID, state: 'succeeded', amount: 30000 }],
          refunds: [{ id: REFUND_ID, state: refundState, amount: refundAmount }],
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
      amount: refundAmount,
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

  const refundCreated = (state: refunds_state_enum, amount = '15000') => ({
    orderId: ORDER_ID,
    storeId: STORE_ID,
    organizationId: 8,
    type: 'refund_created',
    paymentId: PAYMENT_ID,
    amount,
    payload: {
      reason: 'cliente',
      refund_id: REFUND_ID,
      refund_method: 'original_payment',
      initial_state: state,
      payout_channel: 'gateway',
    },
  });

  it('reembolso processing (pasarela pending): registra refund_created, sin refund_resolved ni transición', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.processing, {
      refundAmount: 30000,
    });

    await service.refundPayment('tx-1', 30000, 'cliente');

    expect(orderHistory.record.mock.calls.map(([, e]) => e)).toEqual([
      refundCreated(refunds_state_enum.processing, '30000'),
    ]);
    // Un reembolso total pero aún `processing` no cuenta como devuelto.
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });

  it('reembolso parcial completed: refund_created + refund_resolved, sin state_changed', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.completed);

    await service.refundPayment('tx-1', 15000, 'cliente');

    expect(orderHistory.record.mock.calls.map(([, e]) => e.type)).toEqual([
      'refund_created',
      'refund_resolved',
    ]);
    expect(orderHistory.record.mock.calls[0][1]).toEqual(
      refundCreated(refunds_state_enum.completed),
    );
    expect(prisma.orders.update).not.toHaveBeenCalled();
  });

  it('reembolso total completed: la orden pasa a refunded y registra state_changed delivered→refunded', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.completed, {
      refundAmount: 30000,
    });

    await service.refundPayment('tx-1', 30000, 'cliente');

    expect(prisma.orders.update).toHaveBeenCalledTimes(1);
    expect(prisma.orders.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { state: 'refunded', updated_at: expect.any(Date) },
    });
    expect(orderHistory.record.mock.calls.map(([, e]) => e.type)).toEqual([
      'refund_created',
      'refund_resolved',
      'state_changed',
    ]);
    expect(orderHistory.record.mock.calls[2]).toEqual([
      prisma,
      {
        orderId: ORDER_ID,
        storeId: STORE_ID,
        organizationId: 8,
        type: 'state_changed',
        fromState: 'delivered',
        toState: 'refunded',
      },
    ]);
  });

  it('reembolso total failed: no cuenta como devuelto, sin transición', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.failed, {
      refundAmount: 30000,
    });

    await service.refundPayment('tx-1', 30000, 'cliente');

    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(orderHistory.record.mock.calls.map(([, e]) => e.type)).toEqual([
      'refund_created',
      'refund_resolved',
    ]);
  });

  it('orden ya refunded: no re-escribe ni duplica state_changed', async () => {
    const { prisma, orderHistory, service } = build(refunds_state_enum.completed, {
      refundAmount: 30000,
      orderState: 'refunded',
    });

    await service.refundPayment('tx-1', 30000, 'cliente');

    expect(prisma.orders.update).not.toHaveBeenCalled();
    expect(
      orderHistory.record.mock.calls.some(([, e]) => e.type === 'state_changed'),
    ).toBe(false);
  });
});
