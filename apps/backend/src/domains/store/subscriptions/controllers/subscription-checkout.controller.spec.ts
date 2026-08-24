import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { SubscriptionCheckoutController } from './subscription-checkout.controller';

describe('SubscriptionCheckoutController', () => {
  let controller: SubscriptionCheckoutController;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_plans: {
        findUnique: jest.fn(),
      },
    };

    controller = new SubscriptionCheckoutController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any, // billingProfile
      {} as any,
      prismaMock,
      {} as any,
    );
  });

  async function deriveChangeKind(
    currentCycle: string,
    currentPrice: string,
    targetCycle: string,
    targetPrice: string,
  ): Promise<string> {
    prismaMock.subscription_plans.findUnique.mockImplementation(
      async ({ where }: any) => {
        if (where.id === 1) {
          return {
            base_price: new Prisma.Decimal(currentPrice),
            billing_cycle: currentCycle,
          };
        }
        return {
          base_price: new Prisma.Decimal(targetPrice),
          billing_cycle: targetCycle,
        };
      },
    );

    return (controller as any).deriveChangeKind(
      {
        state: 'active',
        plan_id: 1,
        paid_plan_id: 1,
      },
      2,
    );
  }

  it.each<[string, string]>([
    ['monthly', '200000'],
    ['quarterly', '600000'],
    ['semiannual', '1200000'],
    ['annual', '2400000'],
    ['yearly', '2400000'],
    ['lifetime', '240000000'],
  ])(
    'classifies %s to a lower monthly-equivalent target as downgrade',
    async (sourceCycle, sourcePrice) => {
      await expect(
        deriveChangeKind(sourceCycle, sourcePrice, 'monthly', '119000'),
      ).resolves.toBe('downgrade');
    },
  );

  it('classifies raw-more-expensive quarterly target by monthly equivalent', async () => {
    await expect(
      deriveChangeKind('monthly', '150000', 'quarterly', '300000'),
    ).resolves.toBe('downgrade');
  });

  it('classifies cross-cycle target with higher monthly equivalent as upgrade', async () => {
    await expect(
      deriveChangeKind('monthly', '100000', 'semiannual', '900000'),
    ).resolves.toBe('upgrade');
  });
});

// ---------------------------------------------------------------------------
// commit() — reactivation goes through the single seam
// (`SubscriptionStateService.ensureOperational`).
//
// Both free-plan activation paths used to hand-roll
// `transition(storeId, 'active', ...)`, each with its own idea of which source
// states deserved a promotion. That is what produced HTTP 200 responses on
// stores that stayed degraded. These tests pin the contract: a successful
// commit ALWAYS routes the store through the seam.
// ---------------------------------------------------------------------------

const STORE_ID = 1;
const SUB_ID = 7;
const PLAN_ID = 2;

interface Harness {
  controller: SubscriptionCheckoutController;
  ensureOperational: jest.Mock;
  transition: jest.Mock;
  applyResubscribe: jest.Mock;
  apply: jest.Mock;
  issueInvoice: jest.Mock;
  applyCoupon: jest.Mock;
  subUpdate: jest.Mock;
}

function buildHarness(opts: {
  subState: string;
  /** `null` = free plan re-subscribe (no charge to wait for). */
  invoice?: { id: number } | null;
  previewKind?: string;
  couponValid?: boolean;
}): Harness {
  const sub = {
    id: SUB_ID,
    store_id: STORE_ID,
    state: opts.subState,
    plan_id: 3,
    paid_plan_id: 3,
    trial_ends_at: null,
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
    subscription_invoices: { findUnique: jest.fn() },
    users: {
      findUnique: jest.fn().mockResolvedValue({ email: 'owner@store.com' }),
    },
  };

  const ensureOperational = jest
    .fn()
    .mockResolvedValue({ finalState: 'active', path: ['active'] });
  const transition = jest.fn().mockResolvedValue(sub);
  const applyResubscribe = jest
    .fn()
    .mockResolvedValue({ id: SUB_ID, metadata: null });
  const apply = jest.fn().mockResolvedValue({ id: SUB_ID, state: 'active' });
  const issueInvoice = jest.fn().mockResolvedValue(opts.invoice ?? null);
  const applyCoupon = jest.fn().mockResolvedValue(undefined);

  const proration: any = {
    applyResubscribe,
    apply,
    preview: jest
      .fn()
      .mockResolvedValue({ kind: opts.previewKind ?? 'downgrade' }),
  };
  const billing: any = {
    issueInvoice,
    computePricing: jest
      .fn()
      .mockReturnValue({ effective_price: new Prisma.Decimal(0) }),
  };
  const payment: any = {
    prepareWidgetCharge: jest.fn().mockResolvedValue({ widget: {} }),
  };
  const resolver: any = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const promotional: any = {
    validateCoupon: jest
      .fn()
      .mockResolvedValue({ valid: opts.couponValid !== false }),
    applyCoupon,
  };
  const platformGw: any = {
    getActiveCredentials: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const responseService: any = {
    success: (data: unknown, message: string) => ({ data, message }),
  };

  // These cases exercise the reactivation seam, not fiscal capture. A stub that
  // captures nothing keeps `commit` on its business path; the guard itself is
  // covered in subscription-billing-profile.service.spec.ts.
  const billingProfile: any = {
    ensureCaptured: jest.fn().mockResolvedValue(undefined),
  };

  const controller = new SubscriptionCheckoutController(
    proration,
    billing,
    payment,
    resolver,
    { transition, ensureOperational } as any,
    promotional,
    billingProfile,
    platformGw,
    prisma,
    responseService,
  );

  return {
    controller,
    ensureOperational,
    transition,
    applyResubscribe,
    apply,
    issueInvoice,
    applyCoupon,
    subUpdate,
  };
}

describe('SubscriptionCheckoutController.commit — reactivation seam', () => {
  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ user_id: 9 } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Call-site 1 — Path D, free-plan re-subscribe from a terminal state.
  // -------------------------------------------------------------------------
  describe('Path D — re-subscribe from a terminal state (free plan)', () => {
    it.each([['cancelled'], ['expired'], ['no_plan']])(
      'a successful %s re-subscribe ends operational via the seam',
      async (state) => {
        const h = buildHarness({ subState: state, invoice: null });

        const res: any = await h.controller.commit({
          planId: PLAN_ID,
        } as any);

        expect(h.ensureOperational).toHaveBeenCalledTimes(1);
        const [storeId, ctx] = h.ensureOperational.mock.calls[0];
        expect(storeId).toBe(STORE_ID);
        expect(ctx.reason).toBe('re_subscribe_free_plan');
        expect(ctx.triggeredByUserId).toBe(9);
        expect(ctx.planId).toBe(PLAN_ID);
        expect(ctx.payload.previous_state).toBe(state);
        expect(res.message).toBe('Re-subscription activated (free plan)');
      },
    );

    it('leaves the pending_payment parking hop to transition() (not the seam)', async () => {
      const h = buildHarness({ subState: 'cancelled', invoice: null });

      await h.controller.commit({ planId: PLAN_ID } as any);

      // The seam owns reactivation only. Parking a re-subscribe in
      // pending_payment while the widget is open is a different transition and
      // still belongs to transition().
      expect(h.transition).toHaveBeenCalledTimes(1);
      expect(h.transition.mock.calls[0][1]).toBe('pending_payment');
    });

    it('does NOT report success when the seam refuses to leave it operational', async () => {
      const h = buildHarness({ subState: 'cancelled', invoice: null });
      h.ensureOperational.mockRejectedValueOnce(
        new Error('Reactivation did not leave store 1 operational'),
      );

      await expect(
        h.controller.commit({ planId: PLAN_ID } as any),
      ).rejects.toThrow(/did not leave store 1 operational/);
    });
  });

  // -------------------------------------------------------------------------
  // Call-site 2 — free-plan commit on a degraded store (S3.6).
  // -------------------------------------------------------------------------
  describe('S3.6 — free-plan commit on a degraded store', () => {
    it.each([['grace_soft'], ['grace_hard'], ['suspended'], ['blocked']])(
      'unblocks a %s store through the seam',
      async (state) => {
        const h = buildHarness({ subState: state });

        const res: any = await h.controller.commit({
          planId: PLAN_ID,
        } as any);

        expect(h.apply).toHaveBeenCalledWith(SUB_ID, PLAN_ID);
        expect(h.ensureOperational).toHaveBeenCalledTimes(1);
        const [storeId, ctx] = h.ensureOperational.mock.calls[0];
        expect(storeId).toBe(STORE_ID);
        expect(ctx.reason).toBe('free_plan_reactivation');
        expect(ctx.planId).toBe(PLAN_ID);
        expect(ctx.payload.previous_state).toBe(state);
        expect(res.message).toBe('Checkout committed (free plan)');
      },
    );

    it('still reaches the seam when a coupon is present', async () => {
      // Regression: the old guard skipped the promotion whenever a coupon was
      // supplied and delegated the unblock to safeApplyCoupon(), which
      // swallows its own errors — so a failed coupon returned 200 on a store
      // that was still suspended.
      const h = buildHarness({ subState: 'suspended' });
      h.applyCoupon.mockRejectedValueOnce(new Error('promo expired'));
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await h.controller.commit({
        planId: PLAN_ID,
        coupon_code: 'PROMO10',
      } as any);

      expect(h.ensureOperational).toHaveBeenCalledTimes(1);
      expect(h.applyCoupon).toHaveBeenCalled();
    });

    it.each([['active'], ['trial']])(
      'already-operational %s store: still delegates, seam decides it is a no-op',
      async (state) => {
        // trial rows only reach this branch once the trial window has lapsed
        // (an in-window trial takes the trial_plan_swap path instead).
        const h = buildHarness({ subState: state });

        await h.controller.commit({ planId: PLAN_ID } as any);

        // No local state test remains, so the call is made; idempotency is the
        // seam's contract (verified in subscription-state.service.spec.ts).
        expect(h.ensureOperational).toHaveBeenCalledTimes(1);
      },
    );
  });

  // -------------------------------------------------------------------------
  // payDue() — direct payment for unpaid issued/overdue invoices.
  // -------------------------------------------------------------------------
  describe('payDue()', () => {
    beforeEach(() => {
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        store_id: STORE_ID,
        user_id: 9,
      } as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('prepares payment widget for active subscription with due invoice and leaves state unchanged', async () => {
      const h = buildHarness({ subState: 'active' });
      const invoice = {
        id: 19,
        store_subscription_id: SUB_ID,
        state: 'issued',
        total: new Prisma.Decimal(69900),
        currency: 'COP',
        due_at: new Date('2026-08-27'),
        period_start: new Date('2026-08-20'),
        period_end: new Date('2026-09-19'),
      };

      (h.controller as any).prisma.subscription_invoices.findFirst = jest
        .fn()
        .mockResolvedValue(invoice);
      (h.controller as any).payment.prepareWidgetCharge = jest.fn().mockResolvedValue({
        widget: {
          public_key: 'pub_test',
          currency: 'COP',
          amount_in_cents: 6990000,
          reference: 'ref_123',
        },
      });

      const res: any = await h.controller.payDue({});

      expect(res.data.invoice.id).toBe(19);
      expect(res.data.invoice.total).toBe('69900');
      expect(res.data.widget.reference).toBe('ref_123');
      expect(h.transition).not.toHaveBeenCalled();
      expect(h.subUpdate).not.toHaveBeenCalled();
    });

    it('resolves explicit invoiceId and verifies subscription ownership', async () => {
      const h = buildHarness({ subState: 'active' });
      const invoice = {
        id: 25,
        store_subscription_id: SUB_ID,
        state: 'issued',
        total: new Prisma.Decimal(120000),
        currency: 'COP',
        due_at: new Date('2026-08-30'),
        period_start: null,
        period_end: null,
      };

      const findFirstMock = jest.fn().mockResolvedValue(invoice);
      (h.controller as any).prisma.subscription_invoices.findFirst = findFirstMock;
      (h.controller as any).payment.prepareWidgetCharge = jest.fn().mockResolvedValue({
        widget: { public_key: 'pub_test' },
      });

      const res: any = await h.controller.payDue({ invoiceId: 25 });

      expect(findFirstMock).toHaveBeenCalledWith({
        where: { id: 25, store_subscription_id: SUB_ID },
      });
      expect(res.data.invoice.id).toBe(25);
    });

    it('throws SUBSCRIPTION_001 if invoice does not belong to subscription', async () => {
      const h = buildHarness({ subState: 'active' });
      (h.controller as any).prisma.subscription_invoices.findFirst = jest
        .fn()
        .mockResolvedValue(null);

      await expect(h.controller.payDue({ invoiceId: 999 })).rejects.toThrow();
    });

    it('throws DUNNING_001 if no payable invoice exists', async () => {
      const h = buildHarness({ subState: 'active' });
      (h.controller as any).prisma.subscription_invoices.findFirst = jest
        .fn()
        .mockResolvedValue(null);

      await expect(h.controller.payDue({})).rejects.toThrow();
    });

    it('throws SUBSCRIPTION_010 if invoice is already paid', async () => {
      const h = buildHarness({ subState: 'active' });
      (h.controller as any).prisma.subscription_invoices.findFirst = jest
        .fn()
        .mockResolvedValue({
          id: 19,
          store_subscription_id: SUB_ID,
          state: 'paid',
          total: new Prisma.Decimal(69900),
        });

      await expect(h.controller.payDue({ invoiceId: 19 })).rejects.toThrow();
    });
  });
});
