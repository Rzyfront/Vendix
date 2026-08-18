import { Prisma } from '@prisma/client';
import {
  SubscriptionPaymentService,
  MAX_CONSECUTIVE_FAILURES,
} from './subscription-payment.service';
import { SubscriptionStateService } from './subscription-state.service';
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
        // `hasRenewalEligiblePmInTx` (introducido con
        // `renewal-eligibility.contract.ts`) lo llama dentro de la transacción.
        // Sin declararlo, 15 casos morían con «findMany is not a function»
        // ANTES de llegar a su aserción: no eran fallos de negocio, eran una
        // suite ciega que parecía roja por un doble incompleto.
        findMany: jest.fn().mockResolvedValue([]),
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
        // `pauseAutoRenewForMissingCredentialInTx` lo consulta dentro de la
        // transacción. Devuelve `null` —«no encontró la suscripción»— porque es
        // el camino NEUTRO: la pausa no se aplica y el resto del flujo sigue
        // igual que antes de que esa rama existiera.
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
      ensureOperationalInTx: jest
        .fn()
        .mockResolvedValue({ finalState: 'active', path: ['active'] }),
      ensureOperational: jest
        .fn()
        .mockResolvedValue({ finalState: 'active', path: ['active'] }),
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

    // RNC-MF-3 added `amount` + `entryDate` to this payload for the platform
    // accounting listener, so the assertion matches the contract fields the
    // subscription listeners actually read instead of the whole object.
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(
      'subscription.payment.failed',
      expect.objectContaining({
        invoiceId: 500,
        paymentId: 78,
        reason: 'Insufficient funds',
      }),
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

    /**
     * Transaction double that ALSO satisfies the reactivation seam, backed by a
     * single mutable row so the walked path is observable. Used by the tests
     * that wire the REAL `SubscriptionStateService` (see `useRealStateService`)
     * to prove the store actually ends up operational.
     */
    function makeSeamTxMock(
      initialState: string,
      opts: { eligibleCard?: boolean } = {},
    ) {
      const row: any = {
        ...pendingSubFixture({ state: initialState }),
        current_period_end: null,
        scheduled_cancel_at: null,
        auto_renew: true,
        metadata: null,
      };
      const events: any[] = [];

      // El predicado de elegibilidad (renewal-eligibility.contract.ts) lee los
      // medios de la suscripción: la ventana de reactivación ya no impone
      // `auto_renew: true`. Por defecto hay tarjeta apta para que estas pruebas
      // sigan midiendo la ruta de estados; la variante sin tarjeta es su propio
      // caso.
      const paymentMethods =
        opts.eligibleCard === false
          ? []
          : [
              {
                id: 900,
                type: 'card',
                state: 'active',
                provider_token: 'tok_live_x',
                provider_payment_source_id: 'ps_live_x',
                cof_registered_at: new Date('2026-01-01T00:00:00.000Z'),
                expiry_month: '12',
                expiry_year: '2999',
                consecutive_failures: 0,
                is_default: true,
              },
            ];

      const tx: any = {
        $queryRaw: jest.fn(async () => [
          {
            id: row.id,
            state: row.state,
            plan_id: row.plan_id,
            current_period_end: row.current_period_end,
            scheduled_cancel_at: row.scheduled_cancel_at,
          },
        ]),
        store_subscriptions: {
          findUniqueOrThrow: jest.fn(async () => ({ ...row })),
          findFirst: jest.fn(async () => ({ ...row })),
          update: jest.fn(async ({ data }: any) => {
            for (const [key, value] of Object.entries(data)) {
              if (value !== undefined) row[key] = value;
            }
            return { ...row };
          }),
        },
        subscription_events: {
          create: jest.fn(async ({ data }: any) => {
            events.push(data);
            return data;
          }),
        },
        subscription_plans: {
          findUniqueOrThrow: jest.fn(async () => targetPlanFixture()),
          findUnique: jest.fn(async () => ({ billing_cycle: 'monthly' })),
        },
        subscription_payment_methods: {
          findMany: jest.fn(async () => paymentMethods),
        },
      };

      const hops = () =>
        events
          .filter((e) => e.type === 'state_transition')
          .map((e) => `${e.from_state}->${e.to_state}`);

      return { tx, row, events, hops };
    }

    /**
     * Swaps in the real `SubscriptionStateService`. Its prisma double refuses to
     * open a transaction: this call-site is already inside the payment's
     * transaction, and a second one would block against the `FOR UPDATE` lock
     * the first one holds on the same subscription row.
     */
    function useRealStateService() {
      const prismaFake: any = {
        $transaction: jest.fn(() => {
          throw new Error(
            'ensureOperationalInTx must not open its own transaction',
          );
        }),
      };
      const accessService: any = {
        invalidateCache: jest.fn().mockResolvedValue(undefined),
      };
      const emitter: any = { emit: jest.fn() };
      const real = new SubscriptionStateService(
        prismaFake,
        accessService,
        emitter,
      );
      (service as any).stateService = real;
      return { real, prismaFake, accessService, emitter };
    }

    function standardPricing() {
      billingMock.computePricing = jest.fn().mockReturnValue({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });
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
      // Promotion goes through the reactivation seam, on the CALLER's tx.
      expect(stateServiceMock.ensureOperationalInTx).toHaveBeenCalledWith(
        txMock,
        10,
        expect.objectContaining({
          reason: expect.stringContaining('plan_confirmed_invoice_500'),
        }),
      );
      expect(stateServiceMock.transitionInTx).not.toHaveBeenCalled();
    });

    it('hands the seam the SAME tx it received (never a fresh client)', async () => {
      const txMock = makeTxMock();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm(),
        txMock as any,
      );

      // Identity, not shape: a new client would open a second transaction and
      // self-block against the FOR UPDATE lock this one already holds.
      const [passedTx] = stateServiceMock.ensureOperationalInTx.mock.calls[0];
      expect(passedTx).toBe(txMock);
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
      expect(stateServiceMock.ensureOperationalInTx).not.toHaveBeenCalled();
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

    it('this service no longer writes the period window nor the scheduling cleanup', async () => {
      const txMock = makeTxMock();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'upgrade' }),
        txMock as any,
      );

      const updateArg = txMock.store_subscriptions.update.mock.calls[0][0];
      // All of these now belong to the seam exclusively. Two writers computing
      // the same window is how the call-sites drifted apart in the first place.
      expect(updateArg.data.current_period_start).toBeUndefined();
      expect(updateArg.data.current_period_end).toBeUndefined();
      expect(updateArg.data.next_billing_at).toBeUndefined();
      expect(updateArg.data.scheduled_cancel_at).toBeUndefined();
      expect(updateArg.data.auto_renew).toBeUndefined();
      expect(updateArg.data.suspend_at).toBeUndefined();
      expect(updateArg.data.grace_soft_until).toBeUndefined();
      expect(updateArg.data.grace_hard_until).toBeUndefined();
      // Plan/pricing promotion is still this service's job.
      expect(updateArg.data.plan_id).toBe(7);
      expect(updateArg.data.paid_plan_id).toBe(7);
    });

    it('period-resetting kinds hand the seam a periodEnd base + planId', async () => {
      const txMock = makeTxMock();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'initial' }),
        txMock as any,
      );

      const [, , ctx] = stateServiceMock.ensureOperationalInTx.mock.calls[0];
      expect(ctx.periodEnd).toBeInstanceOf(Date);
      // monthly target plan → 30-day base window; the seam then discounts any
      // grace days already consumed.
      const days = Math.round(
        (ctx.periodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(30);
      expect(ctx.planId).toBe(7);
    });

    it('non-resetting kinds pass no periodEnd, leaving the paid window to the seam', async () => {
      const txMock = makeTxMock();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'promo_swap' }),
        txMock as any,
      );

      const [, , ctx] = stateServiceMock.ensureOperationalInTx.mock.calls[0];
      expect(ctx.periodEnd).toBeUndefined();
    });

    it('clears trial_ends_at when a trial converts (the one field the seam does not own)', async () => {
      const txMock = makeTxMock();
      txMock.store_subscriptions.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue(
          pendingSubFixture({
            state: 'pending_payment',
            pending_revert_state: 'trial',
          }),
        );
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'trial_conversion' }),
        txMock as any,
      );

      const updateArg = txMock.store_subscriptions.update.mock.calls[0][0];
      expect(updateArg.data.trial_ends_at).toBeNull();
    });

    // ────────────────────────────────────────────────────────────────────────
    // PRODUCTION INCIDENT: a store in `cancelled` bought a plan. The charge
    // went through, the response was HTTP 200 — and the store stayed blocked.
    // Root cause: this call-site asked for a single `cancelled -> active` hop,
    // which is illegal, and handleChargeSuccess swallowed the SUBSCRIPTION_010.
    // ────────────────────────────────────────────────────────────────────────

    it('INCIDENT: confirmed payment on a `cancelled` store leaves it active', async () => {
      const seam = makeSeamTxMock('cancelled');
      const { prismaFake } = useRealStateService();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'resubscribe' }),
        seam.tx,
      );

      expect(seam.row.state).toBe('active');
      // Terminality preserved: walked through pending_payment, never jumped.
      expect(seam.hops()).toEqual([
        'cancelled->pending_payment',
        'pending_payment->active',
      ]);
      // Ran inside the caller's transaction — no second one was opened.
      expect(prismaFake.$transaction).not.toHaveBeenCalled();
      // And the seam owns the window/cleanup it used to duplicate here.
      expect(seam.row.current_period_end).toBeInstanceOf(Date);
      expect(seam.row.scheduled_cancel_at).toBeNull();
      // `true` porque la suscripción TIENE una tarjeta apta en el doble. La
      // aserción antes pasaba sin ningún medio de pago: la ventana imponía `true`
      // y pisaba el apagado del gate escrito antes en la misma transacción.
      expect(seam.row.auto_renew).toBe(true);
      expect(seam.row.cancel_at).toBeNull();
      expect(seam.row.suspend_at).toBeNull();
      expect(seam.row.lock_reason).toBeNull();
    });

    it('REGRESSION: reactivation does NOT re-arm autopay when no card can renew', async () => {
      const seam = makeSeamTxMock('cancelled', { eligibleCard: false });
      // El gate corrió antes en esta misma transacción y dejó el autopago en
      // pausa. Ese apagado es lo que la ventana de reactivación borraba.
      seam.row.auto_renew = false;
      useRealStateService();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'resubscribe' }),
        seam.tx,
      );

      expect(seam.row.state).toBe('active');
      // La tienda queda operativa (pagó) pero el autopago NO se enciende solo.
      expect(seam.row.auto_renew).toBe(false);
      expect(seam.row.metadata).toMatchObject({
        auto_renew_intent: {
          desired: true,
          paused_by: 'reactivation_window',
          rearmed_at: null,
        },
      });
    });

    it('confirmed payment on a `pending_payment` store still promotes in one hop', async () => {
      const seam = makeSeamTxMock('pending_payment');
      useRealStateService();
      standardPricing();

      await (service as any).confirmPendingChange(
        invoiceForConfirm({ change_kind: 'upgrade' }),
        seam.tx,
      );

      expect(seam.row.state).toBe('active');
      expect(seam.hops()).toEqual(['pending_payment->active']);
    });

    it('a degraded outcome aborts the payment transaction instead of returning success', async () => {
      const seam = makeSeamTxMock('cancelled');
      useRealStateService();
      standardPricing();
      // Exit guard: the row did not come out operational.
      seam.tx.store_subscriptions.findFirst = jest
        .fn()
        .mockResolvedValue({ state: 'pending_payment' });

      await expect(
        (service as any).confirmPendingChange(
          invoiceForConfirm({ change_kind: 'resubscribe' }),
          seam.tx,
        ),
      ).rejects.toBeDefined();
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

  // ── Billing-warning gate: disableAutoRenewForMissingCredential ───────────
  //
  // Called inside handleChargeSuccess.executeWrites immediately after the
  // PM auto-register attempt. Ahora delega en
  // `pauseAutoRenewForMissingCredentialInTx`, que consulta EL predicado
  // (`renewal-eligibility.contract.ts`) en vez de reimplementar la condición:
  //   * Medio APTO en la suscripción → no-op (null, sin flip, sin auditoría).
  //   * Sin medio apto → apaga `auto_renew`, RECUERDA la intención en
  //     `metadata.auto_renew_intent` y estampa la fila de auditoría, devolviendo
  //     su id para el emit post-commit.
  //   * Una fila de auditoría ya abierta NO genera otra: el aviso es uno por
  //     ciclo de pausa, no uno por intento de cobro.
  describe('disableAutoRenewForMissingCredential', () => {
    let pmFindMany: jest.Mock;
    let subFindFirst: jest.Mock;
    let subUpdate: jest.Mock;
    let eventsCreate: jest.Mock;
    let queryRaw: jest.Mock;
    let txMock: any;

    const invoice = {
      id: 500,
      store_id: 10,
      store_subscription_id: 200,
      invoice_number: 'SAAS-20260423-00001',
      state: 'issued',
      total: new Prisma.Decimal(100),
      currency: 'COP',
      partner_organization_id: null,
      split_breakdown: null,
    };

    const eligiblePm = {
      id: 555,
      type: 'card',
      state: 'active',
      provider_token: 'tok_live_x',
      provider_payment_source_id: 'ps_live_x',
      cof_registered_at: new Date('2026-01-01T00:00:00.000Z'),
      expiry_month: '12',
      expiry_year: '2999',
      consecutive_failures: 0,
      is_default: true,
    };

    beforeEach(() => {
      pmFindMany = jest.fn().mockResolvedValue([]);
      subFindFirst = jest
        .fn()
        .mockResolvedValue({ id: 200, auto_renew: true, metadata: null });
      subUpdate = jest.fn().mockResolvedValue({ id: 200 });
      eventsCreate = jest.fn().mockResolvedValue({ id: 9991 });
      // Sin fila de auditoría abierta salvo que la prueba diga lo contrario.
      queryRaw = jest.fn().mockResolvedValue([]);
      txMock = {
        subscription_payment_methods: { findMany: pmFindMany },
        store_subscriptions: { findFirst: subFindFirst, update: subUpdate },
        subscription_events: { create: eventsCreate },
        $queryRaw: queryRaw,
      };
    });

    async function invoke(triggeredByJob: 'webhook' | 'checkout_commit') {
      return (service as any).disableAutoRenewForMissingCredential(
        txMock,
        invoice,
        77,
        'wompi-tx-abc',
        triggeredByJob,
      );
    }

    it('returns null when a renewal-eligible PM is already on file', async () => {
      pmFindMany.mockResolvedValue([eligiblePm]);

      const result = await invoke('webhook');

      expect(result).toBeNull();
      expect(subUpdate).not.toHaveBeenCalled();
      expect(eventsCreate).not.toHaveBeenCalled();
    });

    it('pauses even when a NON-card PM exists (Nequi/PSE cannot renew)', async () => {
      // Éste es el defecto 3 en una sola aserción: la implementación anterior del
      // cobrador aceptaba cualquier tipo y el gate solo miraba la credencial.
      pmFindMany.mockResolvedValue([{ ...eligiblePm, type: 'nequi' }]);

      const result = await invoke('webhook');

      expect(subUpdate).toHaveBeenCalledTimes(1);
      expect(result).toBe(9991);
    });

    it('flips auto_renew off, remembers the intent and stamps an audit row', async () => {
      const result = await invoke('checkout_commit');

      expect(subUpdate).toHaveBeenCalledTimes(1);
      const updateArg = subUpdate.mock.calls[0][0];
      expect(updateArg).toMatchObject({ where: { id: 200 } });
      expect(updateArg.data.auto_renew).toBe(false);
      // La intención viaja en el JSON que YA existe — sin columnas nuevas — y es
      // lo que autoriza el rearme automático al guardar una tarjeta.
      expect(updateArg.data.metadata).toMatchObject({
        auto_renew_intent: {
          desired: true,
          reason: 'no_card_credential',
          paused_by: 'checkout_commit',
          rearmed_at: null,
        },
      });

      // Audit row inserted.
      expect(eventsCreate).toHaveBeenCalledTimes(1);
      const data = eventsCreate.mock.calls[0][0].data;
      expect(data).toMatchObject({
        store_subscription_id: 200,
        type: 'auto_renew_disabled_no_credential',
        triggered_by_job: 'checkout_commit',
      });
      expect(data.payload).toMatchObject({
        transaction_id: 'wompi-tx-abc',
        payment_id: 77,
        store_subscription_id: 200,
        source: 'no_credential_post_register',
      });
      expect(data.payload.event_id).toEqual(expect.stringContaining('no-cred-77'));
      expect(data.payload.resolved_at).toBeNull();

      // Returns the new event id so the post-commit emit can carry it.
      expect(result).toBe(9991);
    });

    it('does NOT stamp a second audit row while one is still unresolved', async () => {
      // Fila abierta encontrada por el SQL de dedupe.
      queryRaw.mockResolvedValue([{ id: 4242 }]);

      const result = await invoke('webhook');

      // El apagado se re-asegura (idempotente)…
      expect(subUpdate).toHaveBeenCalledTimes(1);
      // …pero NO hay evento nuevo, así que el listener no vuelve a mandar campana
      // ni correo. Sin esta guarda el comerciante recibía un aviso por intento.
      expect(eventsCreate).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('does not overwrite an auto_renew the merchant himself turned off', async () => {
      subFindFirst.mockResolvedValue({
        id: 200,
        auto_renew: false,
        metadata: null,
      });

      await invoke('webhook');

      // No inventamos una intención que el cliente no expresó.
      expect(subUpdate).not.toHaveBeenCalled();
      // El aviso sí se estampa: sigue sin poder renovar.
      expect(eventsCreate).toHaveBeenCalledTimes(1);
    });

    it('uses "webhook" as triggered_by_job when called from the webhook path', async () => {
      eventsCreate.mockResolvedValue({ id: 9992 });

      await invoke('webhook');

      expect(eventsCreate).toHaveBeenCalledTimes(1);
      expect(eventsCreate.mock.calls[0][0].data.triggered_by_job).toBe('webhook');
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

  /**
   * Incidente Multimarcas Ever (17/08/2026, store 85 / sub 43 / factura 17):
   * Wompi aprobó $69.900 por Nequi, el webhook no se procesó, y el cron
   * `reconcile-stuck-pending` anuló la factura. Con el corte antiguo
   * (`state === 'void' → status:'failed'`) esa anulación era irreversible: la
   * factura pagada quedaba `void` para siempre.
   *
   * Y reabrirla sin más tampoco alcanzaba: el cron había borrado los
   * `pending_*` de la suscripción, así que `confirmPendingChange` caía en
   * `CONFIRM_PENDING_MISMATCH` y NO promovía el plan — pago cobrado, tienda
   * degradada.
   */
  describe('syncInvoiceFromGateway — reapertura de factura anulada', () => {
    const APPROVED_TXN = {
      id: '1439162-1786996019-19335',
      status: 'APPROVED',
    };

    function voidInvoiceFixture(overrides: any = {}) {
      return {
        id: 17,
        store_id: 85,
        store_subscription_id: 43,
        state: 'void',
        to_plan_id: 7,
        from_plan_id: 5,
        change_kind: 'upgrade',
        issued_at: new Date('2026-08-17T14:40:00.000Z'),
        created_at: new Date('2026-08-17T14:39:00.000Z'),
        total: new Prisma.Decimal(69900),
        partner_organization_id: null,
        split_breakdown: null,
        ...overrides,
      };
    }

    function wireApprovedGateway(txns: any[] = [APPROVED_TXN]) {
      (service as any).wompiClientFactory.getClient = jest
        .fn()
        .mockReturnValue({
          getTransactionsByReference: jest
            .fn()
            .mockResolvedValue({ data: txns }),
        });
    }

    function wireTransaction() {
      const txClient: any = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        store_subscriptions: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 43, state: 'grace_soft' }),
          update: jest.fn().mockResolvedValue({ id: 43 }),
        },
      };
      prismaMock.withoutScope = () => ({
        $transaction: jest.fn(async (cb: any) => cb(txClient)),
      });
      return txClient;
    }

    beforeEach(() => {
      prismaMock.subscription_payments.findFirst.mockResolvedValue({
        id: 900,
        invoice_id: 17,
        state: 'pending',
        metadata: { reference: 'vendix_saas_43_17_1786996019' },
      });
      jest
        .spyOn(service as any, 'enqueueCommissionAccrualPostCommit')
        .mockResolvedValue(undefined);
    });

    it('reabre la factura void y restaura los pending_* ANTES de acreditar', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        voidInvoiceFixture(),
      );
      wireApprovedGateway();
      const tx = wireTransaction();

      const markSpy = jest
        .spyOn(service as any, 'markPaymentSucceededFromWebhook')
        .mockResolvedValue(null);

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('paid');
      expect(result.transaction_id).toBe(APPROVED_TXN.id);

      // Los pending_* se reconstruyen desde la propia factura…
      expect(tx.store_subscriptions.update).toHaveBeenCalledTimes(1);
      const restore = tx.store_subscriptions.update.mock.calls[0][0];
      expect(restore.where).toEqual({ id: 43 });
      expect(restore.data.pending_plan_id).toBe(7);
      expect(restore.data.pending_change_invoice_id).toBe(17);
      expect(restore.data.pending_change_kind).toBe('upgrade');
      expect(restore.data.pending_change_started_at).toEqual(
        new Date('2026-08-17T14:40:00.000Z'),
      );
      // …y `pending_revert_state` toma el estado ACTUAL de la suscripción, para
      // que un revertido posterior siga siendo un salto legal.
      expect(restore.data.pending_revert_state).toBe('grace_soft');

      // …y todo eso ocurre ANTES del acredite, que es lo que dispara
      // confirmPendingChange y su guarda de mismatch.
      expect(markSpy).toHaveBeenCalledTimes(1);
      expect(
        tx.store_subscriptions.update.mock.invocationCallOrder[0],
      ).toBeLessThan(markSpy.mock.invocationCallOrder[0]);
    });

    it('registra INVOICE_REOPENED_FROM_GATEWAY al reabrir', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        voidInvoiceFixture(),
      );
      wireApprovedGateway();
      wireTransaction();
      jest
        .spyOn(service as any, 'markPaymentSucceededFromWebhook')
        .mockResolvedValue(null);
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await service.syncInvoiceFromGateway(17);

      const reopened = warnSpy.mock.calls
        .map(([arg]: any[]) => {
          try {
            return typeof arg === 'string' ? JSON.parse(arg) : null;
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.event === 'INVOICE_REOPENED_FROM_GATEWAY');

      expect(reopened).toBeDefined();
      expect(reopened.invoice_id).toBe(17);
      expect(reopened.transaction_id).toBe(APPROVED_TXN.id);
      expect(reopened.previous_state).toBe('void');
    });

    it('no toca los pending_* en el camino normal (factura issued)', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        voidInvoiceFixture({ state: 'issued' }),
      );
      wireApprovedGateway();
      const tx = wireTransaction();
      jest
        .spyOn(service as any, 'markPaymentSucceededFromWebhook')
        .mockResolvedValue(null);

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('paid');
      // Estado vivo: el checkout ya los puso, reescribirlos sería pisarlos.
      expect(tx.store_subscriptions.update).not.toHaveBeenCalled();
    });

    it('una factura refunded sigue cortando de inmediato, sin preguntar', async () => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        voidInvoiceFixture({ state: 'refunded' }),
      );
      const getClient = jest.fn();
      (service as any).wompiClientFactory.getClient = getClient;

      const result = await service.syncInvoiceFromGateway(17);

      expect(result).toEqual({ status: 'failed', already_paid: false });
      expect(getClient).not.toHaveBeenCalled();
      expect(prismaMock.subscription_payments.findFirst).not.toHaveBeenCalled();
    });
  });

  /**
   * Tarea 1 — los cuatro `pending` dejan de ser indistinguibles. Cada `reason`
   * dice si la pasarela CONTESTÓ o no, que es lo que decide si un llamador
   * puede tratar la factura como no cobrada.
   */
  describe('syncInvoiceFromGateway — discriminación del pending', () => {
    function issuedInvoice() {
      return {
        id: 17,
        store_id: 85,
        store_subscription_id: 43,
        state: 'issued',
        to_plan_id: null,
        from_plan_id: null,
        change_kind: null,
        issued_at: new Date('2026-08-17T14:40:00.000Z'),
        created_at: new Date('2026-08-17T14:39:00.000Z'),
        total: new Prisma.Decimal(69900),
      };
    }

    beforeEach(() => {
      prismaMock.subscription_invoices.findUnique.mockResolvedValue(
        issuedInvoice(),
      );
    });

    it('reason=no_reference cuando el pago no trae metadata.reference', async () => {
      prismaMock.subscription_payments.findFirst.mockResolvedValue({
        id: 900,
        state: 'pending',
        metadata: {},
      });

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('no_reference');
    });

    it('reason=gateway_unreachable cuando la consulta a Wompi revienta', async () => {
      prismaMock.subscription_payments.findFirst.mockResolvedValue({
        id: 900,
        state: 'pending',
        metadata: { reference: 'vendix_saas_43_17_1' },
      });
      (service as any).wompiClientFactory.getClient = jest
        .fn()
        .mockReturnValue({
          getTransactionsByReference: jest
            .fn()
            .mockRejectedValue(new Error('ETIMEDOUT')),
        });

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('gateway_unreachable');
    });

    it('reason=no_transaction_for_reference cuando Wompi responde sin transacciones', async () => {
      prismaMock.subscription_payments.findFirst.mockResolvedValue({
        id: 900,
        state: 'pending',
        metadata: { reference: 'vendix_saas_43_17_1' },
      });
      (service as any).wompiClientFactory.getClient = jest
        .fn()
        .mockReturnValue({
          getTransactionsByReference: jest
            .fn()
            .mockResolvedValue({ data: [] }),
        });

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('no_transaction_for_reference');
    });

    it('reason=gateway_pending cuando la transacción sigue PENDING en Wompi', async () => {
      prismaMock.subscription_payments.findFirst.mockResolvedValue({
        id: 900,
        state: 'pending',
        metadata: { reference: 'vendix_saas_43_17_1' },
      });
      (service as any).wompiClientFactory.getClient = jest
        .fn()
        .mockReturnValue({
          getTransactionsByReference: jest.fn().mockResolvedValue({
            data: [{ id: 'txn_1', status: 'PENDING' }],
          }),
        });

      const result = await service.syncInvoiceFromGateway(17);

      expect(result.status).toBe('pending');
      expect(result.reason).toBe('gateway_pending');
    });
  });
});
