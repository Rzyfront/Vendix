import { Prisma } from '@prisma/client';
import { SubscriptionProrationService } from './subscription-proration.service';

/**
 * Unit tests for SubscriptionProrationService.
 * Focus: preview upgrade (charge > 0), downgrade (credit), same-tier (0),
 * and apply() emitting plan_changed event.
 */
describe('SubscriptionProrationService', () => {
  let service: SubscriptionProrationService;
  let prismaMock: any;
  let billingMock: any;
  let stateMock: any;
  let eventEmitterMock: any;
  let redisMock: any;

  // Default paid invoice baseline (effective_price=100, no partner split).
  // All tests that call preview() need subscription_invoices.findFirst set up
  // because getPaidBaseline() is called inside preview() (ADR-3).
  // Override per-test if a different baseline is needed.
  function defaultPaidInvoice(overrides: any = {}) {
    return {
      id: 99,
      total: new Prisma.Decimal('100.00'),
      to_plan_id: 5,
      split_breakdown: { vendix_share: '100.00', partner_share: '0.00' },
      updated_at: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_plans: {
        findUnique: jest.fn(),
      },
      subscription_invoices: {
        // Default: one paid invoice with effective_price=100 (current plan baseline).
        // Override per-test for specific baseline scenarios.
        findFirst: jest.fn().mockResolvedValue(defaultPaidInvoice()),
      },
      subscription_events: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    };

    billingMock = {
      computePricing: jest.fn(),
      issueInvoice: jest.fn().mockResolvedValue(null),
    };

    stateMock = { transition: jest.fn() };
    eventEmitterMock = { emit: jest.fn() };
    redisMock = { del: jest.fn().mockResolvedValue(1) };

    service = new SubscriptionProrationService(
      prismaMock,
      billingMock,
      stateMock,
      eventEmitterMock,
      redisMock,
    );
  });

  function subFixture(overrides: any = {}) {
    const now = new Date();
    return {
      id: 1,
      store_id: 10,
      plan_id: 5,
      state: 'active',
      trial_ends_at: null,
      metadata: null,
      current_period_start: new Date(now.getTime() - 10 * 86400000), // 10d ago
      current_period_end: new Date(now.getTime() + 20 * 86400000), // 20d ahead
      plan: {
        id: 5,
        code: 'pro',
        name: 'Pro',
        base_price: new Prisma.Decimal(100),
        max_partner_margin_pct: null,
        billing_cycle: 'monthly',
      },
      partner_override: null,
      ...overrides,
    };
  }

  it('preview upgrade → proration_amount > 0, kind=upgrade', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'business',
      base_price: new Prisma.Decimal(200),
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // ADR-3: computePricing is called once (for new plan only).
    // The baseline comes from getPaidBaseline() → defaultPaidInvoice (total=100).
    billingMock.computePricing.mockReturnValueOnce({
      base_price: new Prisma.Decimal(200),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(200),
      partner_org_id: null,
    });

    const preview = await service.preview(1, 6);

    expect(preview.kind).toBe('upgrade');
    expect(Number(preview.proration_amount)).toBeGreaterThan(0);
    expect(preview.invoice_to_issue).not.toBeNull();
    expect(preview.credit_to_apply_next_cycle).toBe('0.00');
  });

  it('preview downgrade → proration_amount < 0, credit applied next cycle', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 4,
      code: 'starter',
      base_price: new Prisma.Decimal(50),
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // ADR-3: computePricing called once (new plan). Baseline=100 from defaultPaidInvoice.
    // diff = 50 - 100 = -50 < 0 → 'downgrade'.
    billingMock.computePricing.mockReturnValueOnce({
      base_price: new Prisma.Decimal(50),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(50),
      partner_org_id: null,
    });

    const preview = await service.preview(1, 4);

    expect(preview.kind).toBe('downgrade');
    expect(Number(preview.proration_amount)).toBeLessThan(0);
    expect(Number(preview.credit_to_apply_next_cycle)).toBeGreaterThan(0);
    expect(preview.invoice_to_issue).toBeNull();
  });

  it('calculateProration clamps direction correctly for same-price diff=0', () => {
    const res = service.calculateProration(
      { effective_price: new Prisma.Decimal(100) },
      { effective_price: new Prisma.Decimal(100) },
      15,
      30,
    );
    expect(res.prorationAmount.toFixed(2)).toBe('0.00');
    // diff=0 returns 'credit' (not > 0)
    expect(res.direction).toBe('credit');
  });

  // S3.4 — Trial → free plan swap (targetIsFree=true). It is immediate and
  // starts a fresh free cycle; remaining trial days are not carried over.
  it('preview during active trial to free is immediate with proration_amount=0', async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 86400000); // +5d
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ state: 'trial', trial_ends_at: trialEndsAt }),
    );
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'free',
      name: 'Free',
      base_price: new Prisma.Decimal(0),
      is_free: true,
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // Target is a free plan → computePricing returns effective_price=0.
    billingMock.computePricing.mockReturnValueOnce({
      base_price: new Prisma.Decimal(0),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(0),
      partner_org_id: null,
    });

    const preview = await service.preview(1, 6);

    expect(preview.kind).toBe('trial_plan_swap');
    expect(preview.mode).toBe('trial_plan_swap');
    expect(preview.proration_amount).toBe('0.00');
    expect(preview.invoice_to_issue).toBeNull();
    expect(preview.applies_immediately).toBe(true);
    expect(preview.credit_to_apply_next_cycle).toBe('0.00');
    expect(preview.days_remaining).toBe(0);
    expect(preview.cycle_days).toBe(30);
    expect(preview.trial_swap).toBeUndefined();
    expect(new Date(preview.effective_at ?? '').getTime()).toBeLessThan(
      trialEndsAt.getTime(),
    );
  });

  it('preview when state=active does NOT enter trial_plan_swap branch', async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 86400000);
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ state: 'active', trial_ends_at: trialEndsAt }),
    );
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'business',
      name: 'Business',
      base_price: new Prisma.Decimal(200),
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // ADR-3: one computePricing call (new plan). Baseline=100 from defaultPaidInvoice.
    billingMock.computePricing.mockReturnValueOnce({
      base_price: new Prisma.Decimal(200),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(200),
      partner_org_id: null,
    });

    const preview = await service.preview(1, 6);

    expect(preview.kind).toBe('upgrade');
    expect(preview.kind).not.toBe('trial_plan_swap');
    expect(Number(preview.proration_amount)).toBeGreaterThan(0);
  });

  it('preview when trial_ends_at expired falls back to regular kind (not trial_plan_swap)', async () => {
    const trialEndsAt = new Date(Date.now() - 86400000); // -1d (already ended)
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ state: 'trial', trial_ends_at: trialEndsAt }),
    );
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'free',
      name: 'Free',
      base_price: new Prisma.Decimal(0),
      is_free: true, // even with is_free=true, expired trial → not trial_plan_swap
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // ADR-3: one computePricing call.
    billingMock.computePricing.mockReturnValueOnce({
      base_price: new Prisma.Decimal(0),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(0),
      partner_org_id: null,
    });

    const preview = await service.preview(1, 6);
    expect(preview.kind).not.toBe('trial_plan_swap');
  });

  it('apply on trial_plan_swap activates free plan with a fresh cycle and skips invoice', async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 86400000);
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(
      subFixture({ state: 'trial', trial_ends_at: trialEndsAt }),
    );
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'free',
      name: 'Free',
      base_price: new Prisma.Decimal(0),
      is_free: true,
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });
    // Free plan → effective_price=0, margin_amount=0 → targetIsFree=true → trial_plan_swap path.
    billingMock.computePricing.mockReturnValue({
      base_price: new Prisma.Decimal(0),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(0),
      partner_org_id: null,
    });
    prismaMock.store_subscriptions.update.mockResolvedValue({ id: 1 });

    await service.apply(1, 6);

    // Invoice MUST NOT be issued during trial swap.
    expect(billingMock.issueInvoice).not.toHaveBeenCalled();

    const updateArg = prismaMock.store_subscriptions.update.mock.calls[0][0];
    expect(updateArg.data.state).toBe('active');
    expect(updateArg.data.plan_id).toBe(6);
    expect(updateArg.data.paid_plan_id).toBe(6);
    expect(updateArg.data.trial_ends_at).toBeNull();
    expect(updateArg.data.current_period_start).toBeInstanceOf(Date);
    expect(updateArg.data.current_period_end).toBeInstanceOf(Date);
    expect(updateArg.data.current_period_end.getTime()).toBeGreaterThan(
      updateArg.data.current_period_start.getTime(),
    );

    const transitionArg = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(transitionArg.data.type).toBe('state_transition');
    expect(transitionArg.data.from_state).toBe('trial');
    expect(transitionArg.data.to_state).toBe('active');

    // The plan_changed event must carry mode=trial_plan_swap.
    const evtArg = prismaMock.subscription_events.create.mock.calls[1][0];
    expect(evtArg.data.type).toBe('plan_changed');
    expect(evtArg.data.payload.mode).toBe('trial_plan_swap');
    expect(evtArg.data.payload.proration_amount).toBe('0.00');
    expect(evtArg.data.payload.applies_immediately).toBe(true);

    // Bus event mirrors the kind.
    const [eventName, eventPayload] = eventEmitterMock.emit.mock.calls[0];
    expect(eventName).toBe('subscription.plan.changed');
    expect(eventPayload.kind).toBe('trial_plan_swap');
    expect(eventPayload.mode).toBe('trial_plan_swap');
    expect(eventPayload.appliesImmediately).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ADR-3: getPaidBaseline
  // ──────────────────────────────────────────────────────────────────────────

  describe('getPaidBaseline', () => {
    it('returns parsed effectivePrice/basePrice/marginAmount from last paid invoice', async () => {
      prismaMock.subscription_invoices = {
        findFirst: jest.fn().mockResolvedValue({
          id: 10,
          total: new Prisma.Decimal('120.00'),
          to_plan_id: 5,
          split_breakdown: {
            vendix_share: '100.00',
            partner_share: '20.00',
          },
          updated_at: new Date(),
        }),
      };

      const baseline = await service.getPaidBaseline(1, 5);

      expect(baseline).not.toBeNull();
      expect(baseline!.effectivePrice.toFixed(2)).toBe('120.00');
      expect(baseline!.basePrice.toFixed(2)).toBe('100.00');
      expect(baseline!.marginAmount.toFixed(2)).toBe('20.00');
      expect(baseline!.planId).toBe(5);
    });

    it('returns null when no paid invoice exists', async () => {
      prismaMock.subscription_invoices = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      const baseline = await service.getPaidBaseline(1, 5);

      expect(baseline).toBeNull();
    });

    it('uses total as basePrice when split_breakdown is missing', async () => {
      prismaMock.subscription_invoices = {
        findFirst: jest.fn().mockResolvedValue({
          id: 11,
          total: new Prisma.Decimal('80.00'),
          to_plan_id: null,
          split_breakdown: null,
          updated_at: new Date(),
        }),
      };

      const baseline = await service.getPaidBaseline(1, 5);

      expect(baseline!.basePrice.toFixed(2)).toBe('80.00');
      expect(baseline!.marginAmount.toFixed(2)).toBe('0.00');
    });
  });

  describe('preview uses paid baseline (ADR-3)', () => {
    it('upgrade proration uses last paid invoice total as baseline, not current computePricing', async () => {
      // Sub is currently on plan 5 (paid $100 per last invoice), upgrading to plan 6 ($200)
      prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        id: 6,
        code: 'business',
        base_price: new Prisma.Decimal(200),
        max_partner_margin_pct: null,
        billing_cycle: 'monthly',
      });
      prismaMock.subscription_invoices = {
        findFirst: jest.fn().mockResolvedValue({
          id: 20,
          total: new Prisma.Decimal('100.00'),
          to_plan_id: 5,
          split_breakdown: { vendix_share: '100.00', partner_share: '0.00' },
          updated_at: new Date(),
        }),
      };

      // computePricing only called once (for new plan, not current plan)
      billingMock.computePricing.mockReturnValueOnce({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });

      const preview = await service.preview(1, 6);

      expect(preview.kind).toBe('upgrade');
      // proration_amount must be > 0 (diff between $200 and $100 prorated)
      expect(Number(preview.proration_amount)).toBeGreaterThan(0);
      // old_effective_price comes from baseline, not computePricing
      expect(preview.old_effective_price).toBe('100.00');
    });

    it('preview with no paid invoice treats origin as free (proration_amount = full new price)', async () => {
      prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());
      prismaMock.subscription_plans.findUnique.mockResolvedValue({
        id: 6,
        code: 'business',
        base_price: new Prisma.Decimal(200),
        max_partner_margin_pct: null,
        billing_cycle: 'monthly',
      });
      prismaMock.subscription_invoices = {
        findFirst: jest.fn().mockResolvedValue(null),
      };

      billingMock.computePricing.mockReturnValueOnce({
        base_price: new Prisma.Decimal(200),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(200),
        partner_org_id: null,
      });

      const preview = await service.preview(1, 6);

      // No paid baseline → treated as free origin → full price is prorated
      expect(Number(preview.proration_amount)).toBeGreaterThan(0);
    });
  });

  it('apply emits subscription.plan.changed event', async () => {
    prismaMock.store_subscriptions.findUnique.mockResolvedValue(subFixture());
    prismaMock.subscription_plans.findUnique.mockResolvedValue({
      id: 6,
      code: 'business',
      base_price: new Prisma.Decimal(200),
      max_partner_margin_pct: null,
      billing_cycle: 'monthly',
    });

    billingMock.computePricing.mockReturnValue({
      base_price: new Prisma.Decimal(200),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(200),
      partner_org_id: null,
    });

    prismaMock.store_subscriptions.update.mockResolvedValue({ id: 1 });

    await service.apply(1, 6);

    expect(eventEmitterMock.emit).toHaveBeenCalled();
    const [eventName, eventPayload] = eventEmitterMock.emit.mock.calls[0];
    expect(eventName).toBe('subscription.plan.changed');
    expect(eventPayload.subscriptionId).toBe(1);
    expect(eventPayload.fromPlanId).toBe(5);
    expect(eventPayload.toPlanId).toBe(6);

    const evtArg = prismaMock.subscription_events.create.mock.calls[0][0];
    expect(evtArg.data.type).toBe('plan_changed');
  });
});
