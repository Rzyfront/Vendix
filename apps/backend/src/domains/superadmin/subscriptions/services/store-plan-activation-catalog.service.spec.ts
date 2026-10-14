import { Prisma } from '@prisma/client';
import { StorePlanActivationCatalogService } from './store-plan-activation-catalog.service';
import { VendixHttpException } from '../../../../common/errors';

const D = (v: string | number) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

function plan(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: 'pro-monthly',
    name: 'Pro',
    description: 'desc',
    plan_type: 'base',
    state: 'active',
    billing_cycle: 'monthly',
    base_price: D(100000),
    currency: 'COP',
    max_partner_margin_pct: null,
    is_free: false,
    is_popular: false,
    sort_order: 1,
    plan_group_code: 'pro',
    feature_matrix: {},
    ai_feature_flags: {},
    grace_period_soft_days: 5,
    grace_period_hard_days: 10,
    ...over,
  };
}

// Same math as SubscriptionBillingService.computePricing (inactive/absent override => base).
function computePricing(sub: any) {
  const base = D(sub.plan.base_price);
  const o = sub.partner_override;
  if (!o || !o.is_active) {
    return {
      base_price: base,
      margin_pct: D(0),
      margin_amount: D(0),
      fixed_surcharge: D(0),
      effective_price: base,
    };
  }
  const margin = base.times(D(o.margin_pct)).dividedBy(100);
  const fixed = D(o.fixed_surcharge ?? 0);
  return {
    base_price: base,
    margin_pct: D(o.margin_pct),
    margin_amount: margin,
    fixed_surcharge: fixed,
    effective_price: base.plus(margin).plus(fixed),
  };
}

function build(opts: {
  plans?: any[];
  planById?: any;
  sub?: any;
  invoices?: any[];
  store?: any;
}) {
  const prisma: any = {
    stores: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.store === undefined ? { id: 1, name: 'Tienda' } : opts.store,
        ),
    },
    subscription_plans: {
      findMany: jest.fn(async (args: any) =>
        (opts.plans ?? []).filter((p: any) =>
          args.where.state.in.includes(p.state),
        ),
      ),
      findUnique: jest.fn().mockResolvedValue(opts.planById ?? null),
    },
    store_subscriptions: {
      findUnique: jest.fn().mockResolvedValue(opts.sub ?? null),
    },
    subscription_invoices: {
      findMany: jest.fn().mockResolvedValue(opts.invoices ?? []),
    },
  };
  const billing: any = { computePricing: jest.fn(computePricing) };
  return { svc: new StorePlanActivationCatalogService(prisma, billing), prisma };
}

describe('StorePlanActivationCatalogService', () => {
  describe('getOptions', () => {
    it('throws STORE_FIND_001 for a missing store', async () => {
      const h = build({ store: null });
      await expect(h.svc.getOptions(1)).rejects.toBeInstanceOf(
        VendixHttpException,
      );
    });

    it('lists every cycle of a group (draft canonical monthly + active annual), excludes archived-only groups', async () => {
      const h = build({
        plans: [
          plan({ id: 2, code: 'pro-annual', billing_cycle: 'annual', base_price: D(1000000) }),
          plan({ id: 1, code: 'pro', state: 'draft' }),
          plan({ id: 9, code: 'solo-arch', state: 'archived', plan_group_code: 'solo-arch' }),
        ],
      });
      const res = await h.svc.getOptions(1);
      expect(h.prisma.subscription_plans.findMany).toHaveBeenCalledWith({
        where: { state: { in: ['active', 'draft'] } },
      });
      expect(res.current).toBeNull();
      expect(res.groups).toHaveLength(1);
      const g = res.groups[0];
      expect(g.group_code).toBe('pro');
      expect(g.cycles.map((c: any) => [c.plan_id, c.billing_cycle, c.state])).toEqual([
        [1, 'monthly', 'draft'],
        [2, 'annual', 'active'],
      ]);
      expect(g.cycles[1].effective_price).toBe('1000000.00');
    });

    it('applies partner override to effective_price and exposes current subscription data', async () => {
      const start = new Date('2026-10-01T00:00:00Z');
      const sub = {
        id: 5,
        state: 'active',
        plan_id: 1,
        plan: { name: 'Pro', billing_cycle: 'monthly' },
        current_period_start: start,
        current_period_end: new Date(start.getTime() + 30 * DAY),
        metadata: { pending_credit: '2500' },
        promotional_plan_id: 8,
        promotional_plan: { name: 'Promo' },
        partner_override: {
          organization_id: 3,
          margin_pct: D(10),
          fixed_surcharge: D(500),
          is_active: true,
        },
      };
      const h = build({
        plans: [plan({ id: 1 })],
        sub,
        invoices: [{ id: 70, invoice_number: 'SAAS-1', total: D(100000) }],
      });
      const res = await h.svc.getOptions(1);
      const c = res.groups[0].cycles[0];
      expect(c.effective_price).toBe('110500.00');
      expect(c.margin_amount).toBe('10000.00');
      expect(c.is_current).toBe(true);
      expect(res.current).toMatchObject({
        subscription_id: 5,
        pending_credit: '2500.00',
        open_invoices: [{ id: 70, invoice_number: 'SAAS-1', total: '100000.00' }],
        promotional_overlay: { plan_id: 8, plan_name: 'Promo' },
        partner_override: { organization_id: 3, fixed_surcharge: '500.00' },
      });
    });
  });

  describe('preview', () => {
    const now = new Date('2026-10-13T15:00:00Z');

    it('rejects a draft plan with PLAN_001', async () => {
      const h = build({ planById: plan({ state: 'draft' }) });
      await expect(h.svc.preview(1, { plan_id: 1 }, now)).rejects.toMatchObject({
        errorCode: 'PLAN_001',
      });
    });

    it('rejects starts_at out of range', async () => {
      const h = build({ planById: plan() });
      await expect(
        h.svc.preview(1, { plan_id: 1, starts_at: '2025-01-01' }, now),
      ).rejects.toMatchObject({ errorCode: 'SUBSCRIPTION_ACTIVATION_START_RANGE' });
    });

    it('pending credit above price gives invoice_total 0.00', async () => {
      const h = build({
        planById: plan({ base_price: D(50000) }),
        sub: {
          id: 5,
          state: 'expired',
          plan_id: 3,
          metadata: { pending_credit: '80000' },
          partner_override: null,
          promotional_plan_id: null,
          effective_price: D(0),
        },
      });
      const res = await h.svc.preview(1, { plan_id: 1 }, now);
      expect(res.pending_credit_applied).toBe('50000.00');
      expect(res.invoice_total).toBe('0.00');
      expect(res.change_kind).toBe('resubscribe');
    });

    it('emits void-invoices, unused-period and underpayment warnings', async () => {
      const h = build({
        planById: plan(),
        sub: {
          id: 5,
          state: 'active',
          plan_id: 3,
          effective_price: D(30000),
          current_period_start: new Date(now.getTime() - 15 * DAY),
          current_period_end: new Date(now.getTime() + 15 * DAY),
          metadata: null,
          partner_override: null,
          promotional_plan_id: 8,
          promotional_plan: { name: 'Promo' },
        },
        invoices: [
          { id: 70, invoice_number: 'SAAS-1', total: D(1000) },
          { id: 71, invoice_number: 'SAAS-2', total: D(2000) },
        ],
      });
      const res = await h.svc.preview(1, { plan_id: 1, amount: '40000' }, now);
      const byCode = Object.fromEntries(res.warnings.map((w) => [w.code, w]));
      expect(byCode.VOID_OPEN_INVOICES.data).toMatchObject({ count: 2, total: '3000.00' });
      expect(byCode.UNUSED_PERIOD_LOST.data).toEqual({
        days_remaining: 15,
        estimated_value: '15000.00',
      });
      expect(byCode.UNDERPAYMENT.data).toEqual({
        shortfall: '60000.00',
        invoice_total: '100000.00',
      });
      expect(byCode.PROMO_OVERLAY_KEPT).toBeDefined();
      expect(byCode.SAME_PLAN_RENEWAL).toBeUndefined();
      expect(res.change_kind).toBe('resubscribe');
    });

    it('no subscription => initial with no warnings', async () => {
      const h = build({ planById: plan() });
      const res = await h.svc.preview(1, { plan_id: 1 }, now);
      expect(res.change_kind).toBe('initial');
      expect(res.warnings).toEqual([]);
      expect(res.invoice_total).toBe('100000.00');
    });
  });
});
