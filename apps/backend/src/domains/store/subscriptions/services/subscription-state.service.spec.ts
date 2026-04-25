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

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
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

    const result = await service.transition(10, 'active', { reason: 'idempotent' });

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
});
