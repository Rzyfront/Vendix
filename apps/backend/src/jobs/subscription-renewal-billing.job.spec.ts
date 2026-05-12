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
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

describe('SubscriptionRenewalBillingJob', () => {
  let job: SubscriptionRenewalBillingJob;
  let prisma: {
    store_subscriptions: { findMany: jest.Mock; update: jest.Mock };
  };
  let billing: { issueInvoice: jest.Mock };
  let payment: { chargeInvoice: jest.Mock };
  let state: { transition: jest.Mock };
  let retryQueue: { add: jest.Mock };
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
    };
    billing = { issueInvoice: jest.fn().mockResolvedValue(invoice) };
    payment = { chargeInvoice: jest.fn() };
    state = { transition: jest.fn().mockResolvedValue(undefined) };
    retryQueue = { add: jest.fn().mockResolvedValue(undefined) };
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

  it('feature flag disabled: log-and-skip, NO enqueue', async () => {
    config.get.mockReturnValue('false');
    payment.chargeInvoice.mockResolvedValue({ id: 3, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).not.toHaveBeenCalled();
  });

  it('feature flag undefined: log-and-skip, NO enqueue', async () => {
    config.get.mockReturnValue(undefined);
    payment.chargeInvoice.mockResolvedValue({ id: 4, state: 'failed' });

    await job.handleRenewalBilling();

    expect(retryQueue.add).not.toHaveBeenCalled();
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
