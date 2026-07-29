import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { OrgSubscriptionsController } from './org-subscriptions.controller';

/**
 * checkoutCommit() — the ORG_ADMIN free-plan path reactivates through the
 * single seam (`SubscriptionStateService.ensureOperational`).
 *
 * This call-site was a clone of the store-side checkout commit: it hand-rolled
 * `transition(storeId, 'active', ...)` behind a list of four degraded states
 * AND a `!couponCode` guard. Two consequences, both of them "HTTP 200 on a
 * store that stayed degraded":
 *
 *   1. `cancelled` / `expired` never matched the list. Unlike the store
 *      controller, this org path has no Path D re-subscribe, so a terminal
 *      store committing a free plan was simply left terminal.
 *   2. With a coupon the promotion was skipped entirely and the unblock was
 *      delegated to `safeApplyCoupon()`, which swallows its own errors — a
 *      coupon that failed to apply left the store suspended.
 *
 * These tests pin the fixed contract: a successful free-plan commit ALWAYS
 * routes the store through the seam, unconditionally.
 */

const ORG_STORE_ID = 10;
const SUB_ID = 200;
const PLAN_ID = 7;

interface Harness {
  controller: OrgSubscriptionsController;
  ensureOperational: jest.Mock;
  transition: jest.Mock;
  apply: jest.Mock;
  applyCoupon: jest.Mock;
  validateCoupon: jest.Mock;
  invalidate: jest.Mock;
  subUpdate: jest.Mock;
}

function buildHarness(opts: {
  subState: string;
  trialEndsAt?: Date | null;
  couponValid?: boolean;
}): Harness {
  const sub = {
    id: SUB_ID,
    store_id: ORG_STORE_ID,
    state: opts.subState,
    plan_id: 3,
    paid_plan_id: 3,
    trial_ends_at: opts.trialEndsAt ?? null,
    metadata: null,
    partner_override_id: null,
  };

  const subUpdate = jest.fn().mockResolvedValue(sub);
  const prisma: any = {
    store_subscriptions: {
      findUnique: jest.fn().mockResolvedValue(sub),
      update: subUpdate,
    },
    subscription_plans: {
      findUnique: jest.fn().mockResolvedValue({
        id: PLAN_ID,
        base_price: new Prisma.Decimal(0),
        max_partner_margin_pct: null,
        is_free: true,
      }),
    },
    subscription_invoices: { findUnique: jest.fn(), update: jest.fn() },
    partner_plan_overrides: { findUnique: jest.fn() },
    users: { findUnique: jest.fn().mockResolvedValue({ email: 'x@y.z' }) },
  };

  const ensureOperational = jest
    .fn()
    .mockResolvedValue({ finalState: 'active', path: ['active'] });
  const transition = jest.fn().mockResolvedValue(sub);
  const apply = jest
    .fn()
    .mockResolvedValue({ id: SUB_ID, state: opts.subState });
  const applyCoupon = jest.fn().mockResolvedValue(undefined);
  const validateCoupon = jest
    .fn()
    .mockResolvedValue({ valid: opts.couponValid !== false, reason: 'expired' });
  const invalidate = jest.fn().mockResolvedValue(undefined);

  // The org service only pins the target store into the request context for
  // the duration of the call; the store resolution itself is not under test.
  const orgSubs: any = {
    runWithStoreContext: jest.fn(async (_storeId: number, cb: () => any) =>
      cb(),
    ),
  };
  const billing: any = {
    computePricing: jest.fn().mockReturnValue({
      base_price: new Prisma.Decimal(0),
      margin_pct: new Prisma.Decimal(0),
      margin_amount: new Prisma.Decimal(0),
      fixed_surcharge: new Prisma.Decimal(0),
      effective_price: new Prisma.Decimal(0),
      partner_org_id: null,
    }),
    issueInvoice: jest.fn(),
    previewNextInvoice: jest.fn(),
  };
  const payment: any = {
    prepareWidgetCharge: jest.fn().mockResolvedValue({ widget: {} }),
  };
  const proration: any = {
    apply,
    preview: jest.fn().mockResolvedValue({ kind: 'downgrade' }),
  };
  const promotional: any = { validateCoupon, applyCoupon };
  const platformGw: any = {
    getActiveCredentials: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const responseService: any = {
    success: (data: unknown, message: string) => ({ data, message }),
  };

  const controller = new OrgSubscriptionsController(
    orgSubs,
    { invalidate } as any,
    { transition, ensureOperational } as any,
    billing,
    payment,
    proration,
    {} as any,
    promotional,
    platformGw,
    prisma,
    responseService,
  );

  return {
    controller,
    ensureOperational,
    transition,
    apply,
    applyCoupon,
    validateCoupon,
    invalidate,
    subUpdate,
  };
}

function commitDto(overrides: Record<string, unknown> = {}) {
  return {
    storeId: ORG_STORE_ID,
    planId: PLAN_ID,
    ...overrides,
  } as any;
}

describe('OrgSubscriptionsController.checkoutCommit — reactivation seam', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 42 } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // The two states the deleted 4-state list never covered. This org path has
  // no Path D, so before the fix these commits returned 200 with the store
  // still terminal — its own comment documented the hole.
  // -------------------------------------------------------------------------
  it.each([['cancelled'], ['expired']])(
    'a free plan committed on a `%s` store is reactivated through the seam',
    async (state) => {
      const h = buildHarness({ subState: state });

      const res: any = await h.controller.checkoutCommit(commitDto());

      expect(h.apply).toHaveBeenCalledWith(SUB_ID, PLAN_ID);
      expect(h.ensureOperational).toHaveBeenCalledTimes(1);
      const [storeId, ctx] = h.ensureOperational.mock.calls[0];
      expect(storeId).toBe(ORG_STORE_ID);
      expect(ctx.reason).toBe('free_plan_reactivation');
      expect(ctx.triggeredByUserId).toBe(42);
      expect(ctx.planId).toBe(PLAN_ID);
      expect(ctx.payload.previous_state).toBe(state);
      expect(res.message).toBe('Checkout committed (free plan)');
      // The hand-rolled single hop is gone: the route is the seam's business.
      expect(h.transition).not.toHaveBeenCalled();
    },
  );

  it.each([['grace_soft'], ['grace_hard'], ['suspended'], ['blocked']])(
    'unblocks a `%s` store through the seam',
    async (state) => {
      const h = buildHarness({ subState: state });

      await h.controller.checkoutCommit(commitDto());

      expect(h.ensureOperational).toHaveBeenCalledTimes(1);
      expect(h.ensureOperational.mock.calls[0][1].payload.previous_state).toBe(
        state,
      );
      expect(h.transition).not.toHaveBeenCalled();
    },
  );

  // -------------------------------------------------------------------------
  // The `!couponCode` guard: the unblock used to be delegated to
  // safeApplyCoupon(), which logs and swallows. A failed coupon therefore
  // returned 200 on a suspended store.
  // -------------------------------------------------------------------------
  it('reactivates a suspended store even when the coupon application fails', async () => {
    const h = buildHarness({ subState: 'suspended' });
    h.applyCoupon.mockRejectedValueOnce(new Error('promo expired'));
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const res: any = await h.controller.checkoutCommit(
      commitDto({ coupon_code: 'PROMO10' }),
    );

    expect(h.applyCoupon).toHaveBeenCalledWith(ORG_STORE_ID, 'PROMO10', 42);
    expect(warnSpy).toHaveBeenCalled();
    // The store is operational despite the coupon failure.
    expect(h.ensureOperational).toHaveBeenCalledTimes(1);
    expect(h.ensureOperational.mock.calls[0][1].reason).toBe(
      'free_plan_reactivation',
    );
    expect(res.message).toBe('Checkout committed (free plan)');
  });

  it('reactivates a cancelled store with a coupon (both holes at once)', async () => {
    const h = buildHarness({ subState: 'cancelled' });

    await h.controller.checkoutCommit(commitDto({ coupon_code: 'PROMO10' }));

    expect(h.ensureOperational).toHaveBeenCalledTimes(1);
    expect(h.ensureOperational.mock.calls[0][1].payload.previous_state).toBe(
      'cancelled',
    );
  });

  it.each([['active'], ['trial']])(
    'already-operational `%s` store: still delegates, the seam decides it is a no-op',
    async (state) => {
      const h = buildHarness({ subState: state });

      await h.controller.checkoutCommit(commitDto());

      // No local state test remains; idempotency is the seam's contract
      // (verified in subscription-state.service.spec.ts).
      expect(h.ensureOperational).toHaveBeenCalledTimes(1);
    },
  );

  it('does NOT report success when the seam refuses to leave the store operational', async () => {
    const h = buildHarness({ subState: 'suspended' });
    h.ensureOperational.mockRejectedValueOnce(
      new Error(`Reactivation did not leave store ${ORG_STORE_ID} operational`),
    );

    await expect(h.controller.checkoutCommit(commitDto())).rejects.toThrow(
      /did not leave store 10 operational/,
    );
    // And the response was never built, so the cache invalidation that follows
    // the seam never ran either.
    expect(h.invalidate).not.toHaveBeenCalled();
  });

  it('rejects an invalid coupon before touching the plan or the seam', async () => {
    const h = buildHarness({ subState: 'suspended', couponValid: false });

    await expect(
      h.controller.checkoutCommit(commitDto({ coupon_code: 'NOPE' })),
    ).rejects.toThrow(/Cupón inválido/);

    expect(h.apply).not.toHaveBeenCalled();
    expect(h.ensureOperational).not.toHaveBeenCalled();
  });
});
