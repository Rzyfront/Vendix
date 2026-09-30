import { RequestContextService } from '@common/context/request-context.service';
import { BadRequestException } from '@nestjs/common';
import { TaxDeclarationDraftService } from './tax-declaration-draft.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

describe('TaxDeclarationDraftService VAT calculation', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: 2,
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = () => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 10, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      invoices: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            invoice_type: 'sales_invoice',
            invoice_number: 'FV1',
            status: 'accepted',
            dian_status: 'accepted',
            supplier_id: null,
            customer_id: 10,
            customer_name: 'Cliente Uno',
            customer_tax_id: '900111222',
            subtotal_amount: 1000,
            issue_date: new Date('2026-03-10T10:00:00.000Z'),
            invoice_taxes: [{ id: 101, tax_type: 'iva', taxable_amount: 1000, tax_amount: 190 }],
            supplier: null,
          },
          {
            id: 2,
            invoice_type: 'sales_invoice',
            invoice_number: 'FV2',
            status: 'validated',
            dian_status: 'pending',
            supplier_id: null,
            customer_id: 11,
            customer_name: 'Cliente Dos',
            customer_tax_id: '900333444',
            subtotal_amount: 1000,
            issue_date: new Date('2026-03-11T10:00:00.000Z'),
            invoice_taxes: [{ id: 102, tax_type: 'iva', taxable_amount: 1000, tax_amount: 190 }],
            supplier: null,
          },
          {
            id: 3,
            invoice_type: 'support_document',
            invoice_number: 'DS1',
            status: 'accepted',
            dian_status: 'accepted',
            supplier_id: 50,
            customer_id: null,
            customer_name: null,
            customer_tax_id: null,
            subtotal_amount: 500,
            issue_date: new Date('2026-03-12T10:00:00.000Z'),
            invoice_taxes: [{ id: 103, tax_type: 'iva', taxable_amount: 500, tax_amount: 95 }],
            supplier: { name: 'Proveedor Uno', tax_id: '123456789' },
          },
        ]),
      },
      fiscal_rule_sets: { findFirst: jest.fn().mockResolvedValue(null) },
      fiscal_obligations: { findFirst: jest.fn().mockResolvedValue(null) },
      tax_declaration_drafts: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };
    const fiscalRules = {
      resolveEffectiveRules: jest.fn().mockResolvedValue({
        general_rate_percent: 35,
        source: 'vendix_default_fallback',
      }),
    };
    const exogenousGenerator = {
      // One entry per DIAN exogenous format the service dispatches. A missing
      // one does not fail loudly at wiring time — it explodes inside the
      // generator loop as "is not a function", so the list must stay complete.
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1006: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
      generateFormat1008: jest.fn().mockResolvedValue([]),
      generateFormat1009: jest.fn().mockResolvedValue([]),
      generateFormat2276: jest.fn().mockResolvedValue([]),
    };

    // The service emits domain events on draft transitions; positional
    // construction means the emitter must be passed even when unasserted.
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
        eventEmitter as any,
      ),
      prisma,
      tx,
      audit,
      eventEmitter,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  it('uses only DIAN-accepted fiscal documents and records skipped sources as warnings', async () => {
    const { service, getDraftData, getCreatedLines } = createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 3,
      }),
    );

    const draft = getDraftData();
    expect(draft.generated_tax_amount).toBe(190);
    expect(draft.deductible_tax_amount).toBe(95);
    expect(draft.balance_due).toBe(95);
    expect(draft.total_payable).toBe(95);
    expect(draft.status).toBe('ready');
    expect(draft.source_snapshot).toMatchObject({
      invoice_count: 3,
      counted_invoice_ids: [1, 3],
      skipped_invoice_ids: [2],
    });
    expect(draft.validation_summary).toMatchObject({
      warnings: [
        expect.objectContaining({
          code: 'DIAN_NOT_ACCEPTED',
          invoice_id: 2,
          dian_status: 'pending',
        }),
      ],
    });
    expect(getCreatedLines()).toHaveLength(2);
  });

  it('uses typed IVA row bases, isolates INC, and sums decimal rows without float residuals', async () => {
    const { service, prisma } = createService();
    prisma.invoices.findMany.mockResolvedValueOnce([{
      id: 20,
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-DECIMAL',
      status: 'accepted',
      dian_status: 'accepted',
      supplier_id: null,
      customer_id: 12,
      customer_name: 'Cliente',
      customer_tax_id: '900123456',
      // Deliberately differs from the actual taxable IVA base.
      subtotal_amount: '9999.99',
      issue_date: new Date('2026-03-15T10:00:00.000Z'),
      invoice_taxes: [
        { id: 201, tax_type: 'iva', taxable_amount: '0.10', tax_amount: '0.10' },
        { id: 202, tax_type: 'iva', taxable_amount: '0.20', tax_amount: '0.20' },
        { id: 203, tax_type: 'inc', taxable_amount: '50.00', tax_amount: '4.00' },
      ],
      supplier: null,
    }]);

    const preview = await service.preview(context, {
      declaration_type: 'vat', period_year: 2026, period_month: 3,
    });

    expect(preview.totals).toMatchObject({
      gross_base_amount: 0.3,
      taxable_base_amount: 0.3,
      generated_tax_amount: 0.3,
      deductible_tax_amount: 0,
    });
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ base_amount: 0.3, tax_amount: 0.3 });
    expect(prisma.invoices.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organization_id: context.organization_id }),
    }));
  });

  it('blocks unclassified tax rows and prevents approval or VAT settlement emission', async () => {
    const { service, prisma, getDraftData, tx, audit, eventEmitter } = createService();
    prisma.invoices.findMany.mockResolvedValueOnce([{
      id: 21,
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-UNTYPED',
      status: 'accepted',
      dian_status: 'accepted',
      supplier_id: null,
      customer_id: 13,
      customer_name: 'Cliente',
      customer_tax_id: '900123456',
      subtotal_amount: '100.00',
      issue_date: new Date('2026-03-15T10:00:00.000Z'),
      invoice_taxes: [
        { id: 211, tax_type: null, taxable_amount: '100.00', tax_amount: '19.00' },
        { id: 212, tax_type: 'unclassified' as any, taxable_amount: '100.00', tax_amount: '19.00' },
      ],
      supplier: null,
    }]);

    await RequestContextService.run(requestContext, () => service.createDraft(context, {
      declaration_type: 'vat', period_year: 2026, period_month: 3,
    }));

    expect(getDraftData().status).toBe('needs_review');
    expect(getDraftData().generated_tax_amount).toBe(0);
    expect(getDraftData().validation_summary.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNCLASSIFIED_INVOICE_TAX', invoice_id: 21, tax_id: 211 }),
      expect.objectContaining({ code: 'UNCLASSIFIED_INVOICE_TAX', invoice_id: 21, tax_id: 212 }),
    ]));
    expect(getDraftData().source_snapshot.skipped_tax_ids).toEqual([211, 212]);
    expect(tx.tax_declaration_lines.createMany).not.toHaveBeenCalled();

    audit.logForResource.mockClear();
    prisma.tax_declaration_drafts.findFirst.mockResolvedValueOnce({
      ...getDraftData(), status: 'needs_review',
    });
    await expect(service.approveDraft([context], getDraftData().id)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.tax_declaration_drafts.update).not.toHaveBeenCalled();
    expect(audit.logForResource).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();

    prisma.tax_declaration_drafts.findFirst.mockResolvedValueOnce({
      ...getDraftData(), status: 'approved',
    });
    await expect(service.approveDraft([context], getDraftData().id)).resolves.toMatchObject({
      status: 'approved',
    });
    expect(prisma.tax_declaration_drafts.update).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it.each([null, 'not-a-number'])('blocks IVA rows with missing or invalid taxable bases (%s)', async (base) => {
    const { service, prisma } = createService();
    prisma.invoices.findMany.mockResolvedValueOnce([{
      id: 22,
      invoice_type: 'purchase_invoice',
      invoice_number: 'FV-BAD-BASE',
      status: 'accepted',
      dian_status: 'accepted',
      supplier_id: 50,
      customer_id: null,
      customer_name: null,
      customer_tax_id: null,
      subtotal_amount: '100.00',
      issue_date: new Date('2026-03-15T10:00:00.000Z'),
      invoice_taxes: [{ id: 221, tax_type: 'iva', taxable_amount: base, tax_amount: '19.00' }],
      supplier: { name: 'Proveedor', tax_id: '900123456' },
    }]);

    const preview = await service.preview(context, {
      declaration_type: 'vat', period_year: 2026, period_month: 3,
    });
    expect(preview.lines).toHaveLength(0);
    expect(preview.validation_summary).toMatchObject({
      errors: [expect.objectContaining({ code: 'INVALID_INVOICE_TAX_BASE', invoice_id: 22, tax_id: 221 })],
    });
    expect(preview.source_snapshot.skipped_tax_ids).toEqual([221]);
  });

  it('blocks IVA rows with invalid tax amounts instead of persisting a NaN', async () => {
    const { service, prisma } = createService();
    prisma.invoices.findMany.mockResolvedValueOnce([{
      id: 24,
      invoice_type: 'purchase_invoice',
      invoice_number: 'FV-BAD-AMOUNT',
      status: 'accepted',
      dian_status: 'accepted',
      supplier_id: 50,
      customer_id: null,
      customer_name: null,
      customer_tax_id: null,
      subtotal_amount: '100.00',
      issue_date: new Date('2026-03-15T10:00:00.000Z'),
      invoice_taxes: [{ id: 241, tax_type: 'iva', taxable_amount: '100.00', tax_amount: 'invalid' }],
      supplier: { name: 'Proveedor', tax_id: '900123456' },
    }]);

    const preview = await service.preview(context, {
      declaration_type: 'vat', period_year: 2026, period_month: 3,
    });
    expect(preview.lines).toHaveLength(0);
    expect(preview.validation_summary).toMatchObject({
      errors: [expect.objectContaining({ code: 'INVALID_INVOICE_TAX_AMOUNT', invoice_id: 24, tax_id: 241 })],
    });
    expect(preview.source_snapshot.skipped_tax_ids).toEqual([241]);
  });

  it('does not count a pending export invoice without DIAN acceptance', async () => {
    const { service, prisma } = createService();
    prisma.invoices.findMany.mockResolvedValueOnce([{
      id: 23,
      invoice_type: 'export_invoice',
      invoice_number: 'EXP-PENDING',
      status: 'validated',
      dian_status: 'pending',
      supplier_id: null,
      customer_id: 14,
      customer_name: 'Export customer',
      customer_tax_id: null,
      subtotal_amount: '100.00',
      issue_date: new Date('2026-03-15T10:00:00.000Z'),
      invoice_taxes: [{ id: 231, tax_type: 'iva', taxable_amount: '100.00', tax_amount: '19.00' }],
      supplier: null,
    }]);

    const preview = await service.preview(context, {
      declaration_type: 'vat', period_year: 2026, period_month: 3,
    });
    expect(preview.lines).toHaveLength(0);
    expect(preview.source_snapshot.skipped_invoice_ids).toEqual([23]);
    expect(preview.validation_summary).toMatchObject({
      warnings: [expect.objectContaining({ code: 'DIAN_NOT_ACCEPTED', invoice_id: 23 })],
      errors: [],
    });
  });

  it('previews VAT through the same calculation without persistence or events', async () => {
    const {
      service,
      prisma,
      tx,
      audit,
      eventEmitter,
      getDraftData,
      getCreatedLines,
    } = createService();
    const dto = {
      declaration_type: 'vat' as const,
      period_year: 2026,
      period_month: 3,
    };

    const preview = await service.preview(context, dto);
    const repeated = await service.preview(context, dto);

    expect(repeated).toEqual(preview);
    expect(preview).toMatchObject({
      declaration_type: 'vat',
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      period_year: 2026,
      period_month: 3,
      period_quarter: null,
      period_start: new Date('2026-03-01T00:00:00.000Z'),
      period_end: new Date('2026-03-31T00:00:00.000Z'),
      periodicity: null,
      jurisdiction_key: 'CO-DIAN',
      is_estimate: true,
      label:
        'Estimación preliminar; el motor fiscal completo está pendiente. No apta para presentar a DIAN.',
    });
    expect(preview.totals).toMatchObject({
      generated_tax_amount: 190,
      deductible_tax_amount: 95,
      balance_due: 95,
      total_payable: 95,
    });
    expect(preview.lines).toHaveLength(2);
    expect(
      preview.lines.every((line) => !('declaration_id' in line)),
    ).toBe(true);
    expect(preview.source_snapshot).toMatchObject({
      counted_invoice_ids: [1, 3],
      skipped_invoice_ids: [2],
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tax_declaration_drafts.create).not.toHaveBeenCalled();
    expect(tx.tax_declaration_drafts.update).not.toHaveBeenCalled();
    expect(tx.tax_declaration_lines.deleteMany).not.toHaveBeenCalled();
    expect(tx.tax_declaration_lines.createMany).not.toHaveBeenCalled();
    expect(audit.logForResource).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, dto),
    );
    const draft = getDraftData();
    expect(preview.totals).toEqual({
      gross_base_amount: draft.gross_base_amount,
      taxable_base_amount: draft.taxable_base_amount,
      generated_tax_amount: draft.generated_tax_amount,
      deductible_tax_amount: draft.deductible_tax_amount,
      balance_due: draft.balance_due,
      balance_favor: draft.balance_favor,
      total_payable: draft.total_payable,
    });
    expect(preview.rules_snapshot).toEqual(draft.rules_snapshot);
    expect(preview.source_snapshot).toEqual(draft.source_snapshot);
    expect(preview.validation_summary).toEqual(draft.validation_summary);
    expect(preview.lines).toEqual(
      getCreatedLines().map((line: any) => {
        const { declaration_id, ...previewLine } = line;
        expect(declaration_id).toBe(draft.id);
        return previewLine;
      }),
    );
  });

  it('validates invalid periods and foreign linked obligations before writes in preview', async () => {
    const { service, prisma, tx } = createService();

    await expect(
      service.preview(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 2,
        period_quarter: 1,
        periodicity: 'monthly',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.fiscal_obligations.findFirst).not.toHaveBeenCalled();

    await expect(
      service.preview(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 3,
        obligation_id: 899,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.fiscal_obligations.findFirst).toHaveBeenCalledWith({
      where: {
        id: 899,
        organization_id: 1,
        accounting_entity_id: 77,
        jurisdiction_key: 'CO-DIAN',
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tax_declaration_drafts.create).not.toHaveBeenCalled();
  });

  it('persists a bimonthly declaration range and its periodicity', async () => {
    const { service, getDraftData } = createService();
    const dto = {
      declaration_type: 'vat' as const,
      period_year: 2024,
      period_month: 2,
      periodicity: 'bimonthly' as const,
    };
    const preview = await service.preview(context, dto);
    expect(preview).toMatchObject({
      period_year: 2024,
      period_month: 2,
      period_start: new Date('2024-01-01T00:00:00.000Z'),
      period_end: new Date('2024-02-29T00:00:00.000Z'),
      periodicity: 'bimonthly',
    });

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, dto),
    );

    expect(getDraftData()).toMatchObject({
      period_year: 2024,
      period_month: 2,
      period_start: new Date('2024-01-01T00:00:00.000Z'),
      period_end: new Date('2024-02-29T00:00:00.000Z'),
      periodicity: 'bimonthly',
      jurisdiction_key: 'CO-DIAN',
    });
  });

  it('persists a four-month declaration range and its periodicity', async () => {
    const { service, getDraftData } = createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 5,
        periodicity: 'four_monthly',
      }),
    );

    expect(getDraftData()).toMatchObject({
      period_year: 2026,
      period_month: 8,
      period_start: new Date('2026-05-01T00:00:00.000Z'),
      period_end: new Date('2026-08-31T00:00:00.000Z'),
      periodicity: 'four_monthly',
    });
  });

  it('does not reuse a monthly declaration draft for the same closing month as bimonthly', async () => {
    const { service, prisma, tx } = createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 2,
        periodicity: 'monthly',
      }),
    );
    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2026,
        period_month: 2,
        periodicity: 'bimonthly',
      }),
    );

    expect(tx.tax_declaration_drafts.create).toHaveBeenCalledTimes(2);
    expect(
      prisma.tax_declaration_drafts.findFirst.mock.calls.map(
        (call) => call[0].where,
      ),
    ).toEqual([
      expect.objectContaining({
        organization_id: 1,
        accounting_entity_id: 77,
        periodicity: 'monthly',
        jurisdiction_key: 'CO-DIAN',
        status: { notIn: ['approved', 'submitted', 'accepted', 'paid', 'voided'] },
      }),
      expect.objectContaining({
        organization_id: 1,
        accounting_entity_id: 77,
        periodicity: 'bimonthly',
        jurisdiction_key: 'CO-DIAN',
        status: { notIn: ['approved', 'submitted', 'accepted', 'paid', 'voided'] },
      }),
    ]);
  });

  it('recalculates a stored bimonthly draft using the same range', async () => {
    const { service, prisma, tx } = createService();
    const storedDraft = {
      id: 33,
      status: 'ready',
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      declaration_type: 'vat',
      period_year: 2024,
      period_month: 2,
      period_quarter: null,
      period_start: new Date('2024-01-01T00:00:00.000Z'),
      period_end: new Date('2024-02-29T00:00:00.000Z'),
      periodicity: 'bimonthly',
      obligation_id: null,
    };
    prisma.tax_declaration_drafts.findFirst
      .mockImplementationOnce(async () => storedDraft)
      .mockImplementationOnce(async () => null);

    await RequestContextService.run(requestContext, () =>
      service.recalculateDraft([context], storedDraft.id),
    );

    expect(tx.tax_declaration_drafts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          period_start: new Date('2024-01-01T00:00:00.000Z'),
          period_end: new Date('2024-02-29T00:00:00.000Z'),
          periodicity: 'bimonthly',
        }),
      }),
    );
  });

  it('rejects malformed persisted periodicity rather than silently recalculating', async () => {
    const { service, prisma, tx } = createService();
    prisma.tax_declaration_drafts.findFirst.mockResolvedValue({
      id: 34,
      status: 'ready',
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      declaration_type: 'vat',
      period_year: 2026,
      period_month: 2,
      period_quarter: null,
      periodicity: 'quarterly',
      obligation_id: null,
    });

    await expect(
      RequestContextService.run(requestContext, () =>
        service.recalculateDraft([context], 34),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
    expect(tx.tax_declaration_drafts.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid period before any database access', async () => {
    const { service, prisma, tx } = createService();

    await expect(
      RequestContextService.run(requestContext, () =>
        service.createDraft(context, {
          declaration_type: 'vat',
          period_year: 2026,
          period_month: 13,
          periodicity: 'monthly',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.fiscal_obligations.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
    expect(prisma.tax_declaration_drafts.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('inherits periodicity from a same-entity linked obligation', async () => {
    const { service, prisma, getDraftData } = createService();
    prisma.fiscal_obligations.findFirst.mockResolvedValue({
      id: 88,
      organization_id: 1,
      accounting_entity_id: 77,
      type: 'vat_return',
      period_year: 2024,
      period_month: 2,
      period_start: new Date('2024-01-01T00:00:00.000Z'),
      period_end: new Date('2024-02-29T00:00:00.000Z'),
      periodicity: 'bimonthly',
    });

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'vat',
        period_year: 2024,
        period_month: 2,
        obligation_id: 88,
      }),
    );

    expect(prisma.fiscal_obligations.findFirst).toHaveBeenCalledWith({
      where: {
        id: 88,
        organization_id: 1,
        accounting_entity_id: 77,
        jurisdiction_key: 'CO-DIAN',
      },
    });
    expect(getDraftData()).toMatchObject({
      obligation_id: 88,
      periodicity: 'bimonthly',
      period_start: new Date('2024-01-01T00:00:00.000Z'),
      period_end: new Date('2024-02-29T00:00:00.000Z'),
    });
  });

  it('rejects a cross-entity linked obligation before calculation or mutation', async () => {
    const { service, prisma, tx } = createService();
    prisma.fiscal_obligations.findFirst.mockResolvedValue(null);

    await expect(
      RequestContextService.run(requestContext, () =>
        service.createDraft(context, {
          declaration_type: 'vat',
          period_year: 2026,
          period_month: 3,
          obligation_id: 99,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.tax_declaration_drafts.create).not.toHaveBeenCalled();
  });

  it('rejects an obligation with a mismatched declaration type or period', async () => {
    const { service, prisma } = createService();
    prisma.fiscal_obligations.findFirst.mockResolvedValue({
      id: 89,
      organization_id: 1,
      accounting_entity_id: 77,
      type: 'inc_return',
      period_start: new Date('2026-03-01T00:00:00.000Z'),
      period_end: new Date('2026-03-31T00:00:00.000Z'),
      periodicity: 'monthly',
    });

    await expect(
      RequestContextService.run(requestContext, () =>
        service.createDraft(context, {
          declaration_type: 'vat',
          period_year: 2026,
          period_month: 3,
          periodicity: 'monthly',
          obligation_id: 89,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
  });

  it('rejects an obligation date range that differs from the declaration period', async () => {
    const { service, prisma } = createService();
    prisma.fiscal_obligations.findFirst.mockResolvedValue({
      id: 90,
      organization_id: 1,
      accounting_entity_id: 77,
      type: 'vat_return',
      period_start: new Date('2026-01-01T00:00:00.000Z'),
      period_end: new Date('2026-02-28T00:00:00.000Z'),
      periodicity: 'monthly',
    });

    await expect(
      RequestContextService.run(requestContext, () =>
        service.createDraft(context, {
          declaration_type: 'vat',
          period_year: 2026,
          period_month: 3,
          periodicity: 'monthly',
          obligation_id: 90,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
  });

  it('rejects an explicit periodicity that conflicts with its obligation', async () => {
    const { service, prisma } = createService();
    prisma.fiscal_obligations.findFirst.mockResolvedValue({
      id: 91,
      organization_id: 1,
      accounting_entity_id: 77,
      type: 'vat_return',
      period_start: new Date('2026-01-01T00:00:00.000Z'),
      period_end: new Date('2026-02-28T00:00:00.000Z'),
      periodicity: 'monthly',
    });

    await expect(
      RequestContextService.run(requestContext, () =>
        service.createDraft(context, {
          declaration_type: 'vat',
          period_year: 2026,
          period_month: 2,
          periodicity: 'bimonthly',
          obligation_id: 91,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
  });
});

describe('TaxDeclarationDraftService withholding calculation (purchases + payroll)', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: 2,
    fiscal_scope: 'STORE',
    operating_scope: 'STORE',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = () => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 11, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      withholding_calculations: {
        findMany: jest.fn().mockResolvedValue([
          {
            // Retención de compra (proveedor + factura)
            id: 100,
            invoice_id: 5,
            supplier_id: 50,
            customer_id: null,
            counterparty_type: null,
            withholding_type: 'retefuente',
            base_amount: 1000000,
            withholding_rate: 0.025,
            withholding_amount: 25000,
            uvt_value_used: 49799,
            concept: { code: 'RTE_COMPRAS', name: 'Retención en Compras' },
            supplier: { name: 'Proveedor Uno', tax_id: '123456789' },
            invoice: { id: 5 },
            created_at: new Date('2026-04-10T10:00:00.000Z'),
          },
          {
            // Retención laboral de nómina (invoice_id null, employee)
            id: 101,
            invoice_id: null,
            supplier_id: null,
            customer_id: null,
            counterparty_type: 'employee',
            withholding_type: 'retefuente',
            base_amount: 5200000,
            withholding_rate: 0.01,
            withholding_amount: 52000,
            uvt_value_used: 49799,
            concept: { code: 'RTE_SALARIOS', name: 'Salarios y pagos laborales' },
            supplier: null,
            invoice: null,
            created_at: new Date('2026-04-30T10:00:00.000Z'),
          },
        ]),
      },
      fiscal_rule_sets: { findFirst: jest.fn().mockResolvedValue(null) },
      tax_declaration_drafts: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };
    const fiscalRules = {
      resolveEffectiveRules: jest.fn().mockResolvedValue({
        general_rate_percent: 35,
        source: 'vendix_default_fallback',
      }),
    };
    const exogenousGenerator = {
      // One entry per DIAN exogenous format the service dispatches. A missing
      // one does not fail loudly at wiring time — it explodes inside the
      // generator loop as "is not a function", so the list must stay complete.
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1006: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
      generateFormat1008: jest.fn().mockResolvedValue([]),
      generateFormat1009: jest.fn().mockResolvedValue([]),
      generateFormat2276: jest.fn().mockResolvedValue([]),
    };

    // The service emits domain events on draft transitions; positional
    // construction means the emitter must be passed even when unasserted.
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
        eventEmitter as any,
      ),
      prisma,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  it('sums purchase and payroll withholdings and keeps labor lines distinguishable', async () => {
    const { service, getDraftData, getCreatedLines } = createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'withholding',
        period_year: 2026,
        period_month: 4,
      }),
    );

    const draft = getDraftData();
    expect(draft.withholding_amount).toBe(25000 + 52000);
    expect(draft.total_payable).toBe(77000);
    expect(draft.gross_base_amount).toBe(1000000 + 5200000);

    const lines = getCreatedLines();
    expect(lines).toHaveLength(2);

    const purchaseLine = lines.find((line: any) => line.source_id === 100);
    expect(purchaseLine).toMatchObject({
      line_type: 'withholding_practiced',
      description: 'RTE_COMPRAS - Retención en Compras',
      withholding_amount: 25000,
    });

    const laborLine = lines.find((line: any) => line.source_id === 101);
    expect(laborLine).toMatchObject({
      line_type: 'withholding_practiced',
      description: 'Retefuente laboral - Salarios y pagos laborales',
      base_amount: 5200000,
      withholding_amount: 52000,
    });
    expect(laborLine.metadata).toMatchObject({
      invoice_id: null,
      counterparty_type: 'employee',
    });

    // Labor rows have no supplier by design: no SUPPLIER_WITHOUT_TAX_ID warning
    expect(draft.validation_summary).toMatchObject({ warnings: [] });
  });
});

describe('TaxDeclarationDraftService exogenous calculation (generator delegation)', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 88,
    accounting_entity: { id: 88 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: undefined,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = () => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 12, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      fiscal_rule_sets: { findFirst: jest.fn().mockResolvedValue(null) },
      tax_declaration_drafts: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };
    const fiscalRules = {
      resolveEffectiveRules: jest.fn().mockResolvedValue({
        general_rate_percent: 35,
        source: 'vendix_default_fallback',
      }),
    };
    const exogenousGenerator = {
      generateFormat1001: jest.fn().mockResolvedValue([
        {
          third_party_nit: '123456789',
          third_party_name: 'Proveedor Uno',
          third_party_dv: '7',
          concept_code: 'RTE_COMPRAS',
          payment_amount: 1000000,
          tax_amount: 0,
          withholding_amount: 25000,
          role: 'practiced',
        },
      ]),
      generateFormat1003: jest.fn().mockResolvedValue([
        {
          third_party_nit: '900111222',
          third_party_name: 'Cliente Agente',
          concept_code: 'RTE_VENTAS',
          payment_amount: 2000000,
          tax_amount: 0,
          withholding_amount: 50000,
          role: 'suffered',
        },
      ]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([
        {
          third_party_nit: '900333444',
          third_party_name: 'Cliente Dos',
          concept_code: 'INGRESOS',
          payment_amount: 3000000,
          tax_amount: 570000,
          withholding_amount: 0,
        },
      ]),
      // Formats this case does not assert, but which the service still
      // dispatches. Empty results keep them out of the materialized lines while
      // preventing an "is not a function" crash mid-loop.
      generateFormat1006: jest.fn().mockResolvedValue([]),
      generateFormat1008: jest.fn().mockResolvedValue([]),
      generateFormat1009: jest.fn().mockResolvedValue([]),
      generateFormat2276: jest.fn().mockResolvedValue([]),
    };

    // The service emits domain events on draft transitions; positional
    // construction means the emitter must be passed even when unasserted.
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
        eventEmitter as any,
      ),
      exogenousGenerator,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  it('materializes generator aggregates as traceable declaration lines', async () => {
    const { service, exogenousGenerator, getDraftData, getCreatedLines } =
      createService();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'exogenous',
        period_year: 2026,
      }),
    );

    // Annual: generator receives the obligation year and the org/store scope
    expect(exogenousGenerator.generateFormat1001).toHaveBeenCalledWith(
      1,
      null,
      2026,
    );
    expect(exogenousGenerator.generateFormat1003).toHaveBeenCalledWith(
      1,
      null,
      2026,
    );

    const lines = getCreatedLines();
    expect(lines).toHaveLength(3);
    expect(lines.every((line: any) => line.source_type === 'exogenous_generator')).toBe(
      true,
    );

    const f1001 = lines.find(
      (line: any) => line.metadata?.format_code === '1001',
    );
    expect(f1001).toMatchObject({
      line_type: 'exogenous_third_party',
      third_party_tax_id: '123456789',
      concept_code: 'RTE_COMPRAS',
      description: 'Formato 1001 - RTE_COMPRAS',
      base_amount: 1000000,
      withholding_amount: 25000,
    });
    expect(f1001.metadata).toMatchObject({ role: 'practiced', third_party_dv: '7' });

    const draft = getDraftData();
    expect(draft.gross_base_amount).toBe(1000000 + 2000000 + 3000000);
    expect(draft.withholding_amount).toBe(25000 + 50000);
    // Exógena es informativa: no produce saldo a pagar
    expect(draft.total_payable).toBe(0);
    expect(draft.source_snapshot).toMatchObject({
      generator: 'ExogenousGeneratorService',
      fiscal_year: 2026,
      line_count_by_format: { '1001': 1, '1003': 1, '1005': 0, '1007': 1 },
    });
  });
});

describe('TaxDeclarationDraftService income tax preclose estimation', () => {
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 77,
    accounting_entity: { id: 77 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: undefined,
    is_super_admin: false,
    is_owner: true,
  };

  const revenueLine = (id: number, amount: number) => ({
    id,
    entry_id: 1000 + id,
    account_id: 10,
    debit_amount: 0,
    credit_amount: amount,
    description: 'Ventas del periodo',
    account: { account_type: 'revenue', code: '4135', name: 'Ventas' },
  });

  const expenseLine = (id: number, amount: number) => ({
    id,
    entry_id: 1000 + id,
    account_id: 11,
    debit_amount: amount,
    credit_amount: 0,
    description: 'Gastos del periodo',
    account: { account_type: 'expense', code: '5105', name: 'Gastos' },
  });

  const createService = ({
    accountingLines = [] as any[],
    sufferedCalculations = [] as any[],
    rules = {
      general_rate_percent: 35,
      legal_basis: 'Art. 240 ET (Ley 2277 de 2022)',
    } as Record<string, unknown>,
  } = {}) => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 13, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      accounting_entry_lines: {
        findMany: jest.fn().mockResolvedValue(accountingLines),
      },
      withholding_calculations: {
        findMany: jest.fn().mockResolvedValue(sufferedCalculations),
      },
      tax_declaration_drafts: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };
    const exogenousGenerator = {
      // One entry per DIAN exogenous format the service dispatches. A missing
      // one does not fail loudly at wiring time — it explodes inside the
      // generator loop as "is not a function", so the list must stay complete.
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1006: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
      generateFormat1008: jest.fn().mockResolvedValue([]),
      generateFormat1009: jest.fn().mockResolvedValue([]),
      generateFormat2276: jest.fn().mockResolvedValue([]),
    };
    const fiscalRules = {
      resolveEffectiveRules: jest.fn().mockResolvedValue(rules),
    };

    // The service emits domain events on draft transitions; positional
    // construction means the emitter must be passed even when unasserted.
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
        eventEmitter as any,
      ),
      prisma,
      fiscalRules,
      audit,
      eventEmitter,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  const runPreclose = (service: TaxDeclarationDraftService) =>
    RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'income_tax_precierre',
        period_year: 2026,
      }),
    );

  it('previews income preclose with the same totals and snapshots as draft creation', async () => {
    const {
      service,
      prisma,
      audit,
      eventEmitter,
      getDraftData,
      getCreatedLines,
    } = createService({
        accountingLines: [revenueLine(1, 100_000_000), expenseLine(2, 60_000_000)],
        sufferedCalculations: [
          { id: 250, withholding_type: 'retefuente', withholding_amount: 5_000_000 },
        ],
      });
    const dto = {
      declaration_type: 'income_tax_precierre' as const,
      period_year: 2026,
    };

    const preview = await service.preview(context, dto);
    expect(preview).toMatchObject({
      declaration_type: 'income_tax_precierre',
      organization_id: 1,
      store_id: null,
      accounting_entity_id: 77,
      period_start: new Date('2026-01-01T00:00:00.000Z'),
      period_end: new Date('2026-12-31T00:00:00.000Z'),
      period_month: null,
      period_quarter: null,
      periodicity: null,
      jurisdiction_key: 'CO-DIAN',
      is_estimate: true,
    });
    expect(
      preview.lines.every((line) => !('declaration_id' in line)),
    ).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.logForResource).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, dto),
    );
    const draft = getDraftData();
    expect(preview.totals).toEqual({
      gross_base_amount: draft.gross_base_amount,
      taxable_base_amount: draft.taxable_base_amount,
      generated_tax_amount: draft.generated_tax_amount,
      withholding_amount: draft.withholding_amount,
      balance_due: draft.balance_due,
      balance_favor: draft.balance_favor,
      total_payable: draft.total_payable,
    });
    expect(preview.rules_snapshot).toEqual(draft.rules_snapshot);
    expect(preview.source_snapshot).toEqual(draft.source_snapshot);
    expect(preview.validation_summary).toEqual(draft.validation_summary);
    expect(preview.lines).toEqual(
      getCreatedLines().map((line: any) => {
        const { declaration_id, ...previewLine } = line;
        expect(declaration_id).toBe(draft.id);
        return previewLine;
      }),
    );
  });

  it('estimates income tax with the effective rate and suffered withholdings as credit', async () => {
    const { service, fiscalRules, getDraftData, getCreatedLines } =
      createService({
        accountingLines: [revenueLine(1, 100_000_000), expenseLine(2, 60_000_000)],
        sufferedCalculations: [
          {
            id: 200,
            withholding_type: 'retefuente',
            withholding_amount: 5_000_000,
          },
        ],
      });

    await runPreclose(service);

    const draft = getDraftData();
    expect(draft.gross_base_amount).toBe(100_000_000);
    expect(draft.taxable_base_amount).toBe(40_000_000);
    expect(draft.generated_tax_amount).toBe(14_000_000);
    expect(draft.withholding_amount).toBe(5_000_000);
    expect(draft.balance_due).toBe(9_000_000);
    expect(draft.balance_favor).toBe(0);
    // Precierre: estimación interna, nunca una obligación de pago
    expect(draft.total_payable).toBe(0);
    expect(draft.rules_snapshot).toMatchObject({ general_rate_percent: 35 });
    expect(draft.validation_summary).toMatchObject({
      warnings: [{ code: 'INCOME_TAX_PRECLOSE_ESTIMATE' }],
    });
    expect(draft.source_snapshot).toMatchObject({
      accounting_line_count: 2,
      suffered_calculation_ids: [200],
    });
    expect(fiscalRules.resolveEffectiveRules).toHaveBeenCalledWith(
      { organization_id: 1, accounting_entity_id: 77 },
      'income_tax',
      2026,
    );

    const lines = getCreatedLines();
    const estimateLine = lines.find(
      (line: any) => line.line_type === 'income_tax_estimate',
    );
    expect(estimateLine).toMatchObject({
      source_type: 'fiscal_rule',
      base_amount: 40_000_000,
      tax_amount: 14_000_000,
    });
    expect(estimateLine.metadata).toMatchObject({
      rate_percent: 35,
      revenue: 100_000_000,
      costs_and_expenses: 60_000_000,
      legal_basis: 'Art. 240 ET (Ley 2277 de 2022)',
    });

    const creditLine = lines.find(
      (line: any) => line.line_type === 'withholding_suffered_credit',
    );
    expect(creditLine).toMatchObject({
      source_type: 'withholding_calculation',
      withholding_amount: 5_000_000,
    });
    expect(creditLine.metadata).toMatchObject({
      withholding_type: 'retefuente',
      calculation_count: 1,
    });
  });

  it('reports an accounting loss without crediting untyped suffered withholding', async () => {
    const { service, getDraftData } = createService({
      accountingLines: [revenueLine(1, 10_000_000), expenseLine(2, 20_000_000)],
      sufferedCalculations: [
        {
          id: 201,
          withholding_type: null,
          withholding_amount: 5_000_000,
        },
      ],
    });

    await runPreclose(service);

    const draft = getDraftData();
    // Base informativa negativa, pero el impuesto estimado nunca baja de 0
    expect(draft.taxable_base_amount).toBe(-10_000_000);
    expect(draft.generated_tax_amount).toBe(0);
    expect(draft.balance_due).toBe(0);
    expect(draft.withholding_amount).toBe(0);
    expect(draft.balance_favor).toBe(0);
    expect(draft.total_payable).toBe(0);
    expect(draft.validation_summary).toMatchObject({
      warnings: [
        { code: 'INCOME_TAX_PRECLOSE_ESTIMATE' },
        { code: 'NEGATIVE_TAXABLE_BASE' },
        {
          code: 'UNCLASSIFIED_SUFFERED_WITHHOLDING',
          withholding_calculation_ids: [201],
          excluded_amount: 5_000_000,
        },
      ],
    });
    expect(draft.source_snapshot).toMatchObject({
      suffered_calculation_ids: [201],
      income_tax_credit_calculation_ids: [],
      excluded_suffered_calculation_ids: [201],
      unclassified_suffered_calculation_ids: [201],
      unclassified_suffered_withholding_amount: 5_000_000,
    });
  });

  it('credits only suffered retefuente and reports untyped rows requiring classification', async () => {
    const { service, prisma, getDraftData, getCreatedLines } = createService({
      accountingLines: [revenueLine(1, 100_000_000), expenseLine(2, 60_000_000)],
      sufferedCalculations: [
        { id: 301, withholding_type: 'retefuente', withholding_amount: 50 },
        { id: 302, withholding_type: 'reteiva', withholding_amount: 30 },
        { id: 303, withholding_type: 'reteica', withholding_amount: 20 },
        { id: 304, withholding_type: null, withholding_amount: 25 },
      ],
    });

    await runPreclose(service);

    const draft = getDraftData();
    expect(draft.generated_tax_amount).toBe(14_000_000);
    expect(draft.withholding_amount).toBe(50);
    expect(draft.balance_due).toBe(13_999_950);
    expect(draft.source_snapshot).toMatchObject({
      suffered_calculation_ids: [301, 302, 303, 304],
      income_tax_credit_calculation_ids: [301],
      excluded_suffered_calculation_ids: [302, 303, 304],
      unclassified_suffered_calculation_ids: [304],
      unclassified_suffered_withholding_amount: 25,
    });
    expect(draft.validation_summary).toMatchObject({
      warnings: [
        { code: 'INCOME_TAX_PRECLOSE_ESTIMATE' },
        {
          code: 'UNCLASSIFIED_SUFFERED_WITHHOLDING',
          withholding_calculation_ids: [304],
          excluded_amount: 25,
        },
      ],
    });
    expect(
      getCreatedLines().filter(
        (line: any) => line.line_type === 'withholding_suffered_credit',
      ),
    ).toMatchObject([
      {
        withholding_amount: 50,
        metadata: { withholding_type: 'retefuente', calculation_count: 1 },
      },
    ]);
    expect(prisma.withholding_calculations.findMany).toHaveBeenCalledWith({
      where: {
        organization_id: 1,
        accounting_entity_id: 77,
        role: 'suffered',
        year: 2026,
      },
    });
  });

  it('queries suffered withholdings by semantic fiscal year, not created_at', async () => {
    const { service, prisma } = createService({
      accountingLines: [revenueLine(1, 1_000_000)],
    });

    await runPreclose(service);

    expect(prisma.withholding_calculations.findMany).toHaveBeenCalledWith({
      where: {
        organization_id: 1,
        accounting_entity_id: 77,
        role: 'suffered',
        year: 2026,
      },
    });
    const where =
      prisma.withholding_calculations.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('created_at');
  });

  it('uses a custom general_rate_percent from the effective rules', async () => {
    const { service, getDraftData } = createService({
      accountingLines: [revenueLine(1, 100_000_000), expenseLine(2, 60_000_000)],
      rules: { general_rate_percent: 9 },
    });

    await runPreclose(service);

    const draft = getDraftData();
    expect(draft.generated_tax_amount).toBe(3_600_000);
    expect(draft.balance_due).toBe(3_600_000);
    expect(draft.total_payable).toBe(0);
  });
});

describe('TaxDeclarationDraftService ICA calculation (multi-store, multi-municipality)', () => {
  // Regression test for a critical bug: when an ORGANIZATION-scope org has
  // invoices from 2+ stores, `storeInvoices` was reassigned to the FULL
  // invoice pool on every loop iteration instead of being filtered per
  // store, so the declared base/tax were multiplied by the number of
  // stores. `invoices.store_id` is a NOT NULL Int column, so filtering by
  // `store_id === store.id` must always be safe and must never duplicate a
  // given invoice across stores.
  const context: FiscalOperationsContext = {
    organization_id: 1,
    store_id: null,
    fiscal_scope: 'ORGANIZATION',
    operating_scope: 'ORGANIZATION',
    accounting_entity_id: 99,
    accounting_entity: { id: 99 },
    can_read: true,
    can_write: true,
  } as any;

  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: undefined,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = ({
    stores,
    invoices,
    rates,
  }: {
    stores: Array<{
      id: number;
      municipality_code: string | null;
      ciiu_code: string | null;
    }>;
    invoices: Array<{
      id: number;
      store_id: number;
      invoice_type: string;
      invoice_number: string;
      subtotal_amount: number;
      issue_date: Date;
    }>;
    rates: Record<
      string,
      { rate_per_mil: number; municipality_name: string }
    >;
  }) => {
    let draftData: any;
    let createdLines: any[] = [];
    const tx = {
      tax_declaration_drafts: {
        create: jest.fn().mockImplementation(({ data }) => {
          draftData = { id: 20, ...data };
          return draftData;
        }),
        update: jest.fn(),
        findUnique: jest.fn().mockImplementation(() => ({
          ...draftData,
          lines: createdLines,
          obligation: null,
          evidence: null,
        })),
      },
      tax_declaration_lines: {
        deleteMany: jest.fn(),
        createMany: jest.fn().mockImplementation(({ data }) => {
          createdLines = data;
          return { count: data.length };
        }),
      },
    };
    const prisma = {
      invoices: {
        findMany: jest.fn().mockResolvedValue(invoices),
      },
      organizations: {
        findUnique: jest.fn().mockResolvedValue({ ciiu_code: null }),
      },
      stores: {
        findMany: jest.fn().mockResolvedValue(stores),
        findUnique: jest.fn(),
      },
      ica_municipal_rates: {
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const key = `${where.municipality_code}:${where.ciiu_code ?? 'null'}`;
          const rate = rates[key];
          return rate
            ? {
                rate_per_mil: rate.rate_per_mil,
                municipality_code: where.municipality_code,
                municipality_name: rate.municipality_name,
                ciiu_code: where.ciiu_code,
                ciiu_description: null,
              }
            : null;
        }),
      },
      fiscal_rule_sets: { findFirst: jest.fn().mockResolvedValue(null) },
      tax_declaration_drafts: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const audit = { logForResource: jest.fn() };
    const fiscalRules = { resolveEffectiveRules: jest.fn() };
    const exogenousGenerator = {
      // One entry per DIAN exogenous format the service dispatches. A missing
      // one does not fail loudly at wiring time — it explodes inside the
      // generator loop as "is not a function", so the list must stay complete.
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1006: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
      generateFormat1008: jest.fn().mockResolvedValue([]),
      generateFormat1009: jest.fn().mockResolvedValue([]),
      generateFormat2276: jest.fn().mockResolvedValue([]),
    };

    // The service emits domain events on draft transitions; positional
    // construction means the emitter must be passed even when unasserted.
    const eventEmitter = { emit: jest.fn(), emitAsync: jest.fn() };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
        eventEmitter as any,
      ),
      prisma,
      getDraftData: () => draftData,
      getCreatedLines: () => createdLines,
    };
  };

  it('does not duplicate the declared ICA base across stores in different municipalities', async () => {
    // Reproduces the reviewer's manual calculation: store A (municipality
    // 11001, rate 5‰) bills 1,000,000; store B (municipality 76001, rate
    // 7‰) bills 500,000. Real total base = 1,500,000. Real total tax =
    // 1,000,000*5/1000 + 500,000*7/1000 = 5,000 + 3,500 = 8,500.
    // The bug computed totalBase=3,000,000 and totalTax=18,000 (every
    // invoice counted once per store in the loop).
    const { service, getDraftData, getCreatedLines } = createService({
      stores: [
        { id: 10, municipality_code: '11001', ciiu_code: null },
        { id: 20, municipality_code: '76001', ciiu_code: null },
      ],
      invoices: [
        {
          id: 1,
          store_id: 10,
          invoice_type: 'sales_invoice',
          invoice_number: 'FV-A1',
          subtotal_amount: 1_000_000,
          issue_date: new Date('2026-05-05T10:00:00.000Z'),
        },
        {
          id: 2,
          store_id: 20,
          invoice_type: 'sales_invoice',
          invoice_number: 'FV-B1',
          subtotal_amount: 500_000,
          issue_date: new Date('2026-05-06T10:00:00.000Z'),
        },
      ],
      rates: {
        '11001:null': { rate_per_mil: 5, municipality_name: 'Bogotá' },
        '76001:null': { rate_per_mil: 7, municipality_name: 'Cali' },
      },
    });

    await RequestContextService.run(requestContext, () =>
      service.createDraft(context, {
        declaration_type: 'ica',
        period_year: 2026,
        period_month: 5,
      }),
    );

    const draft = getDraftData();

    // Real base: no multiplication by store count.
    expect(draft.gross_base_amount).toBe(1_500_000);
    expect(draft.taxable_base_amount).toBe(1_500_000);
    expect(draft.generated_tax_amount).toBe(8_500);
    expect(draft.balance_due).toBe(8_500);
    expect(draft.total_payable).toBe(8_500);

    // Each invoice appears exactly once, attributed to its own store — no
    // duplicate detail lines with the full unprorated base.
    const lines = getCreatedLines();
    expect(lines).toHaveLength(2);
    const lineA = lines.find((line: any) => line.source_id === 1);
    const lineB = lines.find((line: any) => line.source_id === 2);
    expect(lineA).toMatchObject({ base_amount: 1_000_000, tax_amount: 5_000 });
    expect(lineB).toMatchObject({ base_amount: 500_000, tax_amount: 3_500 });

    // Sum of per-municipality rows equals the real total base, not a multiple.
    const sourceSnapshot = draft.source_snapshot as any;
    const sumOfRows = sourceSnapshot.stores_with_rate.reduce(
      (sum: number, row: any) => sum + row.base,
      0,
    );
    expect(sumOfRows).toBe(1_500_000);
  });

  it('keeps single-store ICA calculation unchanged (no duplication possible)', async () => {
    const singleStoreContext: FiscalOperationsContext = {
      organization_id: 1,
      store_id: 10,
      fiscal_scope: 'STORE',
      operating_scope: 'STORE',
      accounting_entity_id: 55,
      accounting_entity: { id: 55 },
      can_read: true,
      can_write: true,
    } as any;

    const { service, getDraftData } = createService({
      stores: [{ id: 10, municipality_code: '11001', ciiu_code: null }],
      invoices: [
        {
          id: 1,
          store_id: 10,
          invoice_type: 'sales_invoice',
          invoice_number: 'FV-1',
          subtotal_amount: 2_000_000,
          issue_date: new Date('2026-05-05T10:00:00.000Z'),
        },
      ],
      rates: {
        '11001:null': { rate_per_mil: 5, municipality_name: 'Bogotá' },
      },
    });
    // STORE scope resolves the store via `stores.findUnique`, not `findMany`.
    (service as any).prisma.stores.findUnique = jest
      .fn()
      .mockResolvedValue({ id: 10, municipality_code: '11001', ciiu_code: null });

    await RequestContextService.run(
      { ...requestContext, store_id: 10 },
      () =>
        service.createDraft(singleStoreContext, {
          declaration_type: 'ica',
          period_year: 2026,
          period_month: 5,
        }),
    );

    const draft = getDraftData();
    expect(draft.gross_base_amount).toBe(2_000_000);
    expect(draft.generated_tax_amount).toBe(10_000);
    expect(draft.total_payable).toBe(10_000);
  });
});
