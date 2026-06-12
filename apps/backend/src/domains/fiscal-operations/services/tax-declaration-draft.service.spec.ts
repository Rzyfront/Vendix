import { RequestContextService } from '@common/context/request-context.service';
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
            invoice_taxes: [{ tax_amount: 190 }],
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
            invoice_taxes: [{ tax_amount: 190 }],
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
            invoice_taxes: [{ tax_amount: 95 }],
            supplier: { name: 'Proveedor Uno', tax_id: '123456789' },
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
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
    };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
      ),
      prisma,
      tx,
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
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
    };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
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
    };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
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
      generateFormat1001: jest.fn().mockResolvedValue([]),
      generateFormat1003: jest.fn().mockResolvedValue([]),
      generateFormat1005: jest.fn().mockResolvedValue([]),
      generateFormat1007: jest.fn().mockResolvedValue([]),
    };
    const fiscalRules = {
      resolveEffectiveRules: jest.fn().mockResolvedValue(rules),
    };

    return {
      service: new TaxDeclarationDraftService(
        prisma as any,
        audit as any,
        exogenousGenerator as any,
        fiscalRules as any,
      ),
      prisma,
      fiscalRules,
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

  it('reports zero tax, negative-base warning, and full credit in favor on accounting loss', async () => {
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
    expect(draft.balance_favor).toBe(5_000_000);
    expect(draft.total_payable).toBe(0);
    expect(draft.validation_summary).toMatchObject({
      warnings: [
        { code: 'INCOME_TAX_PRECLOSE_ESTIMATE' },
        { code: 'NEGATIVE_TAXABLE_BASE' },
      ],
    });
  });

  it('queries suffered withholdings by semantic fiscal year, not created_at', async () => {
    const { service, prisma } = createService({
      accountingLines: [revenueLine(1, 1_000_000)],
    });

    await runPreclose(service);

    expect(prisma.withholding_calculations.findMany).toHaveBeenCalledWith({
      where: {
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
