import { SubscriptionStateService } from './subscription-state.service';

/**
 * Unit tests for SubscriptionStateService.
 * Focus: transition persists new state + subscription_events row (in $transaction),
 * emits subscription.state.changed, and invalidates access cache.
 */
describe('SubscriptionStateService', () => {
  let service: SubscriptionStateService;
  let prismaMock: any;
  let accessServiceMock: any;
  let eventEmitterMock: any;
  const ORIGINAL_FLAG = process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
      },
      subscription_invoices: {
        findUnique: jest.fn(),
      },
      subscription_payments: {
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      $queryRaw: jest.fn(),
    };

    accessServiceMock = {
      invalidateCache: jest.fn().mockResolvedValue(undefined),
    };

    eventEmitterMock = { emit: jest.fn() };

    service = new SubscriptionStateService(
      prismaMock,
      accessServiceMock,
      eventEmitterMock,
    );
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;
    } else {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = ORIGINAL_FLAG;
    }
  });

  // ADR-2: active → pending_payment must be a legal transition (mid-cycle upgrade flow)
  it('legal transition active → pending_payment persists new state + creates event', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
    prismaMock.store_subscriptions.update.mockResolvedValue({
      id: 100,
      state: 'pending_payment',
    });

    const result = await service.transition(10, 'pending_payment', {
      reason: 'mid_cycle_upgrade',
    });

    expect(prismaMock.$transaction).toHaveBeenCalled();
    const updArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updArg.data.state).toBe('pending_payment');

    const evtArg = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(evtArg.data.from_state).toBe('active');
    expect(evtArg.data.to_state).toBe('pending_payment');
    expect(result.state).toBe('pending_payment');
  });

  it('legal transition active → grace_soft persists new state + creates event', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
    prismaMock.store_subscriptions.update.mockResolvedValue({
      id: 100,
      state: 'grace_soft',
    });

    const result = await service.transition(10, 'grace_soft', {
      reason: 'payment_past_due',
      triggeredByJob: 'dunning',
    });

    expect(prismaMock.$transaction).toHaveBeenCalled();
    const updArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updArg.where.id).toBe(100);
    expect(updArg.data.state).toBe('grace_soft');

    const evtArg = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(evtArg.data.type).toBe('state_transition');
    expect(evtArg.data.from_state).toBe('active');
    expect(evtArg.data.to_state).toBe('grace_soft');
    expect(evtArg.data.triggered_by_job).toBe('dunning');

    expect(result.state).toBe('grace_soft');
  });

  it('emits subscription.state.changed event after commit', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
    prismaMock.store_subscriptions.update.mockResolvedValue({
      id: 100,
      state: 'cancelled',
    });

    await service.transition(10, 'cancelled', { reason: 'user_request' });

    const [evtName, payload] = eventEmitterMock.emit.mock.calls[0];
    expect(evtName).toBe('subscription.state.changed');
    expect(payload.storeId).toBe(10);
    expect(payload.fromState).toBe('active');
    expect(payload.toState).toBe('cancelled');
    expect(payload.reason).toBe('user_request');
  });

  it('invalidates access cache via accessService post-commit', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'trial' }]);
    prismaMock.store_subscriptions.update.mockResolvedValue({
      id: 100,
      state: 'active',
    });

    await service.transition(10, 'active', { reason: 'trial_ended' });

    expect(accessServiceMock.invalidateCache).toHaveBeenCalledWith(10);
  });

  it('illegal transition → throws (no update/event persisted)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'cancelled' }]);

    let threw = false;
    try {
      await service.transition(10, 'active', { reason: 'retry' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
    expect(eventEmitterMock.emit).not.toHaveBeenCalled();
  });

  it('no-op transition (same state) skips update but still returns row', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
    prismaMock.store_subscriptions.findUniqueOrThrow.mockResolvedValue({
      id: 100,
      state: 'active',
    });

    const result = await service.transition(10, 'active', {
      reason: 'idempotent',
    });

    expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
    expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();
    expect(result.state).toBe('active');
  });

  it('rejects invalid storeId', async () => {
    let threw = false;
    try {
      await service.transition(0, 'active', { reason: 'bad' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  // ----------------------------------------------------------------------
  // Event-driven dunning (Gap 3)
  // ----------------------------------------------------------------------

  describe('onPaymentFailed (event-driven)', () => {
    it('flag enabled → resolves subscriptionId via invoice and triggers eval', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'true';

      // Resolution via invoice lookup
      prismaMock.subscription_invoices.findUnique.mockResolvedValue({
        store_subscription_id: 77,
      });

      const evalSpy = jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockResolvedValue();

      await service.onPaymentFailed({
        invoiceId: 999,
        paymentId: 12,
        reason: 'declined',
      });

      expect(prismaMock.subscription_invoices.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
        select: { store_subscription_id: true },
      });
      expect(evalSpy).toHaveBeenCalledWith(77);
    });

    it('flag disabled → no-op (no DB lookup, no eval)', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'false';

      const evalSpy = jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockResolvedValue();

      await service.onPaymentFailed({
        invoiceId: 999,
        paymentId: 12,
        reason: 'declined',
      });

      expect(evalSpy).not.toHaveBeenCalled();
      expect(
        prismaMock.subscription_invoices.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('flag unset → no-op (default: cron-only)', async () => {
      delete process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE;

      const evalSpy = jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockResolvedValue();

      await service.onPaymentFailed({
        invoiceId: 999,
        paymentId: 12,
        reason: 'declined',
      });

      expect(evalSpy).not.toHaveBeenCalled();
    });

    it('eval throws → listener swallows error (does not propagate to emitter)', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'true';

      prismaMock.subscription_invoices.findUnique.mockResolvedValue({
        store_subscription_id: 77,
      });

      jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockRejectedValue(new Error('boom'));

      let threw = false;
      try {
        await service.onPaymentFailed({
          invoiceId: 999,
          paymentId: 12,
          reason: 'declined',
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('payload carries subscriptionId directly → skips invoice lookup (retry path)', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'true';

      const evalSpy = jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockResolvedValue();

      await service.onPaymentRetryFailed({
        invoiceId: 999,
        paymentId: 12,
        subscriptionId: 555,
        storeId: 42,
        attempt: 2,
        reason: 'still_declined',
      });

      expect(
        prismaMock.subscription_invoices.findUnique,
      ).not.toHaveBeenCalled();
      expect(evalSpy).toHaveBeenCalledWith(555);
    });

    it('flag enabled but invoice missing → warns, no-throw, no eval', async () => {
      process.env.SUBSCRIPTION_EVENT_DRIVEN_STATE = 'true';

      prismaMock.subscription_invoices.findUnique.mockResolvedValue(null);

      const evalSpy = jest
        .spyOn(service, 'evaluateAndTransitionForSubscription')
        .mockResolvedValue();

      let threw = false;
      try {
        await service.onPaymentFailed({
          invoiceId: 12345,
          paymentId: 1,
          reason: 'declined',
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(evalSpy).not.toHaveBeenCalled();
    });
  });

  describe('evaluateAndTransitionForSubscription', () => {
    it('rejects non-positive subscriptionId', async () => {
      let threw = false;
      try {
        await service.evaluateAndTransitionForSubscription(0);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    it('returns early when subscription not found', async () => {
      prismaMock.store_subscriptions.findUnique.mockResolvedValue(null);

      await service.evaluateAndTransitionForSubscription(999);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('skips terminal/draft states without evaluating dunning windows', async () => {
      prismaMock.store_subscriptions.findUnique.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'cancelled',
        plan: {
          grace_period_soft_days: 3,
          grace_period_hard_days: 7,
          suspension_day: 14,
          cancellation_day: 30,
        },
        promotional_plan_id: null,
        promotional_plan: null,
        trial_ends_at: null,
        current_period_end: null,
      });

      await service.evaluateAndTransitionForSubscription(1);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('crosses cancellation deadline → transitions to cancelled', async () => {
      const periodEnd = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60d ago
      prismaMock.store_subscriptions.findUnique.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: 'grace_hard',
        plan: {
          grace_period_soft_days: 3,
          grace_period_hard_days: 7,
          suspension_day: 14,
          cancellation_day: 30,
        },
        promotional_plan_id: null,
        promotional_plan: null,
        trial_ends_at: null,
        current_period_end: periodEnd,
      });

      // transition() → $queryRaw FOR UPDATE returns the row, then update
      prismaMock.$queryRaw.mockResolvedValue([{ id: 1, state: 'grace_hard' }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 1,
        state: 'cancelled',
      });

      await service.evaluateAndTransitionForSubscription(1);

      const updArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
      expect(updArg.data.state).toBe('cancelled');
      const evtArg = prismaMock.subscription_events.create.mock.calls[0][0];
      expect(evtArg.data.to_state).toBe('cancelled');
      expect(evtArg.data.triggered_by_job).toBe('subscription-state-engine');
    });
  });
});
