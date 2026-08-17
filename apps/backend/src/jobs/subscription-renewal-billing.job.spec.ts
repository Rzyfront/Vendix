import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import {
  SubscriptionRenewalBillingJob,
  BACKOFF_DELAYS,
  MAX_ATTEMPTS,
} from './subscription-renewal-billing.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionBillingService } from '../domains/store/subscriptions/services/subscription-billing.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import {
  SubscriptionStateService,
  LOCK_REASON_PLAN_RETIRED,
} from '../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

describe('SubscriptionRenewalBillingJob', () => {
  let job: SubscriptionRenewalBillingJob;
  let prisma: {
    store_subscriptions: { findMany: jest.Mock; update: jest.Mock };
    subscription_payments?: { findFirst: jest.Mock };
  };
  let billing: { issueInvoice: jest.Mock };
  let payment: {
    chargeInvoice: jest.Mock;
    hasRenewalEligiblePaymentMethod: jest.Mock;
    pauseAutoRenewForMissingCredential: jest.Mock;
  };
  let state: { transition: jest.Mock };
  let retryQueue: { add: jest.Mock };
  let billingWarningQueue: { add: jest.Mock };
  let config: { get: jest.Mock };
  let gateConfig: { isCronDryRun: jest.Mock };
  let emitter: { emit: jest.Mock };

  const subRow = {
    id: 10,
    store_id: 5,
    state: 'active',
    plan_id: 1,
    current_period_end: new Date('2026-04-01T00:00:00Z'),
    next_billing_at: new Date('2026-04-01T00:00:00Z'),
    scheduled_cancel_at: null as Date | null,
    // El cobro automático exige voluntad (`auto_renew`) Y capacidad (un medio
    // apto según renewal-eligibility.contract.ts). El cron ya no cobra por
    // `next_billing_at` a secas.
    auto_renew: true,
    metadata: null as unknown,
    plan: {
      state: 'active',
      archived_at: null as Date | null,
      grace_period_soft_days: 3,
      grace_period_hard_days: 7,
    },
  };
  const invoice = {
    id: 100,
    period_end: new Date('2026-05-01T00:00:00Z'),
    total: { toString: () => '99.00' },
  };

  beforeEach(async () => {
    prisma = {
      store_subscriptions: {
        findMany: jest.fn().mockResolvedValue([subRow]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      subscription_payments: {
        findFirst: jest.fn().mockResolvedValue({ id: 999 }),
      },
    };
    billing = { issueInvoice: jest.fn().mockResolvedValue(invoice) };
    payment = {
      chargeInvoice: jest.fn(),
      // EL predicado, consultado por el mismo servicio que cobra.
      hasRenewalEligiblePaymentMethod: jest.fn().mockResolvedValue(true),
      pauseAutoRenewForMissingCredential: jest.fn().mockResolvedValue(1),
    };
    state = { transition: jest.fn().mockResolvedValue(undefined) };
    retryQueue = { add: jest.fn().mockResolvedValue(undefined) };
    billingWarningQueue = { add: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('true') };
    gateConfig = { isCronDryRun: jest.fn().mockReturnValue(false) };
    emitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionRenewalBillingJob,
        { provide: GlobalPrismaService, useValue: prisma },
        { provide: SubscriptionBillingService, useValue: billing },
        { provide: SubscriptionPaymentService, useValue: payment },
        { provide: SubscriptionStateService, useValue: state },
        { provide: ConfigService, useValue: config },
        { provide: SubscriptionGateConfig, useValue: gateConfig },
        { provide: EventEmitter2, useValue: emitter },
        {
          provide: getQueueToken('subscription-payment-retry'),
          useValue: retryQueue,
        },
        {
          provide: getQueueToken('billing-warning'),
          useValue: billingWarningQueue,
        },
      ],
    }).compile();

    job = module.get(SubscriptionRenewalBillingJob);
  });

  it('successful charge: does NOT enqueue retry', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 1, state: 'succeeded' });

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).toHaveBeenCalledWith(subRow.id);
    expect(payment.chargeInvoice).toHaveBeenCalledWith(invoice.id);
    expect(retryQueue.add).not.toHaveBeenCalled();
  });

  it('gateway returns state=failed: enqueues retry with backoff config', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 2, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = retryQueue.add.mock.calls[0];
    expect(name).toBe('retry');
    expect(data).toEqual({
      invoiceId: invoice.id,
      subscriptionId: subRow.id,
      storeId: subRow.store_id,
      attempt: 1,
    });
    expect(opts.delay).toBe(BACKOFF_DELAYS[0]);
    expect(opts.attempts).toBe(MAX_ATTEMPTS);
    expect(opts.backoff).toEqual({
      type: 'exponential',
      delay: 60 * 60 * 1000,
    });
  });

  it('chargeInvoice throws: enqueues retry', async () => {
    payment.chargeInvoice.mockRejectedValue(new Error('gateway timeout'));

    await job.handleRenewalBilling();

    expect(retryQueue.add).toHaveBeenCalledTimes(1);
    const [, data] = retryQueue.add.mock.calls[0];
    expect(data.invoiceId).toBe(invoice.id);
  });

  it('feature flag disabled: log-and-skip retry, but STILL enqueue billing warning', async () => {
    config.get.mockReturnValue('false');
    payment.chargeInvoice.mockResolvedValue({ id: 3, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).not.toHaveBeenCalled();
    // Even when the retry-queue feature flag is OFF, the customer-visible
    // billing warning still fires so the operator can't silently drop the
    // renewal failure.
    expect(billingWarningQueue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = billingWarningQueue.add.mock.calls[0];
    expect(name).toBe('billing-warning-renewal-failed');
    expect(payload).toMatchObject({
      storeId: subRow.store_id,
      // DEFECTO 8: el aviso se ancla a la FACTURA, que es constante durante todo
      // el ciclo de reintentos. Con `payment.id` (999) como ancla el UNIQUE de
      // `billing_warning_logs` no colapsaba nada y salían hasta 4 avisos.
      invoiceId: invoice.id,
      paymentId: 999,
      storeSubscriptionId: subRow.id,
    });
    expect(payload.sourceEventId).toBeUndefined();
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('feature flag undefined: log-and-skip retry, but STILL enqueue billing warning', async () => {
    config.get.mockReturnValue(undefined);
    payment.chargeInvoice.mockResolvedValue({ id: 4, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).not.toHaveBeenCalled();
    expect(billingWarningQueue.add).toHaveBeenCalledTimes(1);
  });

  it('gateway returns state=failed: enqueues retry (battery still has attempts)', async () => {
    payment.chargeInvoice.mockResolvedValue({ id: 2, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = retryQueue.add.mock.calls[0];
    expect(name).toBe('retry');
    expect(data).toEqual({
      invoiceId: invoice.id,
      subscriptionId: subRow.id,
      storeId: subRow.store_id,
      attempt: 1,
    });
    expect(opts.delay).toBe(BACKOFF_DELAYS[0]);
    expect(opts.attempts).toBe(MAX_ATTEMPTS);
    expect(opts.backoff).toEqual({
      type: 'exponential',
      delay: 60 * 60 * 1000,
    });
    // First inline failure — BullMQ still owns the retry budget, so the
    // customer-facing warning has NOT fired yet. It will fire when the
    // BullMQ worker exhausts `attempts` (handled by Agent B's
    // BillingWarningProcessor listener on
    // `subscription.payment.retry.failed`).
    expect(billingWarningQueue.add).not.toHaveBeenCalled();
  });

  it('billing warning enqueue: tolerates missing subscription_payments row', async () => {
    (prisma as any).subscription_payments = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    config.get.mockReturnValue('false');
    payment.chargeInvoice.mockResolvedValue({ id: 5, state: 'failed' });

    await job.handleRenewalBilling();

    expect(billingWarningQueue.add).toHaveBeenCalledTimes(1);
    const [, payload] = billingWarningQueue.add.mock.calls[0];
    // El ancla es la factura siempre, exista o no un intento de pago.
    expect(payload.invoiceId).toBe(invoice.id);
    expect(payload.paymentId).toBe(invoice.id);
  });

  // ── Defecto 2: el cron ya no cobra contra el vacío ──────────────────────

  it('auto_renew off: issues the invoice but never charges', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([
      { ...subRow, auto_renew: false },
    ]);

    await job.handleRenewalBilling();

    // La factura sí se emite: es la vía del cliente para pagar a mano y lo que el
    // tablero de mora suma como deuda.
    expect(billing.issueInvoice).toHaveBeenCalledWith(subRow.id);
    // Pero no se golpea la pasarela ni se abre la escalera de reintentos.
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(retryQueue.add).not.toHaveBeenCalled();
    // Y no se avisa de nada: el autopago está apagado por decisión, no por falla.
    expect(payment.pauseAutoRenewForMissingCredential).not.toHaveBeenCalled();
    expect(billingWarningQueue.add).not.toHaveBeenCalled();
  });

  it('auto_renew on with NO eligible card: pauses and warns instead of charging', async () => {
    payment.hasRenewalEligiblePaymentMethod.mockResolvedValue(false);

    await job.handleRenewalBilling();

    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(payment.pauseAutoRenewForMissingCredential).toHaveBeenCalledTimes(1);
    const [args] = payment.pauseAutoRenewForMissingCredential.mock.calls[0];
    expect(args).toMatchObject({
      subscriptionId: subRow.id,
      storeId: subRow.store_id,
      source: 'renewal_cron',
      triggeredByJob: 'subscription-renewal-billing',
    });
  });

  it('pause failure does not break the renewal loop', async () => {
    payment.hasRenewalEligiblePaymentMethod.mockResolvedValue(false);
    payment.pauseAutoRenewForMissingCredential.mockRejectedValue(
      new Error('db down'),
    );

    await expect(job.handleRenewalBilling()).resolves.toBeUndefined();
  });

  it('billing warning enqueue: throws do not break the renewal loop', async () => {
    billingWarningQueue.add.mockRejectedValue(new Error('redis down'));
    config.get.mockReturnValue('false');
    payment.chargeInvoice.mockResolvedValue({ id: 6, state: 'failed' });

    // handleRenewalBilling() has try/catch around each per-sub processing
    // pass, so a thrown enqueue must not throw out of the cron tick.
    await expect(job.handleRenewalBilling()).resolves.toBeUndefined();
  });

  it('zero-price (issueInvoice returns null): no charge, no enqueue', async () => {
    billing.issueInvoice.mockResolvedValue(null);

    await job.handleRenewalBilling();

    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(retryQueue.add).not.toHaveBeenCalled();
  });

  it('no due subscriptions: no-op', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([]);

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).not.toHaveBeenCalled();
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(retryQueue.add).not.toHaveBeenCalled();
  });

  it('scheduled_cancel_at reached: transitions to cancelled, no invoice issued', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.store_subscriptions.findMany.mockResolvedValue([
      { ...subRow, scheduled_cancel_at: pastDate },
    ]);
    prisma.store_subscriptions.update = jest.fn().mockResolvedValue(undefined);
    const subscriptionEventsCreate = jest.fn().mockResolvedValue(undefined);
    (prisma as any).subscription_events = { create: subscriptionEventsCreate };

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).not.toHaveBeenCalled();
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(retryQueue.add).not.toHaveBeenCalled();
    expect(prisma.store_subscriptions.update).toHaveBeenCalledWith({
      where: { id: subRow.id },
      data: {
        state: 'cancelled',
        cancelled_at: expect.any(Date),
        scheduled_cancel_at: null,
        auto_renew: false,
        updated_at: expect.any(Date),
      },
    });
    expect(subscriptionEventsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_subscription_id: subRow.id,
          type: 'state_transition',
          to_state: 'cancelled',
          triggered_by_job: 'subscription-renewal-billing',
        }),
      }),
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      'subscription.state.changed',
      expect.objectContaining({
        storeId: subRow.store_id,
        toState: 'cancelled',
        reason: 'scheduled_cancel_executed',
      }),
    );
  });

  it('archived plan and ended period: moves active subscription to grace_soft without billing', async () => {
    const periodEnd = new Date(Date.now() - 60 * 60 * 1000);
    const archivedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.store_subscriptions.findMany.mockResolvedValue([
      {
        ...subRow,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        plan: { ...subRow.plan, state: 'archived', archived_at: archivedAt },
      },
    ]);

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).not.toHaveBeenCalled();
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(retryQueue.add).not.toHaveBeenCalled();
    expect(state.transition).toHaveBeenCalledWith(
      subRow.store_id,
      'grace_soft',
      expect.objectContaining({
        reason: 'current_plan_unavailable_at_renewal',
        // The COLUMN, not just the audit payload: `store_subscriptions.
        // lock_reason` is what `stateToMode()` reads to answer
        // SUBSCRIPTION_011. Passing only `reason` left it null and the store
        // was told it had not paid.
        lockReason: 'current_plan_unavailable_at_renewal',
        triggeredByJob: 'subscription-renewal-billing',
        graceSoftUntil: expect.any(Date),
        graceHardUntil: expect.any(Date),
        payload: expect.objectContaining({
          plan_id: subRow.plan_id,
          plan_state: 'archived',
          archived_at: archivedAt.toISOString(),
        }),
      }),
    );
  });

  it('archived plan: the motive travels in lockReason, so the row lands with lock_reason set', async () => {
    const periodEnd = new Date(Date.now() - 60 * 60 * 1000);
    prisma.store_subscriptions.findMany.mockResolvedValue([
      {
        ...subRow,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        plan: { ...subRow.plan, state: 'archived' },
      },
    ]);

    await job.handleRenewalBilling();

    const [, toState, opts] = state.transition.mock.calls[0];
    expect(toState).toBe('grace_soft');
    // Without this the consumer added in cc7be051d (SUBSCRIPTION_011) is dead
    // code: nothing in the system ever writes the value it matches on.
    expect(opts.lockReason).toBe(LOCK_REASON_PLAN_RETIRED);
  });

  it('archived plan before period end: skips billing without transitioning early', async () => {
    const periodEnd = new Date(Date.now() + 60 * 60 * 1000);
    prisma.store_subscriptions.findMany.mockResolvedValue([
      {
        ...subRow,
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        plan: { ...subRow.plan, state: 'archived' },
      },
    ]);

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).not.toHaveBeenCalled();
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(state.transition).not.toHaveBeenCalled();
  });

  it('archived plan already in grace: skips billing without resetting grace state', async () => {
    const periodEnd = new Date(Date.now() - 60 * 60 * 1000);
    prisma.store_subscriptions.findMany.mockResolvedValue([
      {
        ...subRow,
        state: 'grace_soft',
        current_period_end: periodEnd,
        next_billing_at: periodEnd,
        plan: { ...subRow.plan, state: 'archived' },
      },
    ]);

    await job.handleRenewalBilling();

    expect(billing.issueInvoice).not.toHaveBeenCalled();
    expect(payment.chargeInvoice).not.toHaveBeenCalled();
    expect(state.transition).not.toHaveBeenCalled();
  });
});
