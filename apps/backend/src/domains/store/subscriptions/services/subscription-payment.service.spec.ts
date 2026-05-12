import { Prisma } from '@prisma/client';
import {
  SubscriptionPaymentService,
  MAX_CONSECUTIVE_FAILURES,
} from './subscription-payment.service';
import { VendixHttpException } from '../../../../common/errors';
import { PlatformGatewayEnvironmentEnum } from '../../../superadmin/subscriptions/gateway/dto/upsert-gateway.dto';

/**
 * Unit tests for SubscriptionPaymentService.
 * Focus: charge happy path (SaaS gateway path), gateway failure, partner
 * commission side-effect on handleChargeSuccess, idempotency key shape, and
 * PlatformGatewayService credential resolution.
 */
describe('SubscriptionPaymentService', () => {
  let service: SubscriptionPaymentService;
  let prismaMock: any;
  let gatewayMock: any;
  let billingMock: any;
  let commissionsMock: any;
  let stateServiceMock: any;
  let configMock: any;
  let eventEmitterMock: any;
  let platformGwMock: any;
  let wompiProcessorMock: any;
  let commissionQueueMock: any;
  let emailQueueMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_invoices: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_payments: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      subscription_payment_methods: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
      },
      partner_commissions: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      commission_accrual_pending: {
        upsert: jest.fn(),
      },
      store_subscriptions: {
        findUnique: jest.fn().mockResolvedValue({ state: 'pending_payment' }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    gatewayMock = {
      processPayment: jest.fn(),
      refundPayment: jest.fn(),
      getPaymentStatus: jest.fn(),
    };
    billingMock = {};
    commissionsMock = {};
    stateServiceMock = {
      transitionInTx: jest.fn(),
      transition: jest.fn(),
    };
    configMock = { get: jest.fn() };
    eventEmitterMock = { emit: jest.fn() };
    platformGwMock = {
      getActiveCredentials: jest.fn().mockResolvedValue({
        public_key: 'pub_test',
        private_key: 'priv_test',
        events_secret: 'events_test',
        integrity_secret: 'integ_test',
        environment: PlatformGatewayEnvironmentEnum.SANDBOX,
      }),
    };
    wompiProcessorMock = {
      processPayment: jest.fn(),
    };
    const wompiClientFactoryMock = {
      getClient: jest.fn().mockReturnValue({
        getTransactionsByReference: jest.fn().mockResolvedValue({ data: [] }),
      }),
    };
    commissionQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };
    emailQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'email-123' }),
    };

    const resolverMock = { invalidate: jest.fn().mockResolvedValue(undefined) };

    service = new SubscriptionPaymentService(
      prismaMock,
      gatewayMock,
      billingMock,
      commissionsMock,
      stateServiceMock,
      resolverMock as any,
      configMock,
      eventEmitterMock,
      platformGwMock,
      wompiProcessorMock,
      wompiClientFactoryMock as any,
      commissionQueueMock,
      emailQueueMock,
    );
  });

  function invoiceFixture(overrides: any = {}) {
    return {
      id: 500,
      store_id: 10,
      store_subscription_id: 200,
      invoice_number: 'SAAS-20260423-00001',
      state: 'issued',
      total: new Prisma.Decimal(100),
      currency: 'USD',
      partner_organization_id: null,
      split_breakdown: null,
      ...overrides,
    };
  }

  it('charge happy path → creates subscription_payment state=succeeded', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 77 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 77,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_abc',
      gatewayResponse: { foo: 'bar' },
    });

    const result = await service.charge(500);

    expect(wompiProcessorMock.processPayment).toHaveBeenCalled();
    expect(platformGwMock.getActiveCredentials).toHaveBeenCalledWith('wompi');
    // SaaS path bypasses the per-store registry
    expect(gatewayMock.processPayment).not.toHaveBeenCalled();
    const updateArg = prismaMock.subscription_payments.update.mock.calls[0][0];
    expect(updateArg.where.id).toBe(77);
    expect(updateArg.data.state).toBe('succeeded');
    expect(updateArg.data.gateway_reference).toBe('tx_abc');
    expect(result.state).toBe('succeeded');
  });

  it('handleChargeSuccess preserves existing payment metadata when storing gateway_response', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 77 });
    prismaMock.subscription_payments.findUnique.mockResolvedValue({
      metadata: {
        idempotency_key: 'sub_inv_500_att_1',
        reference: 'vendix_saas_200_500_123',
        saved_payment_method_id: 33,
      },
    });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 77,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_abc',
      gatewayResponse: { status: 'APPROVED' },
    });

    await service.charge(500);

    const updateArg = prismaMock.subscription_payments.update.mock.calls[0][0];
    expect(updateArg.data.metadata).toMatchObject({
      idempotency_key: 'sub_inv_500_att_1',
      reference: 'vendix_saas_200_500_123',
      saved_payment_method_id: 33,
      gateway_response: { status: 'APPROVED' },
    });
  });

  it('gateway failure → payment state=failed with failure_reason + event emitted', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 78 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 78,
      state: 'failed',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: false,
      message: 'Insufficient funds',
    });

    const result = await service.charge(500);

    const updateArg = prismaMock.subscription_payments.update.mock.calls[0][0];
    expect(updateArg.data.state).toBe('failed');
    expect(updateArg.data.failure_reason).toBe('Insufficient funds');

    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'subscription.payment.failed',
      { invoiceId: 500, paymentId: 78, reason: 'Insufficient funds' },
    );
    expect(result.state).toBe('failed');
  });

  it('handleChargeSuccess inserts commission_accrual_pending outbox row for partner invoices', async () => {
    // Outbox pattern (ADR): on payment success, a commission_accrual_pending row is
    // inserted atomically with the invoice-paid update. The async worker processes it later.
    const invoiceWithPartner = invoiceFixture({
      partner_organization_id: 42,
      currency: 'COP',
      split_breakdown: {
        vendix_share: '100.00',
        partner_share: '20.00',
        margin_pct_used: '20.00',
        partner_org_id: 42,
      },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceWithPartner,
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 79 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 79,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_xyz',
    });

    await service.charge(500);

    const upsertArg =
      prismaMock.commission_accrual_pending.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ invoice_id: 500 });
    expect(upsertArg.create.invoice_id).toBe(500);
    expect(upsertArg.create.partner_organization_id).toBe(42);
    expect(upsertArg.create.currency).toBe('COP');
    expect(upsertArg.create.state).toBe('pending');
    expect(String(upsertArg.create.amount)).toBe('20');
    expect(upsertArg.update).toEqual({});
  });

  it('commission_accrual_pending outbox is idempotent: P2002 on duplicate upsert is swallowed', async () => {
    const invoiceWithPartner = invoiceFixture({
      partner_organization_id: 42,
      split_breakdown: { vendix_share: '100.00', partner_share: '20.00' },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceWithPartner,
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 80 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 80,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    const p2002 = Object.assign(new Error('Unique constraint'), {
      code: 'P2002',
    });
    prismaMock.commission_accrual_pending.upsert.mockRejectedValue(p2002);
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_next',
    });

    // Should NOT throw despite P2002 — outbox is designed to be idempotent
    const result = await service.charge(500);

    expect(result.state).toBe('succeeded');
    expect(prismaMock.commission_accrual_pending.upsert).toHaveBeenCalled();
  });

  it('commission outbox skipped when partner_share is zero', async () => {
    const invoiceNoCommission = invoiceFixture({
      partner_organization_id: 42,
      split_breakdown: { vendix_share: '100.00', partner_share: '0.00' },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceNoCommission,
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 81 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 81,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_zero',
    });

    await service.charge(500);

    // No outbox row when partner_share = 0 (nothing to accrue)
    expect(prismaMock.commission_accrual_pending.upsert).not.toHaveBeenCalled();
  });

  it('handleChargeSuccess swallows P2002 from concurrent upsert and continues', async () => {
    const invoiceWithPartner = invoiceFixture({
      partner_organization_id: 42,
      split_breakdown: {
        vendix_share: '100.00',
        partner_share: '20.00',
        margin_pct_used: '20.00',
        partner_org_id: 42,
      },
    });
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceWithPartner,
    );
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 82 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 82,
      state: 'succeeded',
    });
    prismaMock.partner_commissions.updateMany.mockResolvedValue({ count: 0 });
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    prismaMock.partner_commissions.upsert.mockRejectedValue(p2002);
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_p2002',
    });

    const result = await service.charge(500);
    expect(result.state).toBe('succeeded');
  });

  // ── SaaS billing path: PlatformGatewayService + idempotency ──────

  it('uses stable idempotency key sub_inv_<id>_att_1 when no previous payments exist', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.count.mockResolvedValue(0);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 100 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 100,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_first',
    });

    await service.charge(500);

    const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
    expect(processArg.idempotencyKey).toBe('sub_inv_500_att_1');

    // The idempotency key is also persisted in subscription_payments.metadata
    const createArg = prismaMock.subscription_payments.create.mock.calls[0][0];
    expect(createArg.data.metadata.idempotency_key).toBe('sub_inv_500_att_1');
    expect(createArg.data.metadata.attempt).toBe(1);
  });

  it('idempotency key advances to att_2 when one previous payment exists', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.count.mockResolvedValue(1);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 101 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 101,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_retry',
    });

    await service.charge(500);

    const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
    expect(processArg.idempotencyKey).toBe('sub_inv_500_att_2');
  });

  it('builds SaaS reference vendix_saas_<subId>_<invoiceId>_<ts> in metadata', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.count.mockResolvedValue(0);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 102 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 102,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_ref',
    });

    await service.charge(500);

    const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
    expect(processArg.metadata.reference).toMatch(/^vendix_saas_200_500_\d+$/);
    expect(processArg.metadata.subscription_payment).toBe(true);
    expect(processArg.metadata.subscriptionId).toBe(200);
    expect(processArg.metadata.invoiceId).toBe(500);
  });

  it('injects platform wompiConfig into metadata so the processor uses platform creds', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payments.count.mockResolvedValue(0);
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 103 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 103,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_creds',
    });

    await service.charge(500);

    const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
    expect(processArg.metadata.wompiConfig).toMatchObject({
      public_key: 'pub_test',
      private_key: 'priv_test',
      events_secret: 'events_test',
      integrity_secret: 'integ_test',
    });
  });

  it('throws SUBSCRIPTION_GATEWAY_003 when platform credentials are not configured', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    platformGwMock.getActiveCredentials.mockResolvedValue(null);

    await expect(service.charge(500)).rejects.toBeInstanceOf(
      VendixHttpException,
    );

    // Ensure no payment record was created and no charge attempted
    expect(prismaMock.subscription_payments.create).not.toHaveBeenCalled();
    expect(wompiProcessorMock.processPayment).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // S3.5 — Consecutive-failures lifecycle on saved payment methods.
  //
  // Flow exercised:
  //   - charge() resolves a reusable PM, calls Wompi, then on success or
  //     failure mutates the PM counter accordingly.
  //   - On failure: counter increments. At MAX_CONSECUTIVE_FAILURES the PM is
  //     auto-invalidated, a state_transition event is persisted, and a
  //     payment-method-invalidated-failures email is enqueued.
  //   - On success: counter resets to 0 (idempotent NOOP if already 0).
  // -----------------------------------------------------------------------

  function pmFixture(overrides: any = {}) {
    return {
      id: 7001,
      store_id: 10,
      store_subscription_id: 200,
      type: 'card',
      provider: 'wompi',
      provider_token: 'tok_xyz',
      last4: '4242',
      brand: 'visa',
      expiry_month: '12',
      expiry_year: '2099',
      card_holder: null,
      is_default: true,
      state: 'active',
      consecutive_failures: 0,
      replaced_by_id: null,
      replaced_at: null,
      metadata: null,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
      ...overrides,
    };
  }

  it('S3.5: PM with consecutive_failures=2 → on failure becomes invalid + emits event + enqueues email', async () => {
    const pm = pmFixture({ consecutive_failures: 2, is_default: true });

    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture({ store_id: 10 }),
    );
    prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
    // Inside bumpPaymentMethodFailure — re-fetch + (no other PM to promote)
    prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.update.mockResolvedValue({});
    prismaMock.subscription_payment_methods.updateMany.mockResolvedValue({
      count: 0,
    });
    prismaMock.subscription_events.create.mockResolvedValue({ id: 1 });

    prismaMock.subscription_payments.create.mockResolvedValue({ id: 900 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 900,
      state: 'failed',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: false,
      message: 'Declined',
    });

    await service.charge(500);

    // The PM update setting state='invalid' must be issued.
    const calls = prismaMock.subscription_payment_methods.update.mock.calls;
    const invalidateCall = calls.find(
      (c: any) => c[0]?.data?.state === 'invalid',
    );
    expect(invalidateCall).toBeDefined();
    expect(invalidateCall[0].data.consecutive_failures).toBe(
      MAX_CONSECUTIVE_FAILURES,
    );
    expect(invalidateCall[0].data.is_default).toBe(false);

    // A state_transition event with reason=consecutive_failures_threshold.
    expect(prismaMock.subscription_events.create).toHaveBeenCalled();
    const evt = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(evt.data.type).toBe('state_transition');
    expect(evt.data.payload.reason).toBe('consecutive_failures_threshold');
    expect(evt.data.payload.payment_method_id).toBe(pm.id);
    expect(evt.data.payload.consecutive_failures).toBe(
      MAX_CONSECUTIVE_FAILURES,
    );

    // Email enqueued with the PM context.
    expect(emailQueueMock.add).toHaveBeenCalledWith(
      'subscription.payment-method-invalidated-failures.email',
      expect.objectContaining({
        subscriptionId: pm.store_subscription_id,
        storeId: pm.store_id,
        paymentMethodId: pm.id,
        consecutive_failures: MAX_CONSECUTIVE_FAILURES,
      }),
      expect.any(Object),
    );

    // In-process domain event for banner cache bust.
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'payment_method.invalidated',
      expect.objectContaining({
        paymentMethodId: pm.id,
        reason: 'consecutive_failures',
      }),
    );
  });

  it('S3.5: PM with consecutive_failures=2 → on success resets counter to 0 (no invalidation)', async () => {
    const pm = pmFixture({ consecutive_failures: 2 });

    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.update.mockResolvedValue({});
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 901 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 901,
      state: 'succeeded',
    });
    prismaMock.subscription_invoices.update.mockResolvedValue({});
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_ok',
    });

    await service.charge(500);

    const calls = prismaMock.subscription_payment_methods.update.mock.calls;
    const resetCall = calls.find(
      (c: any) => c[0]?.data?.consecutive_failures === 0,
    );
    expect(resetCall).toBeDefined();
    expect(resetCall[0].where.id).toBe(pm.id);
    // No invalidation, no event, no email.
    expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();
    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });

  it('S3.5: PM with consecutive_failures=0 → on failure bumps to 1, state stays active, no email', async () => {
    const pm = pmFixture({ consecutive_failures: 0 });

    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture(),
    );
    prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.update.mockResolvedValue({});
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 902 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 902,
      state: 'failed',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: false,
      message: 'Insufficient funds',
    });

    await service.charge(500);

    const calls = prismaMock.subscription_payment_methods.update.mock.calls;
    const bumpCall = calls.find(
      (c: any) => c[0]?.data?.consecutive_failures === 1,
    );
    expect(bumpCall).toBeDefined();
    // state field must NOT be touched on a sub-threshold bump.
    expect(bumpCall[0].data.state).toBeUndefined();
    expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();
    expect(emailQueueMock.add).not.toHaveBeenCalled();
  });

  it('S3.5: invalidating a default PM promotes the next active PM as new default', async () => {
    const pm = pmFixture({
      consecutive_failures: 2,
      is_default: true,
      id: 7001,
    });
    const otherActive = pmFixture({
      id: 7002,
      is_default: false,
      consecutive_failures: 0,
    });

    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture({ store_id: 10 }),
    );
    prismaMock.subscription_payment_methods.findFirst
      // 1st call: resolveReusablePaymentMethod → returns the failing PM
      .mockResolvedValueOnce(pm)
      // 2nd call: bumpPaymentMethodFailure tx → promotion candidate lookup
      .mockResolvedValueOnce({ id: otherActive.id });
    prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(pm);
    prismaMock.subscription_payment_methods.update.mockResolvedValue({});
    prismaMock.subscription_payment_methods.updateMany.mockResolvedValue({
      count: 1,
    });
    prismaMock.subscription_events.create.mockResolvedValue({ id: 1 });

    prismaMock.subscription_payments.create.mockResolvedValue({ id: 903 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 903,
      state: 'failed',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: false,
      message: 'Declined',
    });

    await service.charge(500);

    // The promotion update must target the other active PM with is_default=true.
    const updates = prismaMock.subscription_payment_methods.update.mock.calls;
    const promoteCall = updates.find(
      (c: any) =>
        c[0]?.where?.id === otherActive.id && c[0]?.data?.is_default === true,
    );
    expect(promoteCall).toBeDefined();

    // Defensive clear of any other defaults must run before the promote.
    expect(
      prismaMock.subscription_payment_methods.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { store_id: pm.store_id, is_default: true },
        data: expect.objectContaining({ is_default: false }),
      }),
    );

    // Event payload reports the promoted_default_id.
    const evt = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(evt.data.payload.promoted_default_id).toBe(otherActive.id);
    expect(evt.data.payload.was_default).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ADR-2: confirmPendingChange
  // ──────────────────────────────────────────────────────────────────────────

  describe('confirmPendingChange', () => {
    function pendingSubFixture(overrides: any = {}) {
      return {
        id: 200,
        store_id: 10,
        state: 'pending_payment',
        plan_id: 5,
        pending_plan_id: 7,
        pending_change_invoice_id: 500,
        pending_change_kind: 'upgrade',
        pending_change_started_at: new Date(),
        pending_revert_state: 'active',
        scheduled_plan_id: null,
        scheduled_plan_change_at: null,
        grace_soft_until: null,
        grace_hard_until: null,
        suspend_at: null,
        partner_override: null,
        plan: {
          id: 5,
          base_price: new Prisma.Decimal(100),
          max_partner_margin_pct: null,
        },
        ...overrides,
      };
    }

    function targetPlanFixture(overrides: any = {}) {
      return {
        id: 7,
        code: 'business',
        base_price: new Prisma.Decimal(200),
        billing_cycle: 'monthly',
        max_partner_margin_pct: null,
        partner_overrides: [],
        ...overrides,
      };
    }

    function invoiceForConfirm(overrides: any = {}) {
      return {
        id: 500,
        store_subscription_id: 200,
        to_plan_id: 7,
        from_plan_id: 5,
        change_kind: 'upgrade',
        ...overrides,
      };
    }

    function makeTxMock() {
      return {
        store_subscriptions: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(pendingSubFixture()),
          update: jest.fn().mockResolvedValue({ id: 200, state: 'active' }),
        },
        subscription_plans: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(targetPlanFixture()),
        },
      };
    }

    it('success: promotes plan, clears pending_* fields, transitions to active', async () => {
      const txMock = makeTxMock();
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
      stateServiceMock.transitionInTx = jest.fn().mockResolvedValue(undefined);

      await (service as any).confirmPendingChange(
        invoiceForConfirm(),
        txMock as any,
      );

      const updateArg = txMock.store_subscriptions.update.mock.calls[0][0];
      expect(updateArg.data.plan_id).toBe(7);
      expect(updateArg.data.paid_plan_id).toBe(7);
      expect(updateArg.data.pending_plan_id).toBeNull();
      expect(updateArg.data.pending_change_invoice_id).toBeNull();
      expect(updateArg.data.pending_change_kind).toBeNull();
      expect(updateArg.data.pending_revert_state).toBeNull();
      expect(stateServiceMock.transitionInTx).toHaveBeenCalledWith(
        txMock,
        10,
        'active',
        expect.objectContaining({
          reason: expect.stringContaining('plan_confirmed_invoice_500'),
        }),
      );
    });

    it('mismatch guard: pending_plan_id !== invoice.to_plan_id → returns without mutating', async () => {
      const subWithMismatch = pendingSubFixture({ pending_plan_id: 99 });
      const txMock = {
        store_subscriptions: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(subWithMismatch),
          update: jest.fn(),
        },
        subscription_plans: { findUniqueOrThrow: jest.fn() },
      };
      billingMock.computePricing = jest.fn();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ to_plan_id: 7 }),
        txMock as any,
      );

      expect(txMock.store_subscriptions.update).not.toHaveBeenCalled();
      expect(stateServiceMock.transitionInTx).not.toHaveBeenCalled();
    });

    it('no-op when pending_plan_id is null (already confirmed or fresh sub)', async () => {
      const cleanSub = pendingSubFixture({ pending_plan_id: null });
      const txMock = {
        store_subscriptions: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(cleanSub),
          update: jest.fn(),
        },
        subscription_plans: { findUniqueOrThrow: jest.fn() },
      };

      await (service as any).confirmPendingChange(
        invoiceForConfirm(),
        txMock as any,
      );

      expect(txMock.store_subscriptions.update).not.toHaveBeenCalled();
    });

    it('upgrade kind does NOT reset billing period', async () => {
      const txMock = makeTxMock();
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
      stateServiceMock.transitionInTx = jest.fn().mockResolvedValue(undefined);

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'upgrade' }),
        txMock as any,
      );

      const updateArg = txMock.store_subscriptions.update.mock.calls[0][0];
      // upgrade should NOT set current_period_start / current_period_end
      expect(updateArg.data.current_period_start).toBeUndefined();
      expect(updateArg.data.current_period_end).toBeUndefined();
    });

    it('initial/resubscribe kind DOES reset billing period', async () => {
      const txMock = makeTxMock();
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
      stateServiceMock.transitionInTx = jest.fn().mockResolvedValue(undefined);

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'initial' }),
        txMock as any,
      );

      const updateArg = txMock.store_subscriptions.update.mock.calls[0][0];
      expect(updateArg.data.current_period_start).toBeDefined();
      expect(updateArg.data.current_period_end).toBeDefined();
      expect(updateArg.data.next_billing_at).toBeDefined();
    });

    it('emits subscription.plan.changed event on successful confirm', async () => {
      const txMock = makeTxMock();
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
      stateServiceMock.transitionInTx = jest.fn().mockResolvedValue(undefined);

      await (service as any).confirmPendingChange(
        invoiceForConfirm(),
        txMock as any,
      );

      expect(eventEmitterMock.emit).toHaveBeenCalledWith(
        'subscription.plan.changed',
        expect.objectContaining({
          storeId: 10,
          fromPlanId: 5,
          toPlanId: 7,
          kind: 'upgrade',
          mode: 'committed',
          invoiceId: 500,
        }),
      );
    });

    it('invalidates resolver cache after confirm', async () => {
      const txMock = makeTxMock();
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
      stateServiceMock.transitionInTx = jest.fn().mockResolvedValue(undefined);

      // Access the resolver via service internals
      const resolverMock = (service as any).resolver;

      await (service as any).confirmPendingChange(
        invoiceForConfirm(),
        txMock as any,
      );

      expect(resolverMock.invalidate).toHaveBeenCalledWith(10);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ADR-2: handleChargeFailure reverts pending change
  // ──────────────────────────────────────────────────────────────────────────

  describe('handleChargeFailure pending-change revert', () => {
    it('clears pending_* fields and transitions to pending_revert_state when charge fails', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture({ id: 500 }),
      );
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 88 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 88,
        state: 'failed',
      });
      prismaMock.store_subscriptions.findFirst = jest.fn().mockResolvedValue({
        id: 200,
        store_id: 10,
        state: 'pending_payment',
        pending_revert_state: 'active',
      });
      prismaMock.store_subscriptions.update = jest
        .fn()
        .mockResolvedValue({ id: 200 });
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: false,
        message: 'Card declined',
      });

      await service.charge(500);

      // pending_* fields must be cleared
      const updateArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
      expect(updateArg.data.pending_plan_id).toBeNull();
      expect(updateArg.data.pending_change_invoice_id).toBeNull();
      expect(updateArg.data.pending_revert_state).toBeNull();

      // Must revert state
      expect(stateServiceMock.transitionInTx).toHaveBeenCalledWith(
        expect.anything(),
        10,
        'active',
        expect.objectContaining({
          reason: expect.stringContaining('payment_failed'),
        }),
      );
    });

    it('skips revert when no pending change linked to the invoice', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture({ id: 501 }),
      );
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 89 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 89,
        state: 'failed',
      });
      prismaMock.store_subscriptions.findFirst = jest
        .fn()
        .mockResolvedValue(null);
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: false,
        message: 'Error',
      });

      await service.charge(501);

      // No sub update, no state revert
      expect(stateServiceMock.transitionInTx).not.toHaveBeenCalled();
    });
  });

  // ── Wompi Phase 5: autoRegisterPaymentMethodFromGateway ──────────────
  //
  // Private method, exercised via the test through `(service as any)`. The
  // call site is `markPaymentSucceededFromWebhook` — already covered for the
  // happy path elsewhere; these tests focus on the new payment_source_id
  // extraction contract.

  describe('autoRegisterPaymentMethodFromGateway (Wompi Phase 5)', () => {
    let pmFindFirst: jest.Mock;
    let pmCreate: jest.Mock;
    let pmUpdateMany: jest.Mock;
    let pmUpdate: jest.Mock;
    let eventsCreate: jest.Mock;
    let txMock: any;

    beforeEach(() => {
      pmFindFirst = jest.fn();
      pmCreate = jest.fn();
      pmUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      pmUpdate = jest.fn().mockResolvedValue(undefined);
      eventsCreate = jest.fn().mockResolvedValue(undefined);
      txMock = {
        subscription_payment_methods: {
          findFirst: pmFindFirst,
          create: pmCreate,
          updateMany: pmUpdateMany,
          update: pmUpdate,
        },
        subscription_events: { create: eventsCreate },
      };
    });

    async function invoke(gatewayResponse: any) {
      // accessing private method for unit testing.
      return (service as any).autoRegisterPaymentMethodFromGateway(
        txMock,
        42,
        7,
        gatewayResponse,
        99,
      );
    }

    it('happy path: extracts payment_source.id and creates PM', async () => {
      pmFindFirst.mockResolvedValue(null);
      pmCreate.mockResolvedValue({ id: 555 });

      await invoke({
        payment_method: {
          type: 'CARD',
          extra: {
            last_four: '4242',
            brand: 'visa',
            exp_month: '12',
            exp_year: '2030',
          },
        },
        payment_source: { id: 99001 },
        acceptance_token: 'acc_xyz',
      });

      expect(pmCreate).toHaveBeenCalledTimes(1);
      const data = pmCreate.mock.calls[0][0].data;
      expect(data).toMatchObject({
        store_id: 42,
        store_subscription_id: 7,
        provider: 'wompi',
        provider_payment_source_id: '99001',
        provider_token: '99001',
        acceptance_token_used: 'acc_xyz',
        last4: '4242',
        brand: 'visa',
        is_default: true,
        state: 'active',
      });
      expect(data.cof_registered_at).toBeInstanceOf(Date);
      expect(eventsCreate).toHaveBeenCalledTimes(1);
    });

    it('also accepts top-level payment_source_id shape', async () => {
      pmFindFirst.mockResolvedValue(null);
      pmCreate.mockResolvedValue({ id: 556 });

      await invoke({
        payment_method: { type: 'CARD', extra: { last_four: '0001' } },
        payment_source_id: 88002,
      });

      expect(pmCreate).toHaveBeenCalledTimes(1);
      expect(pmCreate.mock.calls[0][0].data.provider_payment_source_id).toBe(
        '88002',
      );
    });

    it('no payment_source_id → no PM created, logs warning', async () => {
      pmFindFirst.mockResolvedValue(null);

      await invoke({
        payment_method: { type: 'CARD', extra: { last_four: '4242' } },
        // No payment_source / payment_source_id at all.
      });

      expect(pmCreate).not.toHaveBeenCalled();
      expect(eventsCreate).not.toHaveBeenCalled();
    });

    it('idempotent: repeated webhook delivery does not duplicate PM', async () => {
      // First call → no row, creates one.
      // Second call → finds existing, just refreshes updated_at.
      pmFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 555 });
      pmCreate.mockResolvedValue({ id: 555 });

      const gatewayResponse = {
        payment_method: { type: 'CARD', extra: { last_four: '4242' } },
        payment_source: { id: 99001 },
      };
      await invoke(gatewayResponse);
      await invoke(gatewayResponse);

      expect(pmCreate).toHaveBeenCalledTimes(1);
      expect(pmUpdate).toHaveBeenCalledTimes(1);
      expect(pmUpdate.mock.calls[0][0]).toMatchObject({
        where: { id: 555 },
      });
    });

    it('skips when payment_method.type is not CARD', async () => {
      await invoke({
        payment_method: { type: 'NEQUI' },
        payment_source: { id: 99001 },
      });

      expect(pmCreate).not.toHaveBeenCalled();
      expect(pmFindFirst).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Wompi Phase 6 — chargeInvoice routing (recurrent vs legacy) + revoke
  // ──────────────────────────────────────────────────────────────────────────
  describe('Wompi Phase 6 — chargeInvoice routing & revocation', () => {
    function pmWithPaymentSource(overrides: any = {}) {
      return {
        id: 8001,
        store_id: 10,
        store_subscription_id: 200,
        type: 'card',
        provider: 'wompi',
        provider_token: 'ps_99001',
        provider_payment_source_id: '99001',
        last4: '4242',
        brand: 'visa',
        expiry_month: '12',
        expiry_year: '2099',
        is_default: true,
        state: 'active',
        consecutive_failures: 0,
        replaced_at: null,
        metadata: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        ...overrides,
      };
    }
    function pmLegacyOnly(overrides: any = {}) {
      return {
        id: 8002,
        store_id: 10,
        store_subscription_id: 200,
        type: 'card',
        provider: 'wompi',
        provider_token: 'tok_legacy',
        provider_payment_source_id: null,
        last4: '5555',
        brand: 'mastercard',
        expiry_month: '12',
        expiry_year: '2099',
        is_default: true,
        state: 'active',
        consecutive_failures: 0,
        replaced_at: null,
        metadata: null,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        ...overrides,
      };
    }

    it('PM with provider_payment_source_id → metadata.payment_source_id sent, NO paymentMethod', async () => {
      const pm = pmWithPaymentSource();
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture(),
      );
      prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 950 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 950,
        state: 'succeeded',
      });
      prismaMock.subscription_invoices.update.mockResolvedValue({});
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'tx_recurrent',
      });

      await service.charge(500);

      const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
      expect(processArg.metadata.payment_source_id).toBe('99001');
      expect(processArg.metadata.paymentMethod).toBeUndefined();
      expect(processArg.metadata.saved_payment_method_id).toBe(pm.id);
      expect(processArg.metadata.customerEmail).toBe('saas-10@vendix.app');
    });

    it('legacy PM under flag=true → uses inline paymentMethod.token', async () => {
      const pm = pmLegacyOnly();
      jest
        .spyOn(service as any, 'legacyInlineTokenAllowed')
        .mockReturnValue(true);

      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture(),
      );
      prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 951 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 951,
        state: 'succeeded',
      });
      prismaMock.subscription_invoices.update.mockResolvedValue({});
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: true,
        transactionId: 'tx_legacy',
      });

      await service.charge(500);

      const processArg = wompiProcessorMock.processPayment.mock.calls[0][0];
      expect(processArg.metadata.payment_source_id).toBeUndefined();
      expect(processArg.metadata.paymentMethod).toMatchObject({
        type: 'CARD',
        token: 'tok_legacy',
        installments: 1,
      });
      expect(processArg.metadata.use_legacy_inline_token).toBe(true);
    });

    it('legacy PM under flag=false → throws PAYMENT_METHOD_NOT_MIGRATED', async () => {
      const pm = pmLegacyOnly();
      jest
        .spyOn(service as any, 'legacyInlineTokenAllowed')
        .mockReturnValue(false);

      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture(),
      );
      prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);

      await expect(service.charge(500)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      // No charge attempted, no payment row created (throw is pre-create).
      expect(wompiProcessorMock.processPayment).not.toHaveBeenCalled();
      expect(prismaMock.subscription_payments.create).not.toHaveBeenCalled();
    });

    it('errorCode=PAYMENT_SOURCE_REVOKED → marks PM invalid + counter=0 + replaced_at set', async () => {
      const pm = pmWithPaymentSource({ consecutive_failures: 0 });
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture({ store_id: 10 }),
      );
      prismaMock.subscription_payment_methods.findFirst
        // 1) resolveReusablePaymentMethod
        .mockResolvedValueOnce(pm)
        // 2) handleRevokedPaymentSource → fallback lookup → none
        .mockResolvedValueOnce(null);
      prismaMock.subscription_payment_methods.update.mockResolvedValue({});
      prismaMock.subscription_payment_methods.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaMock.subscription_events.create.mockResolvedValue({ id: 1 });
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 952 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 952,
        state: 'failed',
      });
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: false,
        message: 'INVALID_PAYMENT_SOURCE',
        errorCode: 'PAYMENT_SOURCE_REVOKED',
      });

      await service.charge(500);

      const calls = prismaMock.subscription_payment_methods.update.mock.calls;
      const invalidateCall = calls.find(
        (c: any) =>
          c[0]?.where?.id === pm.id && c[0]?.data?.state === 'invalid',
      );
      expect(invalidateCall).toBeDefined();
      expect(invalidateCall[0].data.consecutive_failures).toBe(0);
      expect(invalidateCall[0].data.is_default).toBe(false);
      expect(invalidateCall[0].data.replaced_at).toBeInstanceOf(Date);

      // Audit event with reason payment_source_revoked.
      const evt = prismaMock.subscription_events.create.mock.calls[0][0];
      expect(evt.data.type).toBe('payment_method_revoked');
      expect(evt.data.payload.reason).toBe('payment_source_revoked');
      expect(evt.data.payload.error_code).toBe('PAYMENT_SOURCE_REVOKED');
    });

    it('failover: when fallback PM exists with payment_source_id, single retry succeeds', async () => {
      const failingPm = pmWithPaymentSource({ id: 8001 });
      const fallback = pmWithPaymentSource({
        id: 8002,
        provider_token: 'ps_88002',
        provider_payment_source_id: '88002',
        is_default: false,
        consecutive_failures: 0,
      });

      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture({ store_id: 10 }),
      );
      prismaMock.subscription_payment_methods.findFirst
        // 1) resolveReusablePaymentMethod → failing PM
        .mockResolvedValueOnce(failingPm)
        // 2) handleRevokedPaymentSource → fallback lookup
        .mockResolvedValueOnce(fallback);
      // findUnique used by failover to load fallback details
      prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(
        fallback,
      );
      prismaMock.subscription_payment_methods.update.mockResolvedValue({});
      prismaMock.subscription_payment_methods.updateMany.mockResolvedValue({
        count: 1,
      });
      prismaMock.subscription_events.create.mockResolvedValue({ id: 1 });

      prismaMock.subscription_payments.create.mockResolvedValue({ id: 953 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 953,
        state: 'succeeded',
      });
      prismaMock.subscription_invoices.update.mockResolvedValue({});

      // First call → revoked; second call (failover) → succeeds.
      wompiProcessorMock.processPayment
        .mockResolvedValueOnce({
          success: false,
          message: 'INVALID_PAYMENT_SOURCE',
          errorCode: 'PAYMENT_SOURCE_REVOKED',
        })
        .mockResolvedValueOnce({
          success: true,
          transactionId: 'tx_failover_ok',
        });

      const result = await service.charge(500);

      expect(wompiProcessorMock.processPayment).toHaveBeenCalledTimes(2);
      // The failover request must hit the COF path with the fallback PM.
      const retryArg = wompiProcessorMock.processPayment.mock.calls[1][0];
      expect(retryArg.metadata.payment_source_id).toBe('88002');
      expect(retryArg.metadata.failover_from_pm_id).toBe(failingPm.id);
      expect(result.state).toBe('succeeded');
    });

    it('non-revoked errorCode (INSUFFICIENT_FUNDS) → counter bumps, state stays active', async () => {
      const pm = pmWithPaymentSource({ consecutive_failures: 0 });
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture(),
      );
      prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(pm);
      prismaMock.subscription_payment_methods.findUnique.mockResolvedValue(pm);
      prismaMock.subscription_payment_methods.update.mockResolvedValue({});
      prismaMock.subscription_payments.create.mockResolvedValue({ id: 954 });
      prismaMock.subscription_payments.update.mockResolvedValue({
        id: 954,
        state: 'failed',
      });
      wompiProcessorMock.processPayment.mockResolvedValue({
        success: false,
        message: 'Insufficient funds',
        errorCode: 'INSUFFICIENT_FUNDS',
      });

      await service.charge(500);

      const calls = prismaMock.subscription_payment_methods.update.mock.calls;
      // Bump call (counter goes to 1) — state must NOT be set.
      const bumpCall = calls.find(
        (c: any) => c[0]?.data?.consecutive_failures === 1,
      );
      expect(bumpCall).toBeDefined();
      expect(bumpCall[0].data.state).toBeUndefined();
      // No invalidate call (state='invalid') for non-revoke errors below threshold.
      const invalidateCall = calls.find(
        (c: any) => c[0]?.data?.state === 'invalid',
      );
      expect(invalidateCall).toBeUndefined();
    });
  });

  /**
   * Wompi Phase 7 — rollout flag.
   *
   * Verifies the bridge between `WOMPI_RECURRENT_ENFORCE` and the private
   * `legacyInlineTokenAllowed()` helper, plus the end-to-end behavior on
   * `chargeInvoice` when the flag is flipped via env (no `jest.spyOn`).
   */
  describe('Wompi Phase 7 — rollout flag', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it("legacyInlineTokenAllowed returns true when WOMPI_RECURRENT_ENFORCE is undefined", () => {
      delete process.env.WOMPI_RECURRENT_ENFORCE;
      expect((service as any).legacyInlineTokenAllowed()).toBe(true);
    });

    it("legacyInlineTokenAllowed returns true when WOMPI_RECURRENT_ENFORCE='false'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'false';
      expect((service as any).legacyInlineTokenAllowed()).toBe(true);
    });

    it("legacyInlineTokenAllowed returns false when WOMPI_RECURRENT_ENFORCE='true'", () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'true';
      expect((service as any).legacyInlineTokenAllowed()).toBe(false);
    });

    it("chargeInvoice with legacy PM + WOMPI_RECURRENT_ENFORCE='true' throws PAYMENT_METHOD_NOT_MIGRATED", async () => {
      process.env.WOMPI_RECURRENT_ENFORCE = 'true';

      const legacyPm = {
        id: 4242,
        store_subscription_id: 200,
        provider: 'wompi',
        provider_token: 'tok_legacy',
        provider_payment_source_id: null,
        state: 'active',
        is_default: true,
        consecutive_failures: 0,
        expiry_year: null,
        expiry_month: null,
      };

      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        invoiceFixture(),
      );
      prismaMock.subscription_payment_methods.findFirst.mockResolvedValue(
        legacyPm,
      );

      await expect(service.charge(500)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
      // Pre-create throw — no payment row, no processor call.
      expect(wompiProcessorMock.processPayment).not.toHaveBeenCalled();
      expect(prismaMock.subscription_payments.create).not.toHaveBeenCalled();
    });
  });
});
