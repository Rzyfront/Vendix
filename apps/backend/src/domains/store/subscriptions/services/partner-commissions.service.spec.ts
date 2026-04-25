import { Prisma } from '@prisma/client';
import { PartnerCommissionsService } from './partner-commissions.service';

/**
 * Unit tests for PartnerCommissionsService.
 * Focus: accrueCommission (idempotency + partner_share guard),
 * getPartnerLedger filtering, getPartnerSummary aggregation by state.
 */
describe('PartnerCommissionsService', () => {
  let service: PartnerCommissionsService;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      subscription_invoices: { findUnique: jest.fn() },
      partner_commissions: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    service = new PartnerCommissionsService(prismaMock);
  });

  function invoiceFixture(overrides: any = {}) {
    return {
      id: 500,
      partner_organization_id: 42,
      currency: 'USD',
      split_breakdown: {
        vendix_share: '100.00',
        partner_share: '20.00',
        margin_pct_used: '20.00',
        partner_org_id: 42,
      },
      store_subscription: { id: 1 },
      ...overrides,
    };
  }

  it('accrueCommission creates row with state=accrued', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceFixture());
    prismaMock.partner_commissions.findUnique.mockResolvedValue(null);

    await service.accrueCommission(500);

    const arg = prismaMock.partner_commissions.create.mock.calls[0][0];
    expect(arg.data.partner_organization_id).toBe(42);
    expect(arg.data.invoice_id).toBe(500);
    expect(arg.data.state).toBe('accrued');
    expect(arg.data.currency).toBe('USD');
  });

  it('accrueCommission is idempotent (skips if existing)', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(invoiceFixture());
    prismaMock.partner_commissions.findUnique.mockResolvedValue({
      id: 999,
      state: 'accrued',
    });

    await service.accrueCommission(500);

    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
  });

  it('accrueCommission no-ops when invoice has no partner_organization_id', async () => {
    prismaMock.subscription_invoices.findUnique.mockResolvedValue(
      invoiceFixture({ partner_organization_id: null }),
    );

    await service.accrueCommission(500);

    expect(prismaMock.partner_commissions.create).not.toHaveBeenCalled();
  });

  it('getPartnerLedger filters by organization_id', async () => {
    prismaMock.partner_commissions.findMany.mockResolvedValue([
      { id: 1, amount: new Prisma.Decimal(20) },
    ]);
    prismaMock.partner_commissions.count.mockResolvedValue(1);

    const result = await service.getPartnerLedger(42, { page: 1, limit: 10 });

    const findArg = prismaMock.partner_commissions.findMany.mock.calls[0][0];
    expect(findArg.where.partner_organization_id).toBe(42);
    expect(findArg.skip).toBe(0);
    expect(findArg.take).toBe(10);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it('getPartnerLedger applies state + date filters', async () => {
    prismaMock.partner_commissions.findMany.mockResolvedValue([]);
    prismaMock.partner_commissions.count.mockResolvedValue(0);

    await service.getPartnerLedger(42, {
      state: 'paid',
      period_start: '2026-01-01',
      period_end: '2026-04-01',
    });

    const findArg = prismaMock.partner_commissions.findMany.mock.calls[0][0];
    expect(findArg.where.partner_organization_id).toBe(42);
    expect(findArg.where.state).toBe('paid');
    expect(findArg.where.accrued_at.gte).toEqual(new Date('2026-01-01'));
    expect(findArg.where.accrued_at.lte).toEqual(new Date('2026-04-01'));
  });

  it('getPartnerSummary aggregates by state (accrued, pending_payout, paid)', async () => {
    prismaMock.partner_commissions.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(100) }, _count: 5 })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(50) }, _count: 2 })
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal(200) }, _count: 8 });

    const summary = await service.getPartnerSummary(42);

    expect(summary.accrued).toEqual({ total: '100.00', count: 5 });
    expect(summary.pending_payout).toEqual({ total: '50.00', count: 2 });
    expect(summary.paid).toEqual({ total: '200.00', count: 8 });

    const firstCall = prismaMock.partner_commissions.aggregate.mock.calls[0][0];
    expect(firstCall.where).toEqual({
      partner_organization_id: 42,
      state: 'accrued',
    });
  });

  it('rejects invalid organizationId in getPartnerSummary', async () => {
    let threw = false;
    try {
      await service.getPartnerSummary(0);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
