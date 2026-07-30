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
  let paymentsFindFirst: jest.Mock;
  let subsFindUnique: jest.Mock;
  let executeRaw: jest.Mock;
  let paymentServiceMock: any;
  let fraudServiceMock: any;
  let stateServiceMock: any;
  let eventEmitterMock: any;

  beforeEach(() => {
    // The service reaches Prisma exclusively through `withoutScope()` and does
    // all writes inside `$transaction`. The transaction client shares the SAME
    // jest.fn instances as the top-level mock so assertions can be written
    // against either surface.
    paymentsFindFirst = jest.fn();
    subsFindUnique = jest.fn();
    // `$executeRaw` returns the affected-row count of the dedup
    // `INSERT ... ON CONFLICT DO NOTHING`: 1 = first delivery, 0 = duplicate.
    executeRaw = jest.fn().mockResolvedValue(1);

    const txMock = {
      $executeRaw: executeRaw,
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
    };

    const unscopedMock = {
      $transaction: jest.fn(async (cb: any) => cb(txMock)),
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
    };

    prismaMock = {
      withoutScope: () => unscopedMock,
      subscription_payments: { findFirst: paymentsFindFirst },
      store_subscriptions: { findUnique: subsFindUnique },
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

  describe('chargeback → lock_reason', () => {
    function chargebackBody(overrides: any = {}) {
      return {
        event: 'nu.dispute.created',
        id: 'evt_dispute_1',
        data: {
          transaction: {
            id: 'wompi_txn_1',
            status: 'REFUNDED',
            status_message: 'chargeback recibido',
            amount_in_cents: 500000,
            ...overrides,
          },
        },
      };
    }

    beforeEach(() => {
      subsFindUnique.mockResolvedValue({
        id: 42,
        store_id: 10,
        state: 'active',
        store: { organization_id: 5 },
      });
    });

    it("suspends with lockReason='chargeback' so the column is not left at the 'admin_manual' default", async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).toHaveBeenCalledTimes(1);
      const [storeId, toState, opts] =
        stateServiceMock.transition.mock.calls[0];
      expect(storeId).toBe(10);
      expect(toState).toBe('suspended');

      // `lockReason` is the value persisted to `store_subscriptions.lock_reason`.
      // SubscriptionStateService applies `opts.lockReason ?? 'admin_manual'` for
      // suspended/blocked, so omitting it silently mislabels a real chargeback
      // as a manual admin action. Passing `reason` alone is NOT enough — it only
      // lands in `subscription_events.payload.reason`.
      expect(opts.lockReason).toBe('chargeback');
      expect(opts.lockReason).not.toBe('admin_manual');
      expect(opts.reason).toBe('chargeback');
    });

    it('still bumps the org chargeback counter after suspending', async () => {
      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(fraudServiceMock.handleChargeback).toHaveBeenCalledTimes(1);
      const [orgId, args] = fraudServiceMock.handleChargeback.mock.calls[0];
      expect(orgId).toBe(5);
      expect(args.storeId).toBe(10);
      expect(args.invoiceId).toBe(99);
    });

    it('does not re-transition a subscription already suspended', async () => {
      subsFindUnique.mockResolvedValue({
        id: 42,
        store_id: 10,
        state: 'suspended',
        store: { organization_id: 5 },
      });

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).not.toHaveBeenCalled();
      // bookkeeping must still run
      expect(fraudServiceMock.handleChargeback).toHaveBeenCalledTimes(1);
    });

    it('skips entirely on a duplicate chargeback delivery', async () => {
      executeRaw.mockResolvedValue(0); // dedup row already present

      await service.handleWompiEvent({
        subscriptionId: 42,
        invoiceId: 99,
        body: chargebackBody(),
      });

      expect(stateServiceMock.transition).not.toHaveBeenCalled();
      expect(fraudServiceMock.handleChargeback).not.toHaveBeenCalled();
    });
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
