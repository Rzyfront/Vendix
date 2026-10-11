import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../common/context/request-context.service';
import { buildContractSnapshot } from '../contracts/contracts-snapshot';
import { buildQuotationContractEconomicSnapshot } from '../quotations/quotation-contract-economics';
import { buildDefaultAiuProfileConfig } from './profiles/invoice-profile-config.contract';
import { InvoicingService } from './invoicing.service';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';

const CONTEXT = {
  user_id: 9,
  organization_id: 1,
  store_id: 2,
  is_super_admin: false,
  is_owner: true,
};

function frozenContract(
  overrides: Record<string, unknown> = {},
  profileContractObject = 'Construcción de bodega industrial',
) {
  const config = buildDefaultAiuProfileConfig('Construcción de bodega industrial');
  config.aiu!.contract_object = profileContractObject;
  config.aiu!.accounting_model = 'sumada';
  config.taxes.rules = [
    { bucket: 'administracion', taxable: true, tax_code: '01', rate: '19.00', taxable_basis: 'aiu' },
    { bucket: 'imprevistos', taxable: true, tax_code: '01', rate: '19.00', taxable_basis: 'aiu' },
    { bucket: 'utilidad', taxable: true, tax_code: '04', rate: '8.00', taxable_basis: 'aiu' },
    { bucket: 'costo', taxable: false, tax_code: '01', rate: '0.00', taxable_basis: 'aiu' },
  ];
  config.accounting!.revenue_account_by_bucket = {
    costo: '4135',
    administracion: '4140',
    imprevistos: '4145',
    utilidad: '4150',
  };
  config.dian.document_type = 'sales_invoice';
  config.dian.payment_method_code = '2';
  config.dian.payment_means_code = '10';
  config.dian.header_notes = ['Nota congelada del perfil'];
  config.dian.resolution_id = 12;
  config.dian.resolution_number = 'RES-12';
  config.currency = { declare_foreign: true, code: 'USD' };

  const economic = buildQuotationContractEconomicSnapshot({
    frozen_at: '2026-10-10T12:00:00.000Z',
    invoice_profile: {
      profile_id: 81,
      version: 4,
      name: 'Perfil AIU archivado',
      config,
    },
    quotation_profile: null,
    contract_object: 'Construcción de bodega industrial',
    due_date: '2099-12-31',
    cost_lines: [
      {
        description: 'Costo directo de obra',
        quantity: '1',
        unit_price: '1000.00',
        discount_amount: '10.00',
        unit_code: '94',
      },
    ],
  });
  const quote = {
    id: 8,
    quotation_number: 'QT-8',
    destination: 'contract',
    status: 'accepted',
    subtotal_amount: economic.contract_value,
    discount_amount: '10.00',
    tax_amount: economic.calculation.totals.tax_amount,
    grand_total: economic.calculation.totals.total_amount,
    valid_until: null,
    notes: 'Condiciones pactadas en la revisión aceptada.',
    terms_and_conditions: `Condiciones completas de pago.${' Entrega por hitos.'.repeat(40)}`,
    accepted_at: '2026-10-10T12:00:00.000Z',
    quotation_items: [],
    contract_economic_snapshot: economic,
  };
  const snapshot = buildContractSnapshot(quote);
  const row = {
    id: 5,
    organization_id: 1,
    store_id: 2,
    quotation_id: quote.id,
    contract_number: 'CT-5',
    customer_id: 50,
    status: 'active',
    snapshot,
    notes: 'MUTABLE LIVE CONTRACT NOTES MUST NOT BE USED',
    ...overrides,
  };
  return { config, economic, quote, snapshot, row };
}

function serviceFixture(options: {
  contract?: any;
  freshContract?: any;
  duplicate?: any;
  customer?: any;
  historicalConfig?: any;
  profile?: any;
  profileContractObject?: string;
  failLineTaxPersist?: boolean;
} = {}) {
  const source = frozenContract({}, options.profileContractObject);
  const contract = options.contract ?? source.row;
  const freshContract = options.freshContract ?? contract;
  const sequence: string[] = [];
  let inTransaction = false;
  let createdInvoice: any;
  const customer = options.customer === undefined
    ? {
        id: 50,
        organization_id: 1,
        first_name: 'Obra',
        last_name: 'Norte',
        legal_name: 'Constructora Norte S.A.S.',
        document_type: '31',
        document_number: '900123456',
        fiscal_responsibilities: [],
      }
    : options.customer;

  const tx: any = {
    $queryRaw: jest.fn(async () => {
      sequence.push('contract-row-lock');
      return [];
    }),
    contracts: {
      findFirst: jest.fn(async () => freshContract),
      updateMany: jest.fn(),
    },
    invoices: {
      findFirst: jest.fn(async ({ where }: any) =>
        where?.id != null ? createdInvoice : options.duplicate ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        createdInvoice = {
          id: 200,
          ...data,
          invoice_items: data.invoice_items.create.map((item: any, index: number) => ({
            id: index + 1,
            ...item,
          })),
        };
        return createdInvoice;
      }),
    },
    invoice_items: {
      findMany: jest.fn(async () =>
        (createdInvoice?.invoice_items ?? []).map((item: any) => ({ id: item.id })),
      ),
    },
    invoice_taxes: {
      createMany: jest.fn(async ({ data }: any) => {
        if (!inTransaction) throw new Error('invoice tax write escaped transaction');
        if (options.failLineTaxPersist) throw new Error('tax write failed');
        sequence.push('line-taxes');
        return { count: data.length };
      }),
    },
  };
  const prisma: any = {
    contracts: { findFirst: jest.fn(async () => contract) },
    invoices: {
      findFirst: jest.fn(async () => options.duplicate ?? null),
      update: jest.fn(),
    },
    invoice_profiles: {
      findFirst: jest.fn(async () => options.profile ?? {
        id: 81,
        operation_type: '09',
        state: 'archived',
        current_version: 999,
      }),
    },
    invoice_profile_versions: {
      findFirst: jest.fn(async () => ({
        version: 4,
        config: options.historicalConfig ?? source.config,
      })),
    },
    invoice_resolutions: {
      findFirst: jest.fn(async () => ({
        id: 12,
        current_number: 1,
        range_to: 999,
      })),
    },
    users: { findFirst: jest.fn(async () => customer) },
    products: { findMany: jest.fn(async () => []) },
    product_variants: { findMany: jest.fn(async () => []) },
    store_settings: { findUnique: jest.fn(async () => { throw new Error('live AIU settings read'); }) },
    withoutScope: jest.fn(() => ({
      $transaction: async (callback: (client: any) => Promise<any>) => {
        inTransaction = true;
        try {
          return await callback(tx);
        } finally {
          inTransaction = false;
        }
      },
    })),
  };
  const generator = {
    generateNextNumber: jest.fn(async () => {
      sequence.push('number');
      return { invoice_number: 'FV-200', resolution_id: 12 };
    }),
  };
  const eventEmitter = { emit: jest.fn() };
  const service = new InvoicingService(
    prisma,
    generator as any,
    eventEmitter as any,
    { resolveAccountingEntityForFiscal: jest.fn(async () => ({ id: 77 })) } as any,
    {} as any,
    {} as any,
    { assertAreaActive: jest.fn(async () => undefined) } as any,
    {} as any,
    new InvoiceCalculatorService(),
    { resolveExchangeRate: jest.fn(async () => ({ rate: new Prisma.Decimal(4200) })) } as any,
    {} as any,
  );

  return { service, prisma, tx, generator, eventEmitter, source, sequence, customer };
}

describe('InvoicingService.createInvoiceFromContract (integración con motor real)', () => {
  it('crea borrador completo desde snapshot y persiste todos los impuestos de línea en la transacción', async () => {
    const fixture = serviceFixture();
    const result = await RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    );
    const createArgs = fixture.tx.invoices.create.mock.calls[0][0];
    const data = createArgs.data;

    expect(data).toMatchObject({
      contract_id: 5,
      status: 'draft',
      operation_type: '09',
      invoice_type: 'sales_invoice',
      invoice_number: 'FV-200',
      resolution_id: 12,
      profile_id: 81,
      profile_version: 4,
      customer_id: 50,
      currency: 'COP',
      foreign_currency: 'USD',
      exchange_rate: new Prisma.Decimal(4200),
      payment_form: '2',
      payment_means_code: '10',
      due_date: new Date('2099-12-31T00:00:00.000Z'),
      aiu_contract_object: 'Construcción de bodega industrial',
      notes: 'Nota congelada del perfil',
    });
    expect(data.invoice_items.create).toHaveLength(4);
    expect(data.invoice_items.create.map((line: any) => line.aiu_component ?? null)).toEqual([
      null,
      'administracion',
      'imprevistos',
      'utilidad',
    ]);
    expect(data.invoice_items.create[0]).toMatchObject({
      description: 'Costo directo de obra',
    });
    expect(new Prisma.Decimal(data.invoice_items.create[0].unit_price).equals('1000')).toBe(true);
    expect(new Prisma.Decimal(data.invoice_items.create[0].discount_amount).equals('10')).toBe(true);
    expect(new Prisma.Decimal(data.subtotal_amount).equals(
      fixture.source.economic.calculation.totals.total_before_tax,
    )).toBe(true);
    expect(new Prisma.Decimal(data.tax_amount).equals(
      fixture.source.economic.calculation.totals.tax_amount,
    )).toBe(true);
    expect(new Prisma.Decimal(data.total_amount).equals(
      fixture.source.economic.calculation.totals.total_amount,
    )).toBe(true);
    expect(new Prisma.Decimal(data.foreign_total_amount).equals(
      new Prisma.Decimal(fixture.source.economic.calculation.totals.total_amount)
        .dividedBy(4200)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN),
    )).toBe(true);
    expect(data.invoice_taxes).toBeUndefined();
    expect(fixture.tx.invoice_taxes.createMany).toHaveBeenCalled();
    expect(fixture.tx.invoice_items.findMany).toHaveBeenCalled();
    expect(fixture.sequence.indexOf('contract-row-lock')).toBeLessThan(
      fixture.sequence.indexOf('number'),
    );
    expect(fixture.sequence.indexOf('line-taxes')).toBeGreaterThan(
      fixture.sequence.indexOf('number'),
    );
    expect(fixture.tx.contracts.updateMany).not.toHaveBeenCalled();
    expect(fixture.prisma.invoice_profiles.findFirst).toHaveBeenCalledWith({
      where: { id: 81 },
      select: { id: true, operation_type: true },
    });
    expect(fixture.prisma.invoice_profile_versions.findFirst).toHaveBeenCalledWith({
      where: { profile_id: 81, version: 4 },
      select: { version: true, config: true },
    });
    expect(fixture.prisma.products.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.product_variants.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.store_settings.findUnique).not.toHaveBeenCalled();
    expect(result.contract_id).toBe(5);
    expect(result.status).toBe('draft');
  });

  it('acepta objeto explícito de cotización aunque el default del perfil congelado esté vacío', async () => {
    const fixture = serviceFixture({ profileContractObject: '' });
    const result = await RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    );
    const data = fixture.tx.invoices.create.mock.calls[0][0].data;

    expect(fixture.source.economic.invoice_profile.config.aiu?.contract_object).toBe('');
    expect(data.aiu_contract_object).toBe('Construcción de bodega industrial');
    expect(result.contract_id).toBe(5);
    expect(fixture.generator.generateNextNumber).toHaveBeenCalledTimes(1);
  });

  it('rechaza una versión histórica distinta sin leer el perfil vigente ni numerar', async () => {
    const fixture = serviceFixture({
      historicalConfig: { ...frozenContract().config, aiu: { regime: 'decreto_1372_1992' } },
    });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('idempotencia duplicate corta antes de transacción y consecutivo', async () => {
    const fixture = serviceFixture({ duplicate: { id: 199, invoice_number: 'FV-199' } });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'CONTRACT_INVOICE_001' });
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
    expect(fixture.prisma.withoutScope).not.toHaveBeenCalled();
  });

  it('snapshot legacy bloquea emisión antes de numerar', async () => {
    const source = frozenContract();
    const fixture = serviceFixture({ contract: { ...source.row, snapshot: {} } });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('cliente ajeno o ausente bloquea emisión antes de numerar', async () => {
    const fixture = serviceFixture({ customer: null });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'CUST_FIND_001' });
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('discrepancia entre snapshot y recálculo no consume número', async () => {
    const source = frozenContract();
    const changed = { ...source.snapshot, economic: { ...(source.snapshot as any).economic } };
    changed.economic.calculation = {
      ...changed.economic.calculation,
      totals: { ...changed.economic.calculation.totals, total_amount: '0.00' },
    };
    const fixture = serviceFixture({ contract: { ...source.row, snapshot: changed } });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('estado cancelado al tomar lock gana la carrera y no consume número', async () => {
    const source = frozenContract();
    const fixture = serviceFixture({
      freshContract: { ...source.row, status: 'cancelled' },
    });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'CONTRACT_STATUS_001' });
    expect(fixture.sequence).toContain('contract-row-lock');
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('cambio concurrente del snapshot económico al tomar lock no consume número', async () => {
    const source = frozenContract();
    const freshSnapshot = JSON.parse(JSON.stringify(source.snapshot));
    freshSnapshot.economic.direct_cost = '999999.00';
    const fixture = serviceFixture({
      freshContract: { ...source.row, snapshot: freshSnapshot },
    });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      fixture.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(fixture.sequence).toContain('contract-row-lock');
    expect(fixture.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('sin contexto tenant o sin cliente scopeado no genera consecutivo', async () => {
    const missingTenant = serviceFixture();
    await expect(RequestContextService.runIsolated(
      { is_super_admin: false, is_owner: false },
      () => missingTenant.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'AUTH_CONTEXT_001' });
    expect(missingTenant.generator.generateNextNumber).not.toHaveBeenCalled();

    const foreignCustomer = serviceFixture({ customer: null });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      foreignCustomer.service.createInvoiceFromContract(5),
    )).rejects.toMatchObject({ errorCode: 'CUST_FIND_001' });
    expect(foreignCustomer.generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('rechaza cambios económicos en factura contractual y conserva PATCH normal', async () => {
    const contractInvoice = serviceFixture();
    contractInvoice.prisma.invoices.findFirst.mockResolvedValue({
      id: 200,
      contract_id: 5,
      status: 'draft',
      invoice_items: [],
    });
    await expect(RequestContextService.runIsolated(CONTEXT, () =>
      contractInvoice.service.update(200, { items: [] } as any),
    )).rejects.toMatchObject({ errorCode: 'INVOICING_CALC_001' });
    expect(contractInvoice.prisma.invoices.update).not.toHaveBeenCalled();

    const normalInvoice = serviceFixture();
    normalInvoice.prisma.fiscal_close_sessions = {
      findFirst: jest.fn(async () => null),
    };
    normalInvoice.prisma.invoices.findFirst.mockResolvedValue({
      id: 201,
      contract_id: null,
      financial_account_id: null,
      status: 'draft',
      invoice_type: 'sales_invoice',
      invoice_items: [],
      invoice_taxes: [],
      issue_date: new Date('2026-10-10T00:00:00.000Z'),
      accounting_entity_id: 77,
    });
    normalInvoice.prisma.invoices.update.mockImplementation(async ({ data }: any) => ({
      id: 201,
      contract_id: null,
      status: 'draft',
      ...data,
    }));
    const updated = await RequestContextService.runIsolated(CONTEXT, () =>
      normalInvoice.service.update(201, { notes: 'normal invoice edit' } as any),
    );
    expect(normalInvoice.prisma.invoices.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notes: 'normal invoice edit' }) }),
    );
    expect(updated.notes).toBe('normal invoice edit');
  });
});
