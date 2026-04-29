// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models).
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SubscriptionStateListener } from './subscription-state.listener';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { SubscriptionAccessService } from '../services/subscription-access.service';

describe('SubscriptionStateListener — onStateChanged', () => {
  let listener: SubscriptionStateListener;
  let invalidateCache: jest.Mock;
  let queueAdd: jest.Mock;
  let storeSubsFindFirst: jest.Mock;

  beforeEach(async () => {
    invalidateCache = jest.fn().mockResolvedValue(undefined);
    queueAdd = jest.fn().mockResolvedValue(undefined);
    storeSubsFindFirst = jest.fn().mockResolvedValue({ id: 42 });

    const prismaMock = {
      withoutScope: () => ({
        store_subscriptions: { findFirst: storeSubsFindFirst },
        subscription_invoices: { findUnique: jest.fn() },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionStateListener,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: SubscriptionStateService,
          useValue: { transition: jest.fn() },
        },
        {
          provide: SubscriptionAccessService,
          useValue: { invalidateCache },
        },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    listener = module.get(SubscriptionStateListener);
  });

  it('enqueues welcome email on draft -> active', async () => {
    await listener.onStateChanged({
      storeId: 5,
      fromState: 'draft',
      toState: 'active',
    });

    expect(invalidateCache).toHaveBeenCalledWith(5);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][0]).toBe('subscription.welcome.email');
    expect(queueAdd.mock.calls[0][1]).toMatchObject({
      subscriptionId: 42,
      storeId: 5,
      fromState: 'draft',
      toState: 'active',
    });
  });

  it('enqueues cancellation email with no-refund flag on toState=cancelled', async () => {
    await listener.onStateChanged({
      storeId: 6,
      fromState: 'active',
      toState: 'cancelled',
      reason: 'user_request',
    });

    expect(invalidateCache).toHaveBeenCalledWith(6);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][0]).toBe('subscription.cancellation.email');
    expect(queueAdd.mock.calls[0][1]).toMatchObject({
      subscriptionId: 42,
      storeId: 6,
      includeNoRefundNotice: true,
      reason: 'user_request',
    });
  });

  it('enqueues reactivation email on cancelled -> active', async () => {
    await listener.onStateChanged({
      storeId: 7,
      fromState: 'cancelled',
      toState: 'active',
    });

    expect(invalidateCache).toHaveBeenCalledWith(7);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd.mock.calls[0][0]).toBe('subscription.reactivation.email');
    expect(queueAdd.mock.calls[0][1]).toMatchObject({
      subscriptionId: 42,
      storeId: 7,
      fromState: 'cancelled',
      toState: 'active',
    });
  });

  it('only invalidates cache on unrelated transitions (e.g. active -> grace_soft)', async () => {
    await listener.onStateChanged({
      storeId: 8,
      fromState: 'active',
      toState: 'grace_soft',
    });

    expect(invalidateCache).toHaveBeenCalledWith(8);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// G12 — onPaymentSucceeded: event-driven recovery from grace/suspended/blocked
// ---------------------------------------------------------------------------

describe('SubscriptionStateListener — onPaymentSucceeded (G12)', () => {
  let listener: SubscriptionStateListener;
  let transition: jest.Mock;
  let storeSubsFindUnique: jest.Mock;
  let invoicesFindUnique: jest.Mock;
  let queueAdd: jest.Mock;
  const ORIGINAL_FLAG = process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;

  const buildListener = async (subState: string) => {
    transition = jest.fn().mockResolvedValue(undefined);
    queueAdd = jest.fn().mockResolvedValue(undefined);
    storeSubsFindUnique = jest.fn().mockResolvedValue({
      id: 100,
      state: subState,
      store_id: 50,
    });
    invoicesFindUnique = jest.fn().mockResolvedValue({
      store_subscription_id: 100,
      store_id: 50,
    });

    const prismaMock = {
      withoutScope: () => ({
        store_subscriptions: {
          findUnique: storeSubsFindUnique,
          findFirst: jest.fn().mockResolvedValue({ id: 100 }),
        },
        subscription_invoices: { findUnique: invoicesFindUnique },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionStateListener,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: SubscriptionStateService,
          useValue: { transition },
        },
        {
          provide: SubscriptionAccessService,
          useValue: { invalidateCache: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    return module.get(SubscriptionStateListener);
  };

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;
    } else {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = ORIGINAL_FLAG;
    }
  });

  describe('flag enabled (SUBSCRIPTION_EVENT_DRIVEN_STATE=true)', () => {
    beforeEach(() => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'true';
    });

    it.each([
      ['grace_soft'],
      ['grace_hard'],
      ['suspended'],
      ['blocked'],
    ])('promotes %s → active', async (state) => {
      listener = await buildListener(state);

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
        source: 'webhook',
      });

      expect(transition).toHaveBeenCalledTimes(1);
      const [storeId, target, opts] = transition.mock.calls[0];
      expect(storeId).toBe(50);
      expect(target).toBe('active');
      expect(opts.reason).toBe('payment_succeeded_webhook');
      expect(opts.triggeredByJob).toBe('subscription-state-listener');
      expect(opts.payload.previous_state).toBe(state);

      // Email enqueue happens in enforce mode.
      expect(queueAdd).toHaveBeenCalledWith(
        'payment.confirmed.email',
        expect.objectContaining({ invoiceId: 11, paymentId: 22, storeId: 50 }),
        expect.any(Object),
      );
    });

    it('still promotes pending_payment → active (G3 baseline preserved)', async () => {
      listener = await buildListener('pending_payment');

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      expect(transition).toHaveBeenCalledTimes(1);
      expect(transition.mock.calls[0][1]).toBe('active');
    });

    it('idempotent on duplicate webhooks: second delivery short-circuits when sub already active', async () => {
      listener = await buildListener('grace_soft');

      // First webhook
      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });
      expect(transition).toHaveBeenCalledTimes(1);

      // Simulate second webhook arriving AFTER the first one promoted the
      // subscription. Re-stub findUnique to return the new active state.
      storeSubsFindUnique.mockResolvedValueOnce({
        id: 100,
        state: 'active',
        store_id: 50,
      });

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      // No second transition() call — short-circuited by promotable check.
      expect(transition).toHaveBeenCalledTimes(1);
    });
  });

  describe('flag disabled (default — log-only)', () => {
    it('grace_soft → active: does NOT call transition() or enqueue email', async () => {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;
      listener = await buildListener('grace_soft');

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      expect(transition).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('flag explicitly false: still log-only for blocked state', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'false';
      listener = await buildListener('blocked');

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      expect(transition).not.toHaveBeenCalled();
    });

    it('pending_payment → active is ALWAYS enforced regardless of flag', async () => {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;
      listener = await buildListener('pending_payment');

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      expect(transition).toHaveBeenCalledTimes(1);
      expect(transition.mock.calls[0][1]).toBe('active');
    });

    it('skips terminal/active states cleanly (no log-only path needed)', async () => {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;
      listener = await buildListener('active');

      await listener.onPaymentSucceeded({
        invoiceId: 11,
        paymentId: 22,
        subscriptionId: 100,
        storeId: 50,
      });

      expect(transition).not.toHaveBeenCalled();
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });
});
