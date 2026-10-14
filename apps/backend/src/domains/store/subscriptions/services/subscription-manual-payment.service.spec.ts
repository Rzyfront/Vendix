import { Prisma } from '@prisma/client';
import { SubscriptionManualPaymentService } from './subscription-manual-payment.service';
import { VendixHttpException } from '../../../../common/errors';

describe('SubscriptionManualPaymentService.recordManualPayment', () => {
  const build = (invoice: any) => {
    const order: string[] = [];
    const tx: any = {
      $queryRaw: jest.fn().mockImplementation(async () => {
        order.push('lock');
        return [{ id: 13 }];
      }),
      subscription_invoices: {
        findUnique: jest.fn().mockImplementation(async () => {
          order.push('find');
          return invoice;
        }),
        update: jest.fn(),
      },
      subscription_payments: { create: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const svc = new SubscriptionManualPaymentService(
      prisma,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
    );
    return { svc, tx, order };
  };
  const opts = {
    bankReference: 'REF',
    paidAt: new Date(),
    amount: new Prisma.Decimal(100),
    recordedByUserId: 1,
  };

  it('locks the invoice row (FOR UPDATE) before reading it, and rejects a paid invoice without creating a payment', async () => {
    const h = build({ id: 13, state: 'paid', total: 100 });
    let err: any;
    try {
      await h.svc.recordManualPayment(13, opts);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.getResponse().error_code).toBe('SUBSCRIPTION_010');
    expect(h.order).toEqual(['lock', 'find']);
    expect(h.tx.subscription_payments.create).not.toHaveBeenCalled();
  });
});
