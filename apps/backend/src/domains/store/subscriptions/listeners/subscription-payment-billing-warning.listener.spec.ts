import { SubscriptionPaymentBillingWarningListener } from './subscription-payment-billing-warning.listener';
import { Prisma } from '@prisma/client';

describe('SubscriptionPaymentBillingWarningListener', () => {
  function buildListener() {
    const billingCreate = jest.fn();
    const invoiceFindFirst = jest.fn().mockResolvedValue(null);
    const prismaMock = {
      billing_warning_logs: {
        create: billingCreate,
      },
      subscription_invoices: {
        findFirst: invoiceFindFirst,
      },
    } as any;

    const notificationsServiceMock = {
      createAndBroadcast: jest.fn().mockResolvedValue(undefined),
    } as any;

    const emailQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'email-job-1' }),
    } as any;

    const listener = new SubscriptionPaymentBillingWarningListener(
      prismaMock,
      notificationsServiceMock,
      emailQueueMock,
    );

    return {
      listener,
      billingCreate,
      invoiceFindFirst,
      notificationsServiceMock,
      emailQueueMock,
    };
  }

  it('stamps dedupe row + broadcasts bell + enqueues email on first insert', async () => {
    const { listener, billingCreate, notificationsServiceMock, emailQueueMock } =
      buildListener();
    billingCreate.mockResolvedValueOnce({ id: 1 });

    await listener.onNoCredential({
      subscriptionEventId: 9991,
      storeId: 42,
      paymentId: 77,
      source: 'self',
    });

    expect(billingCreate).toHaveBeenCalledTimes(1);
    expect(billingCreate).toHaveBeenCalledWith({
      data: {
        store_id: 42,
        type: 'auto_renew_disabled_no_credential',
        source_event_id: 9991,
      },
    });

    expect(notificationsServiceMock.createAndBroadcast).toHaveBeenCalledTimes(1);
    const [storeId, type, title, body, data] =
      notificationsServiceMock.createAndBroadcast.mock.calls[0];
    expect(storeId).toBe(42);
    expect(type).toBe('auto_renew_disabled_no_credential');
    expect(title).toBe('Tu plan requiere pago manual');
    expect(body).toContain('Deberás pagar cada período manualmente');
    expect(data).toMatchObject({
      subscriptionEventId: 9991,
      route: '/admin/subscription/payment',
    });

    expect(emailQueueMock.add).toHaveBeenCalledTimes(1);
    const [jobName, jobData] = emailQueueMock.add.mock.calls[0];
    expect(jobName).toBe('subscription.billing.no-credential.email');
    expect(jobData).toEqual({
      storeId: 42,
      subscriptionEventId: 9991,
      invoiceId: undefined,
      amount: null,
      dueAt: null,
    });
  });

  it('enriches notification and email with invoice details when present', async () => {
    const {
      listener,
      billingCreate,
      invoiceFindFirst,
      notificationsServiceMock,
      emailQueueMock,
    } = buildListener();
    billingCreate.mockResolvedValueOnce({ id: 1 });
    invoiceFindFirst.mockResolvedValueOnce({
      id: 19,
      total: new Prisma.Decimal(69900),
      currency: 'COP',
      due_at: new Date('2026-08-27'),
    });

    await listener.onNoCredential({
      subscriptionEventId: 9991,
      storeId: 42,
      paymentId: 77,
      source: 'self',
    });

    expect(notificationsServiceMock.createAndBroadcast).toHaveBeenCalledTimes(1);
    const [storeId, type, title, body, data] =
      notificationsServiceMock.createAndBroadcast.mock.calls[0];
    expect(title).toContain('69.900');
    expect(body).toContain('69.900');
    expect(data).toMatchObject({
      subscriptionEventId: 9991,
      invoiceId: 19,
      route: '/admin/subscription/payment',
    });

    expect(emailQueueMock.add).toHaveBeenCalledWith(
      'subscription.billing.no-credential.email',
      expect.objectContaining({
        storeId: 42,
        subscriptionEventId: 9991,
        invoiceId: 19,
        amount: 69900,
      }),
      expect.any(Object),
    );
  });

  it('skips bell + email on P2002 (dedupe already recorded)', async () => {
    const { listener, billingCreate, notificationsServiceMock, emailQueueMock } =
      buildListener();
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique violation', {
      code: 'P2002',
      clientVersion: 'test',
    });
    billingCreate.mockRejectedValueOnce(p2002);

    await listener.onNoCredential({
      subscriptionEventId: 9991,
      storeId: 42,
      paymentId: 77,
    });

    expect(notificationsServiceMock.createAndBroadcast).not.toHaveBeenCalled();
    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });

  it('still enqueues email if bell broadcast throws', async () => {
    const { listener, billingCreate, notificationsServiceMock, emailQueueMock } =
      buildListener();
    billingCreate.mockResolvedValueOnce({ id: 1 });
    notificationsServiceMock.createAndBroadcast.mockRejectedValueOnce(
      new Error('sse exploded'),
    );

    await listener.onNoCredential({
      subscriptionEventId: 9991,
      storeId: 42,
      paymentId: 77,
    });

    expect(emailQueueMock.add).toHaveBeenCalledTimes(1);
  });

  it('drops the event when payload is invalid', async () => {
    const { listener, billingCreate, notificationsServiceMock, emailQueueMock } =
      buildListener();

    await listener.onNoCredential({
      subscriptionEventId: undefined as any,
      storeId: 42,
      paymentId: 77,
    });

    await listener.onNoCredential({
      subscriptionEventId: 9991,
      storeId: undefined as any,
      paymentId: 77,
    });

    expect(billingCreate).not.toHaveBeenCalled();
    expect(notificationsServiceMock.createAndBroadcast).not.toHaveBeenCalled();
    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });

  it('swallows non-P2002 errors so the charge path is never broken', async () => {
    const { listener, billingCreate } = buildListener();
    billingCreate.mockRejectedValueOnce(new Error('db down'));

    // Should resolve without throwing — the outer try/catch in the listener
    // catches everything and logs.
    await expect(
      listener.onNoCredential({
        subscriptionEventId: 9991,
        storeId: 42,
        paymentId: 77,
      }),
    ).resolves.toBeUndefined();
  });
});
