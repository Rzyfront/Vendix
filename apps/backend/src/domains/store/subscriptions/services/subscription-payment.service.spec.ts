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
    commissionQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };
    emailQueueMock = {
      add: jest.fn().mockResolvedValue({ id: 'email-123' }),
    };

    service = new SubscriptionPaymentService(
      prismaMock,
      gatewayMock,
      billingMock,
      commissionsMock,
      stateServiceMock,
      configMock,
      eventEmitterMock,
      platformGwMock,
      wompiProcessorMock,
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

  it('handleChargeSuccess upserts partner_commissions (pending_payout) when no row exists yet', async () => {
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
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 79 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 79,
      state: 'succeeded',
    });
    // updateMany affects 0 rows -> falls through to upsert
    prismaMock.partner_commissions.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.partner_commissions.upsert.mockResolvedValue({
      id: 1,
      state: 'pending_payout',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_xyz',
    });

    await service.charge(500);

    expect(prismaMock.partner_commissions.updateMany).toHaveBeenCalledWith({
      where: { invoice_id: 500, state: 'accrued' },
      data: { state: 'pending_payout' },
    });

    const upsertArg = prismaMock.partner_commissions.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ invoice_id: 500 });
    expect(upsertArg.create.partner_organization_id).toBe(42);
    expect(upsertArg.create.invoice_id).toBe(500);
    expect(upsertArg.create.state).toBe('pending_payout');
    expect(upsertArg.update).toEqual({});
    // Race-safe: no direct create() call
    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
  });

  it('transitions existing accrued commission to pending_payout via updateMany state-machine guard', async () => {
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
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 80 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 80,
      state: 'succeeded',
    });
    // updateMany found and transitioned the accrued row
    prismaMock.partner_commissions.updateMany.mockResolvedValue({ count: 1 });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_next',
    });

    await service.charge(500);

    expect(prismaMock.partner_commissions.updateMany).toHaveBeenCalledWith({
      where: { invoice_id: 500, state: 'accrued' },
      data: { state: 'pending_payout' },
    });
    // No upsert/create needed when transition succeeded
    expect(prismaMock.partner_commissions.upsert).not.toHaveBeenCalled();
    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
    expect(prismaMock.partner_commissions.update).not.toHaveBeenCalled();
  });

  it('handleChargeSuccess is idempotent when commission already in pending_payout (state-machine guard)', async () => {
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
    prismaMock.subscription_payments.create.mockResolvedValue({ id: 81 });
    prismaMock.subscription_payments.update.mockResolvedValue({
      id: 81,
      state: 'succeeded',
    });
    // updateMany finds 0 rows in 'accrued' (already in pending_payout)
    prismaMock.partner_commissions.updateMany.mockResolvedValue({ count: 0 });
    // upsert update payload is {} so the existing pending_payout row is unchanged
    prismaMock.partner_commissions.upsert.mockResolvedValue({
      id: 1001,
      state: 'pending_payout',
    });
    wompiProcessorMock.processPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx_idem',
    });

    await service.charge(500);

    // updateMany filter excludes already-transitioned rows (no regression)
    const updArg = prismaMock.partner_commissions.updateMany.mock.calls[0][0];
    expect(updArg.where.state).toBe('accrued');
    // upsert update payload is no-op, preserving pending_payout state
    const upsertArg = prismaMock.partner_commissions.upsert.mock.calls[0][0];
    expect(upsertArg.update).toEqual({});
    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
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
});
