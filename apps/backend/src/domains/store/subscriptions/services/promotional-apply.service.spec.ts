import { PromotionalApplyService } from './promotional-apply.service';
import { SubscriptionStateService } from './subscription-state.service';

/**
 * Unit tests for PromotionalApplyService.
 * Focus: union-of-max semantics (never subtracts), promo_priority conflict
 * resolution, resolved_features/promotional_plan_id persistence, and — since
 * the reactivation seam landed — the guarantee that redeeming a coupon or
 * granting a free plan ALWAYS leaves the store operational.
 */
describe('PromotionalApplyService', () => {
  let service: PromotionalApplyService;
  let prismaMock: any;
  let resolverMock: any;
  let eventEmitterMock: any;
  let redisMock: any;
  let evaluatorMock: any;
  let stateServiceMock: any;

  const baseFlags = {
    text_generation: {
      enabled: true,
      monthly_tokens_cap: 200000,
      degradation: 'warn',
    },
    streaming_chat: {
      enabled: true,
      daily_messages_cap: 200,
      degradation: 'warn',
    },
    tool_agents: { enabled: false, tools_allowed: [], degradation: 'block' },
  };

  beforeEach(() => {
    prismaMock = {
      subscription_plans: { findUnique: jest.fn() },
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    resolverMock = { invalidate: jest.fn().mockResolvedValue(undefined) };
    eventEmitterMock = { emit: jest.fn() };
    redisMock = { del: jest.fn().mockResolvedValue(1) };
    evaluatorMock = {
      evaluate: jest.fn().mockResolvedValue({
        promo_plan_id: 99,
        promo_plan_code: 'black-friday',
        eligible: true,
        reasons_blocked: [],
      }),
    };
    stateServiceMock = {
      transition: jest.fn().mockResolvedValue({}),
      ensureOperational: jest
        .fn()
        .mockResolvedValue({ finalState: 'active', path: ['active'] }),
    };

    service = new PromotionalApplyService(
      prismaMock,
      resolverMock,
      eventEmitterMock,
      redisMock,
      evaluatorMock,
      stateServiceMock,
    );
  });

  function promoPlan(overrides: any = {}) {
    return {
      id: 99,
      code: 'black-friday',
      is_promotional: true,
      promo_priority: 10,
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 500000,
          degradation: 'warn',
        },
        tool_agents: {
          enabled: true,
          tools_allowed: ['a', 'b'],
          degradation: 'warn',
        },
      },
      ...overrides,
    };
  }

  function subFixture(overrides: any = {}) {
    return {
      id: 1,
      store_id: 10,
      state: 'active',
      promotional_plan_id: null,
      promotional_plan: null,
      plan: { ai_feature_flags: baseFlags },
      partner_override: null,
      ...overrides,
    };
  }

  /**
   * In-memory harness around the REAL `SubscriptionStateService`, so these
   * tests exercise the actual reactivation seam (route resolution, per-hop
   * audit rows, exit guard, period window) instead of a stub that always
   * answers "active". A stub could not have caught the incident these tests
   * exist for: the old code simply never called the state service at all.
   */
  function makeStateHarness(initialState: string) {
    const row: any = {
      id: 1,
      store_id: 10,
      state: initialState,
      plan_id: 5,
      current_period_end: null,
      scheduled_cancel_at: null,
    };
    const events: any[] = [];

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
        findUnique: jest.fn(async () => ({ billing_cycle: 'monthly' })),
      },
    };

    const prisma: any = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const accessService: any = {
      invalidateCache: jest.fn().mockResolvedValue(undefined),
    };
    const emitter: any = { emit: jest.fn() };

    const stateService = new SubscriptionStateService(
      prisma,
      accessService,
      emitter,
    );

    /** Hops actually written to `subscription_events`, e.g. `cancelled->active`. */
    const hops = () =>
      events
        .filter((e) => e.type === 'state_transition')
        .map((e) => `${e.from_state}->${e.to_state}`);

    return { stateService, row, events, hops, tx, emitter, accessService };
  }

  /**
   * Rebuilds the service under test with the real state service wired in and
   * the store parked in `initialState`.
   */
  function withStoreInState(initialState: string) {
    const harness = makeStateHarness(initialState);
    service = new PromotionalApplyService(
      prismaMock,
      resolverMock,
      eventEmitterMock,
      redisMock,
      evaluatorMock,
      harness.stateService,
    );
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ state: initialState }),
    );
    return harness;
  }

  it('apply → union-of-max: caps raised, never subtracted', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    const resolved = updateCall.data.resolved_features;

    // Max between base 200000 and promo 500000 → 500000.
    expect(resolved.text_generation.monthly_tokens_cap).toBe(500000);
    // OR: base false, promo true → true.
    expect(resolved.tool_agents.enabled).toBe(true);
    // Base streaming_chat preserved.
    expect(resolved.streaming_chat.enabled).toBe(true);
    expect(resolved.streaming_chat.daily_messages_cap).toBe(200);
  });

  it('promo trying to reduce base cap → base wins (union never subtracts)', async () => {
    const lowPromo = promoPlan({
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 50000, // below base 200000
          degradation: 'warn',
        },
      },
    });
    prismaMock.subscription_plans.findUnique.mockResolvedValue(lowPromo);
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    const resolved = updateCall.data.resolved_features;
    expect(resolved.text_generation.monthly_tokens_cap).toBe(200000);
    expect(resolved.text_generation.enabled).toBe(true);
  });

  it('higher-priority existing promo wins over new lower-priority promo', async () => {
    const existingPromo = {
      id: 50,
      promo_priority: 100, // higher than incoming 10
      ai_feature_flags: {
        text_generation: {
          enabled: true,
          monthly_tokens_cap: 999999,
          degradation: 'warn',
        },
      },
      is_promotional: true,
    };
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ promotional_plan: existingPromo, promotional_plan_id: 50 }),
    );

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data.promotional_plan_id).toBe(50);
    expect(
      updateCall.data.resolved_features.text_generation.monthly_tokens_cap,
    ).toBe(999999);
  });

  it('apply sets promotional_applied_at and promotional_plan_id', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue(promoPlan());
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());

    await service.apply(10, 99);

    const updateCall = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updateCall.data.promotional_plan_id).toBe(99);
    expect(updateCall.data.promotional_applied_at).toBeInstanceOf(Date);
    expect(resolverMock.invalidate).toHaveBeenCalledWith(10);
    expect(redisMock.del).toHaveBeenCalledWith('sub:features:10');

    const [evtName, payload] = eventEmitterMock.emit.mock.calls[0];
    expect(evtName).toBe('subscription.promotional.applied');
    expect(payload.storeId).toBe(10);
    expect(payload.promoPlanId).toBe(99);
  });

  it('apply on non-promotional plan → throws', async () => {
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 99,
      is_promotional: false,
    });

    let threw = false;
    try {
      await service.apply(10, 99);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Reactivation seam — "no successful activation may leave the store degraded"
  //
  // PRODUCTION INCIDENT: a degraded store activated a free plan with a coupon.
  // The UI said "activado". The store stayed degraded. Root cause: `apply()`
  // gated the state transition on a local REACTIVATABLE_STATES list that
  // excluded `cancelled`/`expired`; when the gate said false the overlay was
  // still written and HTTP 200 returned, without ever touching the state.
  // ──────────────────────────────────────────────────────────────────────────

  describe('ensureOperational seam', () => {
    it('INCIDENT: coupon on a `cancelled` store leaves it active (walked, not jumped)', async () => {
      const h = withStoreInState('cancelled');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      // Terminality of `cancelled` is preserved: the seam WALKS the legal route
      // through `pending_payment`, it never shortcuts straight to `active`.
      expect(h.hops()).toEqual([
        'cancelled->pending_payment',
        'pending_payment->active',
      ]);
    });

    it('INCIDENT: coupon on an `expired` store leaves it active', async () => {
      const h = withStoreInState('expired');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      expect(h.hops()).toEqual([
        'expired->pending_payment',
        'pending_payment->active',
      ]);
    });

    it('regression guard: coupon on `grace_soft` still reactivates in one hop', async () => {
      const h = withStoreInState('grace_soft');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      expect(h.hops()).toEqual(['grace_soft->active']);
      // Recovery must not leave stale dunning columns behind.
      expect(h.row.grace_soft_until).toBeNull();
      expect(h.row.lock_reason).toBeNull();
      expect(h.row.suspend_at).toBeNull();
      expect(h.row.cancel_at).toBeNull();
      expect(h.row.scheduled_cancel_at).toBeNull();
    });

    it('regression guard: coupon on `suspended` still reactivates in one hop', async () => {
      const h = withStoreInState('suspended');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      expect(h.hops()).toEqual(['suspended->active']);
    });

    it('coupon on a `no_plan` store (free-plan grant) leaves it active', async () => {
      const h = withStoreInState('no_plan');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      expect(h.hops()).toEqual(['no_plan->active']);
    });

    it('coupon on an already `active` store is idempotent: no transition, no window rewrite', async () => {
      const h = withStoreInState('active');

      await service.apply(10, 99);

      expect(h.row.state).toBe('active');
      expect(h.hops()).toEqual([]);
      // A no-op must not write anything at all — not even the period window,
      // otherwise re-redeeming a coupon would gift a fresh cycle.
      expect(h.tx.store_subscriptions.update).not.toHaveBeenCalled();
      expect(h.emitter.emit).not.toHaveBeenCalled();
      // The feature overlay itself is still applied.
      expect(prismaMock.store_subscriptions.update).toHaveBeenCalled();
    });

    it('the promo window is written by the seam, never by the overlay update', async () => {
      const h = withStoreInState('suspended');

      await service.apply(10, 99);

      const overlayData =
        prismaMock.store_subscriptions.update.mock.calls[0][0].data;
      // No duplicated period/scheduling policy in this service any more.
      expect(overlayData.current_period_start).toBeUndefined();
      expect(overlayData.current_period_end).toBeUndefined();
      expect(overlayData.next_billing_at).toBeUndefined();
      expect(overlayData.grace_soft_until).toBeUndefined();
      expect(overlayData.suspend_at).toBeUndefined();
      expect(overlayData.cancel_at).toBeUndefined();
      // ...but the window IS opened, sized by the promo duration (monthly promo
      // plan with no explicit duration_days → 30 days).
      expect(h.row.current_period_end).toBeInstanceOf(Date);
      const days = Math.round(
        (h.row.current_period_end.getTime() - Date.now()) / 86400000,
      );
      expect(days).toBe(30);
      expect(h.row.auto_renew).toBe(true);
    });

    it('propagates a seam failure instead of reporting a silent success', async () => {
      const h = withStoreInState('cancelled');
      // Simulate the exit guard finding a store that did not come out
      // operational (the invariant the seam exists to enforce).
      h.tx.store_subscriptions.findFirst = jest
        .fn()
        .mockResolvedValue({ state: 'cancelled' });

      await expect(service.apply(10, 99)).rejects.toBeDefined();
      // The overlay must NOT be written when the store is still degraded.
      expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
    });
  });
});
