import {
  SubscriptionStateService,
  LOCK_REASON_PLAN_RETIRED,
  LOCK_REASON_PAST_DUE,
} from './subscription-state.service';

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
        findFirst: jest.fn(),
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
      subscription_plans: {
        findUnique: jest.fn(),
      },
      // El predicado de elegibilidad (renewal-eligibility.contract.ts) lee los
      // medios de pago de la suscripción para decidir si una reactivación puede
      // encender `auto_renew`. Por defecto: sin medios ⇒ autopago en pausa.
      subscription_payment_methods: {
        findMany: jest.fn().mockResolvedValue([]),
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

  // QUI-676 — every state that may legally ENTER pending_payment must be able
  // to come back out of it, because the checkout paths write that origin state
  // verbatim into `pending_revert_state` and the rollback paths have nothing
  // else to go on. `trial` and `draft` were missing, so a trial conversion (or
  // a first purchase) whose Wompi webhook never arrived could not be reverted:
  // ReconcileStuckPendingJob threw "Illegal transition pending_payment ->
  // trial" every 5 minutes and the store stayed parked in pending_payment.
  describe('QUI-676 — pending_payment rollback symmetry', () => {
    it.each([
      ['trial', 'trial_conversion whose webhook never arrived'],
      ['draft', 'first purchase abandoned before the gateway confirmed'],
    ])(
      'pending_payment → %s is legal and persists the revert',
      async (revertState) => {
        prismaMock.$queryRaw.mockResolvedValue([
          { id: 100, state: 'pending_payment' },
        ]);
        prismaMock.store_subscriptions.update.mockResolvedValue({
          id: 100,
          state: revertState,
        });

        const result = await service.transition(10, revertState as any, {
          reason: 'reconcile_stuck_pending_change',
          triggeredByJob: 'reconcile-stuck-pending',
        });

        const updArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
        expect(updArg.data.state).toBe(revertState);

        const evtArg = prismaMock.subscription_events.create.mock.calls[0][0];
        expect(evtArg.data.from_state).toBe('pending_payment');
        expect(evtArg.data.to_state).toBe(revertState);
        expect(result.state).toBe(revertState);
      },
    );

    it('does not throw SUBSCRIPTION_010 reverting pending_payment → trial', async () => {
      prismaMock.$queryRaw.mockResolvedValue([
        { id: 100, state: 'pending_payment' },
      ]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 100,
        state: 'trial',
      });

      await expect(
        service.transition(10, 'trial', {
          reason: 'reconcile_stuck_pending_change',
        }),
      ).resolves.toMatchObject({ state: 'trial' });
    });

    // The symmetry is the invariant, not the two literals above: assert it
    // over the whole map so a future edge added into pending_payment without
    // its way back fails here instead of in production.
    it('every state that can enter pending_payment can also leave to it', () => {
      const states = [
        'draft',
        'trial',
        'active',
        'pending_payment',
        'grace_soft',
        'grace_hard',
        'suspended',
        'blocked',
        'cancelled',
        'expired',
        'no_plan',
      ] as const;

      const stranded = states.filter(
        (s) =>
          s !== 'pending_payment' &&
          service.isLegalTransition(s, 'pending_payment') &&
          !service.isLegalTransition('pending_payment', s),
      );

      expect(stranded).toEqual([]);
    });
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

  // ----------------------------------------------------------------------
  // lock_reason — the motive shown to the customer must be the true one
  // ----------------------------------------------------------------------

  describe('lock_reason write + preservation', () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** Data of the FIRST `store_subscriptions.update` (the state write). */
    function stateUpdateData() {
      return prismaMock.store_subscriptions.update.mock.calls[0][0].data;
    }

    /**
     * Primes `evaluateAndTransitionForSubscription` for a subscription whose
     * period lapsed `daysPastPeriodEnd` ago, on a plan with the 3/7/14/30
     * dunning cadence used across this spec.
     */
    function primeEvaluation(opts: {
      state: string;
      lockReason?: string | null;
      daysPastPeriodEnd: number;
      planState?: string | null;
      archivedAt?: Date | null;
    }) {
      prismaMock.store_subscriptions.findUnique.mockResolvedValue({
        id: 1,
        store_id: 10,
        state: opts.state,
        lock_reason: opts.lockReason ?? null,
        metadata: null,
        trial_ends_at: null,
        cancelled_at: null,
        updated_at: new Date(),
        current_period_end: new Date(
          Date.now() - opts.daysPastPeriodEnd * DAY,
        ),
        promotional_plan_id: null,
        promotional_plan: null,
        plan: {
          state: opts.planState ?? 'active',
          archived_at: opts.archivedAt ?? null,
          grace_period_soft_days: 3,
          grace_period_hard_days: 7,
          suspension_day: 14,
          cancellation_day: 30,
        },
      });
      prismaMock.$queryRaw.mockResolvedValue([{ id: 1, state: opts.state }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 1,
        state: 'updated',
      });
    }

    // ---- Write at the origin (grace is where degradation starts) ---------

    it('persists an explicit lockReason on a grace_soft transition', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 100,
        state: 'grace_soft',
      });

      await service.transition(10, 'grace_soft', {
        reason: LOCK_REASON_PLAN_RETIRED,
        lockReason: LOCK_REASON_PLAN_RETIRED,
      });

      // The renewal job stamps the motive here; without this write the
      // SUBSCRIPTION_011 consumer never sees it.
      expect(stateUpdateData().lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
    });

    it('leaves lock_reason intact on a grace_soft transition with no motive', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'active' }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 100,
        state: 'grace_soft',
      });

      await service.transition(10, 'grace_soft', { reason: 'past_due_soft' });

      // `undefined` = column untouched (never blanked by accident).
      expect(stateUpdateData().lock_reason).toBeUndefined();
    });

    it('still defaults a manual suspension to admin_manual', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'grace_hard' }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 100,
        state: 'suspended',
      });

      await service.transition(10, 'suspended', { reason: 'admin_action' });

      expect(stateUpdateData().lock_reason).toBe('admin_manual');
    });

    it('clears lock_reason on recovery to active', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 100, state: 'suspended' }]);
      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: 100,
        state: 'active',
      });

      await service.transition(10, 'active', { reason: 'payment_confirmed' });

      expect(stateUpdateData().lock_reason).toBeNull();
    });

    // ---- Survival across the dunning escalation --------------------------

    it('grace_soft → grace_hard preserves a retired-plan motive', async () => {
      primeEvaluation({
        state: 'grace_soft',
        lockReason: LOCK_REASON_PLAN_RETIRED,
        daysPastPeriodEnd: 8, // past hard (7), before suspension (14)
      });

      await service.evaluateAndTransitionForSubscription(1);

      const data = stateUpdateData();
      expect(data.state).toBe('grace_hard');
      expect(data.lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
    });

    it('grace_hard → suspended preserves a retired-plan motive instead of stamping past_due', async () => {
      primeEvaluation({
        state: 'grace_hard',
        lockReason: LOCK_REASON_PLAN_RETIRED,
        daysPastPeriodEnd: 20, // past suspension (14), before cancellation (30)
      });

      await service.evaluateAndTransitionForSubscription(1);

      const data = stateUpdateData();
      expect(data.state).toBe('suspended');
      // The store owes nothing: it cannot be told it failed to pay.
      expect(data.lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
      expect(data.lock_reason).not.toBe(LOCK_REASON_PAST_DUE);
    });

    it('preserves any non-null motive, not just the retired-plan one', async () => {
      primeEvaluation({
        state: 'grace_hard',
        lockReason: 'chargeback',
        daysPastPeriodEnd: 20,
      });

      await service.evaluateAndTransitionForSubscription(1);

      expect(stateUpdateData().lock_reason).toBe('chargeback');
    });

    // ---- The ordinary impago path is untouched ---------------------------

    it('impago with no prior motive still ends up suspended with past_due', async () => {
      primeEvaluation({
        state: 'grace_hard',
        lockReason: null,
        daysPastPeriodEnd: 20,
      });

      await service.evaluateAndTransitionForSubscription(1);

      const data = stateUpdateData();
      expect(data.state).toBe('suspended');
      expect(data.lock_reason).toBe(LOCK_REASON_PAST_DUE);
    });

    it('impago on the grace rungs leaves lock_reason untouched (pre-existing behaviour)', async () => {
      primeEvaluation({
        state: 'active',
        lockReason: null,
        daysPastPeriodEnd: 4, // past soft (3), before hard (7)
      });

      await service.evaluateAndTransitionForSubscription(1);

      const data = stateUpdateData();
      expect(data.state).toBe('grace_soft');
      expect(data.lock_reason).toBeUndefined();
    });

    // ---- Origin stamp when the state engine detects the retired plan -----

    it('stamps the retired-plan motive when the engine itself degrades an archived-plan store', async () => {
      primeEvaluation({
        state: 'active',
        lockReason: null,
        daysPastPeriodEnd: 1, // before the soft deadline: planUnavailable drives it
        planState: 'archived',
        archivedAt: new Date(Date.now() - 5 * DAY),
      });

      await service.evaluateAndTransitionForSubscription(1);

      const data = stateUpdateData();
      expect(data.state).toBe('grace_soft');
      expect(data.lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
    });

    it('records the motive decision in the audit payload', async () => {
      primeEvaluation({
        state: 'grace_hard',
        lockReason: LOCK_REASON_PLAN_RETIRED,
        daysPastPeriodEnd: 20,
      });

      await service.evaluateAndTransitionForSubscription(1);

      const evt = prismaMock.subscription_events.create.mock.calls[0][0].data;
      expect(evt.payload.previous_lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
      expect(evt.payload.lock_reason).toBe(LOCK_REASON_PLAN_RETIRED);
    });
  });

  // ----------------------------------------------------------------------
  // ensureOperational — the single reactivation seam
  // ----------------------------------------------------------------------

  describe('ensureOperational', () => {
    const SUB_ID = 100;
    const STORE_ID = 10;
    const DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * Tarjeta que SÍ puede sostener una renovación: activa, tipo `card`, con
     * credencial recurrente, vigente y por debajo del techo de fallos. Satisface
     * `isRenewalEligible` de `renewal-eligibility.contract.ts`.
     */
    const ELIGIBLE_CARD = {
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
    };

    /**
     * Primes `$queryRaw` for the seam's lock read + one read per expected hop,
     * plus the exit-guard `findFirst`.
     *
     * The route is declared by the TEST, so a SUT that walks a different route
     * desynchronises the `$queryRaw` sequence and fails (either an illegal
     * transition or an exhausted mock) on top of the explicit `path` assertion.
     */
    function primeRoute(opts: {
      from: string;
      hops: string[];
      planId?: number | null;
      currentPeriodEnd?: Date | null;
      scheduledCancelAt?: Date | null;
      /** State the exit guard re-reads. Defaults to the last hop. */
      finalState?: string;
      /** `false` ⇒ la suscripción no tiene ningún medio apto para renovar. */
      eligibleCard?: boolean;
    }) {
      prismaMock.$queryRaw.mockReset();

      // 1. Seam lock read (includes the period columns).
      prismaMock.$queryRaw.mockResolvedValueOnce([
        {
          id: SUB_ID,
          state: opts.from,
          plan_id: opts.planId ?? null,
          current_period_end: opts.currentPeriodEnd ?? null,
          scheduled_cancel_at: opts.scheduledCancelAt ?? null,
        },
      ]);

      // 2. One FOR UPDATE read per hop, reflecting the state before it.
      let cursor = opts.from;
      for (const hop of opts.hops) {
        prismaMock.$queryRaw.mockResolvedValueOnce([
          { id: SUB_ID, state: cursor },
        ]);
        cursor = hop;
      }

      prismaMock.store_subscriptions.update.mockResolvedValue({
        id: SUB_ID,
        state: cursor,
      });

      prismaMock.store_subscriptions.findFirst.mockResolvedValue({
        state: opts.finalState ?? cursor,
        current_period_end: null,
        scheduled_cancel_at: null,
        // Leído por `applyReactivationWindow` antes del guard de salida para
        // resolver `auto_renew` y preservar el resto del `metadata`.
        auto_renew: true,
        metadata: null,
      });

      // Elegibilidad de renovación. `auto_renew: true` en una reactivación ya NO
      // es incondicional: exige un medio apto. Por defecto se prima una tarjeta
      // apta para que estos casos midan la ventana de facturación y no el
      // predicado; el caso sin tarjeta tiene su propia prueba.
      prismaMock.subscription_payment_methods.findMany.mockResolvedValue(
        opts.eligibleCard === false ? [] : [ELIGIBLE_CARD],
      );
    }

    /** Last `store_subscriptions.update` = the reactivation-window write. */
    function lastUpdateData() {
      const calls = prismaMock.store_subscriptions.update.mock.calls;
      return calls[calls.length - 1][0].data;
    }

    it('rejects invalid storeId', async () => {
      await expect(
        service.ensureOperational(0, { reason: 'bad' }),
      ).rejects.toBeDefined();
    });

    it('throws when the store has no subscription row', async () => {
      prismaMock.$queryRaw.mockReset();
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await expect(
        service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' }),
      ).rejects.toBeDefined();
      expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
    });

    // ---- Idempotence: already operational -------------------------------

    it.each(['active', 'trial'])(
      'is an idempotent NO-OP when already %s (no writes, no free period)',
      async (state) => {
        primeRoute({ from: state, hops: [] });

        const result = await service.ensureOperational(STORE_ID, {
          reason: 'duplicate_webhook',
        });

        expect(result.finalState).toBe(state);
        expect(result.path).toEqual([]);
        // No state write, no audit row, and crucially NO period extension:
        // an already-paid window must not be gifted a fresh cycle.
        expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
        expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();
        expect(eventEmitterMock.emit).not.toHaveBeenCalled();
        expect(accessServiceMock.invalidateCache).not.toHaveBeenCalled();
      },
    );

    // ---- `active` with a LAPSED period: the on-time renewal --------------
    //
    // `state` and `current_period_end` are two independent truths. Between the
    // moment a period runs out and the `subscription-state-engine` cron that
    // degrades the row, a subscription sits `active` with a spent window — and
    // a renewal collected in that gap is the PUNCTUAL payment. The seam used
    // to return before the window writer for any `active` row, so the invoice
    // went `paid`, the payment `succeeded`, the window stayed spent, and the
    // cron degraded a store that had already paid.
    //
    // Regression source: store 96 / subscription 57, paid 2026-08-26, degraded
    // to `grace_soft` 2026-08-29 on a `current_period_end` of 2026-08-25.

    it('advances the window when already active but the period LAPSED (paid renewal)', async () => {
      primeRoute({
        from: 'active',
        hops: [],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() - 3 * DAY_MS),
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'monthly',
      });

      const result = await service.ensureOperational(STORE_ID, {
        reason: 'payment_42_approved',
      });

      // Still a no-op as far as the STATE machine goes: no hop, no audit row.
      expect(result.finalState).toBe('active');
      expect(result.path).toEqual([]);
      expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();

      // But the WINDOW was rebuilt — this is the whole point.
      const data = lastUpdateData();
      expect(data.current_period_end).toBeInstanceOf(Date);
      expect(data.current_period_end.getTime()).toBeGreaterThan(Date.now());
      // 30-day cycle minus the 3 consumed days, so the store is not gifted the
      // time it spent past its own due date.
      const expectedEnd = Date.now() + 27 * DAY_MS;
      expect(data.current_period_end.getTime()).toBeGreaterThan(
        expectedEnd - 10_000,
      );
      expect(data.current_period_end.getTime()).toBeLessThan(
        expectedEnd + 10_000,
      );
      expect(data.next_billing_at).toEqual(data.current_period_end);
    });

    it('voids the dunning clocks when the window is rebuilt on the no-op route', async () => {
      primeRoute({
        from: 'active',
        hops: [],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() - 3 * DAY_MS),
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'monthly',
      });

      await service.ensureOperational(STORE_ID, {
        reason: 'payment_42_approved',
      });

      // Deadlines derived from the period that was just replaced describe
      // nothing any more. Left in place, the state engine degrades a store
      // that has just paid — which is exactly what happened in production.
      const data = lastUpdateData();
      expect(data.grace_soft_until).toBeNull();
      expect(data.grace_hard_until).toBeNull();
      expect(data.lock_reason).toBeNull();
    });

    it('honours an explicit ctx.periodEnd on the no-op route (pins the invoice window)', async () => {
      const requested = new Date(Date.now() + 26 * DAY_MS);
      primeRoute({
        from: 'active',
        hops: [],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() - 4 * DAY_MS),
      });

      await service.ensureOperational(STORE_ID, {
        reason: 'manual_payment',
        periodEnd: requested,
      });

      const data = lastUpdateData();
      expect(data.current_period_end.getTime()).toBe(
        requested.getTime() - 4 * DAY_MS,
      );
      expect(prismaMock.subscription_plans.findUnique).not.toHaveBeenCalled();
    });

    it('writes NOTHING when already active with an unexpired period (duplicate webhook)', async () => {
      primeRoute({
        from: 'active',
        hops: [],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS),
      });

      const result = await service.ensureOperational(STORE_ID, {
        reason: 'duplicate_webhook',
      });

      expect(result.path).toEqual([]);
      // The window writer ends in an UNCONDITIONAL row update that also voids
      // `scheduled_cancel_at` / `suspend_at` / `cancel_at`. Reaching it on a
      // healthy store would silently cancel the user's own scheduled
      // cancellation, so the spent-window guard is asked BEFORE the call.
      expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
      expect(prismaMock.subscription_events.create).not.toHaveBeenCalled();
    });

    it('leaves an active row with a NULL period alone (no cycle minted)', async () => {
      primeRoute({
        from: 'active',
        hops: [],
        planId: 7,
        currentPeriodEnd: null,
      });

      await service.ensureOperational(STORE_ID, { reason: 'duplicate_webhook' });

      // `null` counts as spent only on the hop route, where it means
      // "recovering from a degraded state that never had a cycle". Minting one
      // for a healthy `active` row is a behaviour change no incident asked for.
      expect(prismaMock.store_subscriptions.update).not.toHaveBeenCalled();
    });

    // ---- One entry route per degraded state -----------------------------

    it.each([
      'grace_soft',
      'grace_hard',
      'suspended',
      'blocked',
      'no_plan',
      'draft',
      'pending_payment',
    ])('recovers %s with a single direct hop to active', async (from) => {
      primeRoute({ from, hops: ['active'] });

      const result = await service.ensureOperational(STORE_ID, {
        reason: 'payment_confirmed',
      });

      expect(result.finalState).toBe('active');
      expect(result.path).toEqual(['active']);
    });

    it.each(['cancelled', 'expired'])(
      'recovers %s by WALKING through pending_payment (terminality preserved)',
      async (from) => {
        primeRoute({ from, hops: ['pending_payment', 'active'] });

        const result = await service.ensureOperational(STORE_ID, {
          reason: 're_subscribe_paid',
        });

        expect(result.finalState).toBe('active');
        // Two hops: `active` is NOT in TRANSITIONS[cancelled|expired], so the
        // legal path is walked instead of the table being widened.
        expect(result.path).toEqual(['pending_payment', 'active']);
      },
    );

    it('writes one audit row per hop for the two-hop route', async () => {
      primeRoute({ from: 'cancelled', hops: ['pending_payment', 'active'] });

      await service.ensureOperational(STORE_ID, { reason: 're_subscribe_paid' });

      const events = prismaMock.subscription_events.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(events).toHaveLength(2);
      expect(events[0].from_state).toBe('cancelled');
      expect(events[0].to_state).toBe('pending_payment');
      expect(events[1].from_state).toBe('pending_payment');
      expect(events[1].to_state).toBe('active');
      // Path is diagnosable from the audit payload.
      expect(events[0].payload.ensure_operational).toBe(true);
      expect(events[0].payload.ensure_operational_route).toEqual([
        'pending_payment',
        'active',
      ]);
      expect(events[0].payload.ensure_operational_hop).toBe(1);
      expect(events[1].payload.ensure_operational_hop).toBe(2);
    });

    // ---- Exit guard ------------------------------------------------------

    it('throws instead of reporting success when the path leaves the store degraded', async () => {
      // SIMULATED transition failure: the hop is a no-op, so the store stays
      // suspended even though the route "completed".
      primeRoute({
        from: 'suspended',
        hops: ['active'],
        finalState: 'suspended',
      });
      jest
        .spyOn(service, 'transitionInTx')
        .mockResolvedValue({ id: SUB_ID, state: 'suspended' } as any);

      await expect(
        service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' }),
      ).rejects.toMatchObject({
        // Server invariant broke; the client did nothing wrong.
        errorCode: 'SUBSCRIPTION_INTERNAL_ERROR',
      });

      // A failed reactivation must not look like a success to listeners.
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });

    it('throws when the exit guard finds no row at all', async () => {
      primeRoute({ from: 'suspended', hops: ['active'] });
      prismaMock.store_subscriptions.findFirst.mockResolvedValue(null);

      await expect(
        service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' }),
      ).rejects.toBeDefined();
    });

    // ---- Grace discount + scheduled-cancel cleanup -----------------------

    it('discounts consumed grace days: 5 days past due on an annual plan → now + 360d', async () => {
      const originalPeriodEnd = new Date(Date.now() - 5 * DAY_MS);
      primeRoute({
        from: 'grace_hard',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: originalPeriodEnd,
        scheduledCancelAt: new Date(Date.now() + 10 * DAY_MS),
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'annual',
      });

      const before = Date.now();
      await service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' });
      const after = Date.now();

      const data = lastUpdateData();
      const expectedMin = before + 360 * DAY_MS;
      const expectedMax = after + 360 * DAY_MS;

      // 365 (annual) - 5 (consumed operating during grace) = 360.
      expect(data.current_period_end.getTime()).toBeGreaterThanOrEqual(
        expectedMin,
      );
      expect(data.current_period_end.getTime()).toBeLessThanOrEqual(expectedMax);
      expect(data.next_billing_at.getTime()).toBe(
        data.current_period_end.getTime(),
      );

      // A reactivation voids any scheduled cancellation: no cron may cancel
      // what the customer just paid for.
      expect(data.scheduled_cancel_at).toBeNull();
      // `auto_renew: true` porque `primeRoute` primó una tarjeta apta. Antes esta
      // aserción pasaba SIN ningún medio de pago en el mock, que es justo lo que
      // blindaba el defecto: la ventana de reactivación imponía `true` y pisaba el
      // apagado que el gate acababa de escribir en la misma transacción.
      expect(data.auto_renew).toBe(true);
      // Stale dunning deadlines must not survive either.
      expect(data.suspend_at).toBeNull();
      expect(data.cancel_at).toBeNull();
      // The seam never touches plan ownership (ADR-7).
      expect(data.plan_id).toBeUndefined();
      expect(data.paid_plan_id).toBeUndefined();
    });

    it('reactivating WITHOUT an eligible card leaves auto_renew off and remembers the intent', async () => {
      primeRoute({
        from: 'grace_hard',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS),
        eligibleCard: false,
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'monthly',
      });

      await service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' });

      const data = lastUpdateData();
      // ESTA es la regla nueva: la reactivación no impone el autopago. Pagar con
      // un medio que no renueva (Nequi/PSE) dejaba la tienda "activa con
      // autopago" y sin nada con qué cobrar — la renovación fallaba en silencio.
      expect(data.auto_renew).toBe(false);
      // La intención del cliente queda recordada en el JSON que YA existe, que es
      // lo que autoriza el rearme automático al guardar una tarjeta.
      expect(data.metadata).toMatchObject({
        auto_renew_intent: {
          desired: true,
          reason: 'no_card_credential',
          paused_by: 'reactivation_window',
          rearmed_at: null,
        },
      });
      // El resto de la reactivación no cambia: la ventana se recalcula igual.
      expect(data.scheduled_cancel_at).toBeNull();
      expect(data.current_period_end).toBeInstanceOf(Date);
    });

    it('reactivating with an ineligible card (Nequi-like, no card type) also holds autopay off', async () => {
      primeRoute({
        from: 'suspended',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: new Date(Date.now() - 1 * DAY_MS),
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'monthly',
      });
      // Medio guardado que NO es tarjeta: Wompi no lo puede cobrar con
      // `recurrent: true`, así que no sostiene una renovación.
      prismaMock.subscription_payment_methods.findMany.mockResolvedValue([
        { ...ELIGIBLE_CARD, type: 'nequi' },
      ]);

      await service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' });

      const data = lastUpdateData();
      expect(data.auto_renew).toBe(false);
    });

    it('applies the discount on top of an explicit ctx.periodEnd', async () => {
      const originalPeriodEnd = new Date(Date.now() - 5 * DAY_MS);
      const requested = new Date(Date.now() + 30 * DAY_MS);
      primeRoute({
        from: 'grace_soft',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: originalPeriodEnd,
      });

      await service.ensureOperational(STORE_ID, {
        reason: 'manual_payment',
        periodEnd: requested,
      });

      const data = lastUpdateData();
      expect(data.current_period_end.getTime()).toBe(
        requested.getTime() - 5 * DAY_MS,
      );
      // An explicit base needs no plan lookup.
      expect(prismaMock.subscription_plans.findUnique).not.toHaveBeenCalled();
    });

    it('leaves an unexpired period untouched (no free cycle on mid-period unblock)', async () => {
      const originalPeriodEnd = new Date(Date.now() + 20 * DAY_MS);
      primeRoute({
        from: 'blocked',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: originalPeriodEnd,
      });

      await service.ensureOperational(STORE_ID, { reason: 'admin_unblock' });

      const data = lastUpdateData();
      expect(data.current_period_end).toBeUndefined();
      expect(data.current_period_start).toBeUndefined();
      expect(data.next_billing_at).toBeUndefined();
      // Cleanup still applies.
      expect(data.scheduled_cancel_at).toBeNull();
    });

    it('clamps the discount so the new period never lands in the past', async () => {
      // 45 days past due on a monthly (30d) plan: a naive discount would put
      // the new period end BEFORE now and drop the store straight back into
      // dunning — the exact degradation this seam prevents.
      const originalPeriodEnd = new Date(Date.now() - 45 * DAY_MS);
      primeRoute({
        from: 'suspended',
        hops: ['active'],
        planId: 7,
        currentPeriodEnd: originalPeriodEnd,
      });
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        billing_cycle: 'monthly',
      });

      const before = Date.now();
      await service.ensureOperational(STORE_ID, { reason: 'payment_confirmed' });

      const data = lastUpdateData();
      expect(data.current_period_end.getTime()).toBeGreaterThan(before);
      // Floor of one day of runway.
      expect(data.current_period_end.getTime() - before).toBeGreaterThanOrEqual(
        DAY_MS - 5,
      );
    });

    it('falls back to the monthly cycle when the subscription has no plan', async () => {
      primeRoute({
        from: 'no_plan',
        hops: ['active'],
        planId: null,
        currentPeriodEnd: null,
      });

      const before = Date.now();
      await service.ensureOperational(STORE_ID, { reason: 'free_plan_grant' });

      const data = lastUpdateData();
      expect(prismaMock.subscription_plans.findUnique).not.toHaveBeenCalled();
      // No previous period end → nothing consumed → full 30-day cycle.
      expect(data.current_period_end.getTime()).toBeGreaterThanOrEqual(
        before + 30 * DAY_MS,
      );
    });

    // ---- Side effects ----------------------------------------------------

    it('invalidates the access cache and emits one state.changed carrying the path', async () => {
      primeRoute({ from: 'cancelled', hops: ['pending_payment', 'active'] });

      await service.ensureOperational(STORE_ID, {
        reason: 're_subscribe_paid',
        triggeredByUserId: 42,
      });

      expect(accessServiceMock.invalidateCache).toHaveBeenCalledWith(STORE_ID);
      expect(eventEmitterMock.emit).toHaveBeenCalledTimes(1);
      const [evtName, payload] = eventEmitterMock.emit.mock.calls[0];
      expect(evtName).toBe('subscription.state.changed');
      expect(payload.fromState).toBe('cancelled');
      expect(payload.toState).toBe('active');
      expect(payload.path).toEqual(['pending_payment', 'active']);
      expect(payload.triggeredByUserId).toBe(42);
    });

    it('ensureOperationalInTx leaves cache + events to the caller', async () => {
      primeRoute({ from: 'cancelled', hops: ['pending_payment', 'active'] });

      const result = await service.ensureOperationalInTx(
        prismaMock as any,
        STORE_ID,
        { reason: 'payment_confirmed_in_tx' },
      );

      expect(result.finalState).toBe('active');
      expect(result.path).toEqual(['pending_payment', 'active']);
      // Runs inside the caller's tx: no nested $transaction, and no
      // side effects that could fire on a rolled-back change.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(accessServiceMock.invalidateCache).not.toHaveBeenCalled();
      expect(eventEmitterMock.emit).not.toHaveBeenCalled();
    });

    it('ensureOperationalInTx rejects invalid storeId', async () => {
      await expect(
        service.ensureOperationalInTx(prismaMock as any, -1, {
          reason: 'bad',
        }),
      ).rejects.toBeDefined();
    });
  });
});
