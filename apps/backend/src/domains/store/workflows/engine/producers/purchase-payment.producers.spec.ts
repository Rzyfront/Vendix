import { Prisma } from '@prisma/client';
import { PurchaseOrdersService } from '../../../orders/purchase-orders/purchase-orders.service';
import { recordTriggerEvent } from '../workflow-trigger.outbox';
import { runAsStoreAdmin, transactionOf } from './producers.test-util';

jest.mock('../workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(true),
}));

const record = recordTriggerEvent as jest.Mock;

describe('Flujos P1.1 producer: supplier_payment.registered (PurchaseOrdersService.registerPayment)', () => {
  const build = () => {
    const tx = {
      purchase_order_payments: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        create: jest.fn().mockResolvedValue({
          id: 31,
          amount: new Prisma.Decimal(300),
          payment_method: 'transfer',
          payment_date: new Date('2026-11-05T00:00:00Z'),
        }),
      },
      accounts_payable: { findFirst: jest.fn().mockResolvedValue(null) },
      purchase_orders: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: transactionOf(tx),
      purchase_orders: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12,
          supplier_id: 77,
          total_amount: new Prisma.Decimal(1000),
          location: { store_id: 11 },
          suppliers: { id: 77 },
        }),
      },
    };
    const audit = { logCustom: jest.fn().mockResolvedValue(undefined) };
    const service = Object.assign(
      Object.create(PurchaseOrdersService.prototype) as PurchaseOrdersService,
      {
        prisma,
        auditService: audit,
        logger: { error: jest.fn() },
        recalculatePaymentStatus: jest.fn().mockResolvedValue('partial'),
        emitPurchaseOrderPaymentEvent: jest.fn().mockResolvedValue(undefined),
      },
    );
    return { tx, service };
  };
  const dto = {
    amount: 300,
    payment_date: '2026-11-05',
    payment_method: 'transfer',
  };

  beforeEach(() => record.mockClear());

  it('records the event with the transaction that inserted the payment', async () => {
    const { tx, service } = build();
    await runAsStoreAdmin(() => service.registerPayment(12, dto as never));
    expect(record).toHaveBeenCalledWith(tx, 'supplier_payment.registered', {
      store_id: 11,
      payment_id: 31,
      purchase_order_id: 12,
      supplier_id: 77,
      amount: new Prisma.Decimal(300),
      payment_method: 'transfer',
    });
  });

  it('does not announce the payment to accounting when the outbox write fails', async () => {
    const { service } = build();
    record.mockRejectedValueOnce(new Error('outbox down'));
    await expect(
      runAsStoreAdmin(() => service.registerPayment(12, dto as never)),
    ).rejects.toThrow('outbox down');
    expect(
      (service as unknown as { emitPurchaseOrderPaymentEvent: jest.Mock })
        .emitPurchaseOrderPaymentEvent,
    ).not.toHaveBeenCalled();
  });
});
