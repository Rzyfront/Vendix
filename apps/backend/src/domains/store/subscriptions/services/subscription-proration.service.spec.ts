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

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_plans: {
        findUnique: jest.fn(),
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
      metadata: null,
      current_period_start: new Date(now.getTime() - 10 * 86400000), // 10d ago
      current_period_end: new Date(now.getTime() + 20 * 86400000), // 20d ahead
      plan: {
        id: 5,
        code: 'pro',
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

    billingMock.computePricing
      .mockReturnValueOnce({
        base_price: new Prisma.Decimal(100),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(100),
        partner_org_id: null,
      })
      .mockReturnValueOnce({
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

    billingMock.computePricing
      .mockReturnValueOnce({
        base_price: new Prisma.Decimal(100),
        margin_pct: new Prisma.Decimal(0),
        margin_amount: new Prisma.Decimal(0),
        fixed_surcharge: new Prisma.Decimal(0),
        effective_price: new Prisma.Decimal(100),
        partner_org_id: null,
      })
      .mockReturnValueOnce({
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
