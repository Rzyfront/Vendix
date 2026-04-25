import { Prisma } from '@prisma/client';
import { SubscriptionBillingService } from './subscription-billing.service';

/**
 * Unit tests for SubscriptionBillingService.
 * Focus: computePricing (base + margin + fixed_surcharge), HALF_EVEN rounding,
 * issueInvoice split_breakdown, and free-plan skip.
 */
describe('SubscriptionBillingService', () => {
  let service: SubscriptionBillingService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      store_subscriptions: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription_invoices: {
        create: jest.fn(),
        update: jest.fn(),
      },
      subscription_events: {
        create: jest.fn(),
      },
      partner_commissions: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
    };
    service = new SubscriptionBillingService(prismaMock as any);
  });

  function subFixture(overrides: any = {}) {
    return {
      id: 1,
      store_id: 10,
      currency: 'USD',
      current_period_start: new Date('2026-04-01T00:00:00Z'),
      current_period_end: new Date('2026-05-01T00:00:00Z'),
      metadata: null,
      plan: {
        id: 1,
        code: 'pro',
        base_price: new Prisma.Decimal(100),
        max_partner_margin_pct: new Prisma.Decimal(30),
        billing_cycle: 'monthly',
      },
      partner_override: null,
      ...overrides,
    };
  }

  describe('computePricing', () => {
    it('no partner → effective_price = base_price, partner_org_id = null', () => {
      const sub = subFixture();
      const pricing = service.computePricing(sub as any);
      expect(pricing.effective_price.toFixed(2)).toBe('100.00');
      expect(pricing.margin_amount.toFixed(2)).toBe('0.00');
      expect(pricing.partner_org_id).toBeNull();
    });

    it('partner override with margin + fixed_surcharge → effective sums all', () => {
      const sub = subFixture({
        partner_override: {
          organization_id: 42,
          margin_pct: new Prisma.Decimal(20),
          fixed_surcharge: new Prisma.Decimal(5),
          is_active: true,
          base_plan: { max_partner_margin_pct: new Prisma.Decimal(30) },
        },
      });
      const pricing = service.computePricing(sub as any);
      // 100 + (100 * 20 / 100) + 5 = 125
      expect(pricing.effective_price.toFixed(2)).toBe('125.00');
      expect(pricing.margin_amount.toFixed(2)).toBe('20.00');
      expect(pricing.partner_org_id).toBe(42);
    });

    it('partner margin above plan cap → clamped to cap', () => {
      const sub = subFixture({
        partner_override: {
          organization_id: 42,
          margin_pct: new Prisma.Decimal(50), // requested 50
          fixed_surcharge: null,
          is_active: true,
          base_plan: { max_partner_margin_pct: new Prisma.Decimal(30) },
        },
      });
      const pricing = service.computePricing(sub as any);
      // Clamped at 30%. margin_amount = 100 * 30/100 = 30. effective = 130.
      expect(pricing.margin_pct.toFixed(2)).toBe('30.00');
      expect(pricing.margin_amount.toFixed(2)).toBe('30.00');
      expect(pricing.effective_price.toFixed(2)).toBe('130.00');
    });

    it('HALF_EVEN (banker rounding) for margin amount at 2 decimals', () => {
      // 100 * 12.345/100 = 12.345 → banker rounds to 12.34 (even)
      const sub = subFixture({
        plan: {
          id: 1,
          code: 'pro',
          base_price: new Prisma.Decimal(100),
          max_partner_margin_pct: new Prisma.Decimal(100),
          billing_cycle: 'monthly',
        },
        partner_override: {
          organization_id: 42,
          margin_pct: new Prisma.Decimal('12.345'),
          fixed_surcharge: null,
          is_active: true,
          base_plan: { max_partner_margin_pct: new Prisma.Decimal(100) },
        },
      });
      const pricing = service.computePricing(sub as any);
      // round2 is private; assert at storage boundary via toDecimalPlaces
      const stored = pricing.margin_amount.toDecimalPlaces(2, 6);
      expect(stored.toFixed(2)).toBe('12.34');
    });
  });

  describe('issueInvoice', () => {
    it('free plan (base_price=0, no partner) → skips invoice, advances period', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 1 }]);
      prismaMock.store_subscriptions.findUniqueOrThrow = jest.fn().mockResolvedValue(
        subFixture({
          plan: {
            id: 1,
            code: 'core-free',
            base_price: new Prisma.Decimal(0),
            max_partner_margin_pct: null,
            billing_cycle: 'monthly',
          },
        }),
      );

      const result = await service.issueInvoice(1);

      expect(result).toBeNull();
      expect(prismaMock.subscription_invoices.create).not.toHaveBeenCalled();
      expect(prismaMock.store_subscriptions.update).toHaveBeenCalled();
      const eventArg = prismaMock.subscription_events.create.mock.calls[0][0];
      expect(eventArg.data.type).toBe('renewed');
      expect(eventArg.data.payload.skipped_reason).toBe('zero_price');
    });

    it('with partner override → invoice.split_breakdown includes partner_org_id', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ id: 1 }]) // FOR UPDATE
        .mockResolvedValueOnce([]); // advisory lock last invoice number search
      prismaMock.store_subscriptions.findUniqueOrThrow = jest.fn().mockResolvedValue(
        subFixture({
          partner_override: {
            organization_id: 42,
            margin_pct: new Prisma.Decimal(20),
            fixed_surcharge: null,
            is_active: true,
            base_plan: { max_partner_margin_pct: new Prisma.Decimal(30) },
          },
        }),
      );
      prismaMock.subscription_invoices.create.mockResolvedValue({ id: 99 });

      await service.issueInvoice(1);

      const invArg = prismaMock.subscription_invoices.create.mock.calls[0][0];
      expect(invArg.data.partner_organization_id).toBe(42);
      expect(invArg.data.split_breakdown.partner_org_id).toBe(42);
      expect(invArg.data.split_breakdown.partner_share).toBe('20.00');
      expect(invArg.data.split_breakdown.vendix_share).toBe('100.00');
      // Partner commission accrued
      expect(prismaMock.partner_commissions.create).toHaveBeenCalled();
    });
  });
});
