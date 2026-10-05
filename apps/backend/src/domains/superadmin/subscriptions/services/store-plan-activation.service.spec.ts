import { Prisma } from '@prisma/client';
import { StorePlanActivationService } from './store-plan-activation.service';
import { VendixHttpException } from '../../../../common/errors';

const D = (v: string | number) => new Prisma.Decimal(v);

function makePlan(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    name: 'Pro',
    state: 'active',
    billing_cycle: 'monthly',
    currency: 'COP',
    base_price: D(100000),
    max_partner_margin_pct: null,
    ai_feature_flags: { a: true },
    ...over,
  };
}

function build(opts: {
  plan?: any;
  existingSub?: any;
  invoice?: any | null;
  openInvoices?: any[];
}) {
  const tx: any = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue(opts.existingSub ? [{ id: opts.existingSub.id }] : []),
    store_subscriptions: {
      create: jest.fn().mockResolvedValue({ id: 55 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(opts.existingSub),
      update: jest.fn().mockResolvedValue({}),
    },
    subscription_invoices: {
      findMany: jest.fn().mockResolvedValue(opts.openInvoices ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    subscription_payments: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    partner_commissions: { updateMany: jest.fn().mockResolvedValue({}) },
    subscription_events: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    stores: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
    subscription_plans: {
      findUnique: jest.fn().mockResolvedValue(opts.plan ?? makePlan()),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    store_subscriptions: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: opts.existingSub?.id ?? 55, state: 'active' }),
    },
    subscription_invoices: {
      findUnique: jest.fn().mockResolvedValue({
        id: 900,
        invoice_number: 'SAAS-1',
        amount_paid: D(100000),
      }),
    },
    subscription_payments: {
      findFirst: jest.fn().mockResolvedValue({ id: 33, amount: D(100000) }),
    },
  };
  const billing: any = {
    computePricing: jest.fn().mockReturnValue({
      base_price: D(100000),
      margin_amount: D(0),
      effective_price: D(100000),
    }),
    issueInvoice: jest.fn().mockResolvedValue(
      opts.invoice === undefined
        ? {
            id: 900,
            invoice_number: 'SAAS-1',
            total: D(100000),
            period_end: new Date('2026-12-01'),
          }
        : opts.invoice,
    ),
  };
  const manual: any = {
    recordManualPayment: jest.fn().mockResolvedValue(undefined),
  };
  const state: any = { ensureOperational: jest.fn().mockResolvedValue({}) };
  const resolver: any = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const events: any = { emit: jest.fn() };
  const svc = new StorePlanActivationService(
    prisma,
    billing,
    manual,
    state,
    resolver,
    events,
  );
  return { svc, tx, prisma, billing, manual, state, resolver, events };
}

describe('StorePlanActivationService', () => {
  it('creates pending_payment row for a store without subscription and records payment for the invoice total', async () => {
    const h = build({});
    const res = await h.svc.activatePlan(1, { plan_id: 7 }, 99);

    expect(h.tx.store_subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: 1,
          plan_id: 7,
          paid_plan_id: 7,
          state: 'pending_payment',
        }),
      }),
    );
    expect(h.billing.issueInvoice).toHaveBeenCalledWith(55, {
      fromPlanId: null,
      toPlanId: 7,
      changeKind: 'initial',
    });
    const [invoiceId, arg] = h.manual.recordManualPayment.mock.calls[0];
    expect(invoiceId).toBe(900);
    expect(arg.amount.toFixed(2)).toBe('100000.00');
    expect(arg.recordedByUserId).toBe(99);
    expect(arg.planId).toBe(7);
    expect(arg.extraMetadata.source).toBe('superadmin_activation');
    expect(h.state.ensureOperational).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      store_id: 1,
      subscription_id: 55,
      invoice_id: 900,
      payment_id: 33,
      amount_paid: '100000.00',
      state: 'active',
    });
  });

  it('cancelled subscription with a different plan: updates plan, voids issued invoices, uses explicit amount', async () => {
    const h = build({
      existingSub: {
        id: 12,
        plan_id: 3,
        state: 'cancelled',
        partner_override: null,
      },
      openInvoices: [{ id: 801, metadata: null }],
    });
    await h.svc.activatePlan(
      1,
      { plan_id: 7, amount: '50000', payment_method: 'consignacion' },
      99,
    );

    expect(h.tx.store_subscriptions.create).not.toHaveBeenCalled();
    expect(h.tx.subscription_invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 801 },
        data: expect.objectContaining({
          state: 'void',
          metadata: expect.objectContaining({
            void_reason: 'superadmin_plan_activation',
          }),
        }),
      }),
    );
    const upd = h.tx.store_subscriptions.update.mock.calls[0][0];
    expect(upd.data).toMatchObject({
      plan_id: 7,
      paid_plan_id: 7,
      pending_plan_id: null,
      scheduled_plan_id: null,
    });
    expect(upd.data.state).toBeUndefined();
    expect(h.billing.issueInvoice).toHaveBeenCalledWith(12, {
      fromPlanId: 3,
      toPlanId: 7,
      changeKind: 'resubscribe',
    });
    const arg = h.manual.recordManualPayment.mock.calls[0][1];
    expect(arg.amount.toFixed(2)).toBe('50000.00');
    expect(arg.extraMetadata.payment_method).toBe('consignacion');
  });

  it('free plan: no invoice -> ensureOperational, no manual payment', async () => {
    const h = build({ invoice: null, plan: makePlan({ base_price: D(0) }) });
    const res = await h.svc.activatePlan(1, { plan_id: 7 }, 99);

    expect(h.manual.recordManualPayment).not.toHaveBeenCalled();
    expect(h.state.ensureOperational).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        reason: 'superadmin_plan_activation',
        triggeredByUserId: 99,
        planId: 7,
      }),
    );
    expect(res.invoice_id).toBeNull();
    expect(res.payment_id).toBeNull();
    expect(res.amount_paid).toBeNull();
  });

  it('rejects an inactive plan with PLAN_001', async () => {
    const h = build({ plan: makePlan({ state: 'inactive' }) });
    let err: any;
    try {
      await h.svc.activatePlan(1, { plan_id: 7 }, 99);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.getResponse()).toMatchObject({ error_code: 'PLAN_001' });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
