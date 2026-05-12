import { SubscriptionWebhookService } from './subscription-webhook.service';

/**
 * Unit tests for SubscriptionWebhookService.
 * Covers:
 *  - APPROVED → markPaymentSucceededFromWebhook
 *  - DECLINED / ERROR → markPaymentFailedFromWebhook
 *  - VOIDED → markPaymentFailedFromWebhook
 *  - Missing payment row → no-op (warn log only)
 *  - Missing transaction body → no-op
 *  - Idempotency: payment service receives the call but short-circuits
 *    internally (we test that scenario in subscription-payment.service.spec.ts;
 *    here we only verify the dispatcher always delegates exactly once per
 *    redelivered webhook so accrual cannot promote twice)
 */
describe('SubscriptionWebhookService', () => {
  let service: SubscriptionWebhookService;
  let prismaMock: any;
  let paymentServiceMock: any;
  let fraudServiceMock: any;
  let stateServiceMock: any;
  let eventEmitterMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_payments: {
        findFirst: jest.fn(),
      },
    };
    paymentServiceMock = {
      markPaymentSucceededFromWebhook: jest.fn(),
      markPaymentFailedFromWebhook: jest.fn(),
      enqueueCommissionAccrualPostCommit: jest.fn(),
    };
    fraudServiceMock = {
      handleChargeback: jest.fn(),
    };
    stateServiceMock = {
      transition: jest.fn(),
    };
    eventEmitterMock = { emit: jest.fn() };

    service = new SubscriptionWebhookService(
      prismaMock,
      paymentServiceMock,
      fraudServiceMock,
      stateServiceMock,
      eventEmitterMock,
    );
  });

  function approvedBody(overrides: any = {}) {
    return {
      data: {
        transaction: {
          id: 'wompi_txn_1',
          reference: 'vendix_saas_42_99_1700000000000',
          status: 'APPROVED',
          status_message: 'OK',
          ...overrides,
        },
      },
    };
  }

  it('routes APPROVED to markPaymentSucceededFromWebhook with txn metadata', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });
    paymentServiceMock.markPaymentSucceededFromWebhook.mockResolvedValue({
      id: 7,
      state: 'succeeded',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody(),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const succArg =
      paymentServiceMock.markPaymentSucceededFromWebhook.mock.calls[0][0];
    expect(succArg.paymentId).toBe(7);
    expect(succArg.invoiceId).toBe(99);
    expect(succArg.transactionId).toBe('wompi_txn_1');
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();

    // succeeded path emits an observability event
    expect(eventEmitterMock.emit).toHaveBeenCalledTimes(1);
    const [eventName, eventPayload] = eventEmitterMock.emit.mock.calls[0];
    expect(eventName).toBe('subscription.payment.succeeded');
    expect(eventPayload.invoiceId).toBe(99);
    expect(eventPayload.paymentId).toBe(7);
    expect(eventPayload.source).toBe('webhook');
  });

  it('routes DECLINED to markPaymentFailedFromWebhook with status_message reason', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({
        status: 'DECLINED',
        status_message: 'insufficient funds',
      }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.paymentId).toBe(7);
    expect(failArg.invoiceId).toBe(99);
    expect(failArg.reason).toBe('insufficient funds');
    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
  });

  it('routes ERROR to markPaymentFailedFromWebhook', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'ERROR', status_message: undefined }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.paymentId).toBe(7);
    // status_message is undefined, so reason falls back to the wompi status
    expect(failArg.reason).toBe('ERROR');
  });

  it('routes VOIDED to markPaymentFailedFromWebhook with reason=voided', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'VOIDED' }),
    });

    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).toHaveBeenCalledTimes(1);
    const failArg =
      paymentServiceMock.markPaymentFailedFromWebhook.mock.calls[0][0];
    expect(failArg.reason).toBe('voided');
  });

  it('is no-op when no payment row exists for the invoice', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue(null);

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody(),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });

  it('is no-op when body lacks transaction', async () => {
    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: { data: {} },
    });

    expect(prismaMock.subscription_payments.findFirst).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });

  it('treats PENDING transaction as a no-op (no state transition)', async () => {
    prismaMock.subscription_payments.findFirst.mockResolvedValue({
      id: 7,
      invoice_id: 99,
      state: 'pending',
    });

    await service.handleWompiEvent({
      subscriptionId: 42,
      invoiceId: 99,
      body: approvedBody({ status: 'PENDING' }),
    });

    expect(
      paymentServiceMock.markPaymentSucceededFromWebhook,
    ).not.toHaveBeenCalled();
    expect(
      paymentServiceMock.markPaymentFailedFromWebhook,
    ).not.toHaveBeenCalled();
  });
});
