import { BadRequestException } from '@nestjs/common';
import { Prisma, tax_declaration_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';
import { FiscalTaxCreditAvailabilityService } from './fiscal-tax-credit-availability.service';

describe('FiscalTaxCreditAvailabilityService', () => {
  const context = {
    organization_id: 1,
    accounting_entity_id: 10,
    store_id: null,
  } as FiscalOperationsContext;
  const asOf = new Date('2026-06-30T00:00:00.000Z');
  const matchingDeclaration = {
    accounting_entity_id: 10,
    declaration_type: tax_declaration_type_enum.vat,
    jurisdiction_key: 'CO-DIAN',
  };

  const credit = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    organization_id: 1,
    accounting_entity_id: 10,
    store_id: null,
    tax_type: tax_declaration_type_enum.vat,
    jurisdiction_key: 'CO-DIAN',
    source_kind: 'declaration',
    amount: new Prisma.Decimal('100.00'),
    effective_date: new Date('2026-01-01T00:00:00.000Z'),
    source_declaration_id: 7,
    evidence_id: null,
    status: 'approved',
    applications: [],
    ...overrides,
  });

  let findMany: jest.Mock;
  let service: FiscalTaxCreditAvailabilityService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      fiscal_tax_credits: { findMany },
    } as unknown as GlobalPrismaService;
    service = new FiscalTaxCreditAvailabilityService(prisma);
  });

  const list = () =>
    service.list(context, tax_declaration_type_enum.vat, 'CO-DIAN', asOf);

  it('queries literal tenant scope and only approved credits effective by the requested date', async () => {
    findMany.mockResolvedValue([
      credit({
        applications: [
          { status: 'applied', amount: new Prisma.Decimal('10'), declaration: matchingDeclaration },
        ],
      }),
    ]);
    await list();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization_id: 1,
          accounting_entity_id: 10,
          store_id: null,
          tax_type: tax_declaration_type_enum.vat,
          jurisdiction_key: 'CO-DIAN',
          effective_date: { lte: asOf },
          status: 'approved',
        },
      }),
    );
  });

  it.each([
    ['cross-entity', { ...matchingDeclaration, accounting_entity_id: 11 }],
    ['cross-family', { ...matchingDeclaration, declaration_type: tax_declaration_type_enum.inc }],
    ['cross-jurisdiction', { ...matchingDeclaration, jurisdiction_key: 'CO-BOGOTA' }],
  ])('blocks an applied %s declaration', async (_name, declaration) => {
    findMany.mockResolvedValue([
      credit({
        applications: [
          { status: 'applied', amount: new Prisma.Decimal('10'), declaration },
        ],
      }),
    ]);
    const result = await list();
    expect(result.credits[0].available).toBeNull();
    expect(result.credits[0].blockers).toContain('application_declaration_mismatch');
    expect(result.available_total).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('does not report future or draft credits because the query excludes them', async () => {
    await list();
    const query = findMany.mock.calls[0][0];
    expect(query.where.effective_date.lte).toEqual(asOf);
    expect(query.where.status).toBe('approved');
    expect(query.where.status).not.toBe('draft');
  });

  it('blocks credits with no source declaration and no evidence', async () => {
    findMany.mockResolvedValue([credit({ source_declaration_id: null })]);
    const result = await list();
    expect(result.credits[0]).toMatchObject({ available: null, blockers: ['missing_source_or_evidence'] });
    expect(result.available_total).toBeNull();
  });

  it('blocks overapplication rather than reporting a usable balance', async () => {
    findMany.mockResolvedValue([
      credit({
        applications: [
          { status: 'applied', amount: new Prisma.Decimal('100.01'), declaration: matchingDeclaration },
        ],
      }),
    ]);
    const result = await list();
    expect(result.credits[0]).toMatchObject({ applied: '100.01', available: null });
    expect(result.credits[0].blockers).toContain('overapplied');
  });

  it('sums Decimal values without floating point loss and ignores non-applied applications', async () => {
    findMany.mockResolvedValue([
      credit({
        amount: new Prisma.Decimal('0.30'),
        applications: [
          { status: 'applied', amount: new Prisma.Decimal('0.10'), declaration: matchingDeclaration },
          { status: 'reversed', amount: new Prisma.Decimal('0.20'), declaration: matchingDeclaration },
        ],
      }),
      credit({
        id: 2,
        amount: new Prisma.Decimal('0.20'),
        applications: [
          { status: 'applied', amount: new Prisma.Decimal('0.10'), declaration: matchingDeclaration },
        ],
      }),
    ]);
    const result = await list();
    expect(result.credits.map(({ applied, available }) => [applied, available])).toEqual([
      ['0.10', '0.20'],
      ['0.10', '0.10'],
    ]);
    expect(result.available_total).toBe('0.30');
    expect(result.complete).toBe(true);
  });

  it('rejects blank jurisdiction and invalid dates', async () => {
    await expect(
      service.list(context, tax_declaration_type_enum.vat, '  ', asOf),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.list(context, tax_declaration_type_enum.vat, 'CO-DIAN', new Date('invalid')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
