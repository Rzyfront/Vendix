import { RequestContextService } from '@common/context/request-context.service';
import { ProfilesService } from '../invoicing/profiles/profiles.service';
import {
  buildDefaultAiuProfileConfig,
  InvoiceProfileConfig,
} from '../invoicing/profiles/invoice-profile-config.contract';
import { QuotationsService } from './quotations.service';
import { buildQuotationContractEconomicSnapshot } from './quotation-contract-economics';

function config(): InvoiceProfileConfig {
  const config = buildDefaultAiuProfileConfig('Servicio de construcción');
  return {
    ...config,
    aiu: {
      ...config.aiu!,
      components: {
        administracion: '10.00',
        imprevistos: '5.00',
        utilidad: '10.00',
      },
    },
    taxes: {
      ...config.taxes,
      rules: config.taxes.rules.map((rule) =>
        rule.bucket === 'costo'
          ? rule
          : { ...rule, rate: '19.00', taxable: true },
      ),
    },
  };
}

const context = {
  user_id: 9,
  organization_id: 1,
  store_id: 2,
  is_super_admin: false,
  is_owner: true,
};

const costItems = [
  {
    product_name: 'Materiales',
    quantity: 2,
    unit_price: 100.005,
    discount_amount: 0.02,
    total_price: 0,
  },
];

function invoiceProfile(version = 3, overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    name: 'Contrato AIU',
    state: 'active',
    operation_type: '09',
    current_version: version,
    version: { version, config: config() },
    ...overrides,
  };
}

function buildService() {
  const tx = {
    quotations: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 12, ...data }),
      ),
    },
    quotation_items: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    quotations: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 12, ...data }),
      ),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    contracts: { findMany: jest.fn().mockResolvedValue([]) },
    products: { findMany: jest.fn().mockResolvedValue([]) },
    product_variants: { findMany: jest.fn().mockResolvedValue([]) },
    users: { findFirst: jest.fn().mockResolvedValue({ id: 55 }) },
  };
  const quotationProfiles = { resolveForQuotation: jest.fn() };
  const currentInvoiceProfile = { value: invoiceProfile() };
  const invoiceProfiles = {
    findOne: jest.fn(() => Promise.resolve(currentInvoiceProfile.value)),
  };
  const service = new QuotationsService(
    prisma as any,
    {} as any,
    { emit: jest.fn() } as any,
    {} as any,
    quotationProfiles as any,
    undefined,
    invoiceProfiles as unknown as ProfilesService,
  );
  return {
    service,
    prisma,
    tx,
    quotationProfiles,
    invoiceProfiles,
    currentInvoiceProfile,
  };
}

describe('QuotationsService contract economics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('freezes the selected AIU version independently from the quote terms profile', async () => {
    const test = buildService();
    test.quotationProfiles.resolveForQuotation.mockResolvedValue({
      id: 7,
      current_version: 4,
      current_config: { payment_terms: 'Pago 30 días', notes: 'Contrato marco' },
      version: {
        version: 4,
        config: { payment_terms: 'Pago 30 días', notes: 'Contrato marco' },
      },
    });

    const result: any = await RequestContextService.run(context, () =>
      test.service.create({
        destination: 'contract' as any,
        customer_id: 55,
        profile_id: 7,
        invoice_profile_id: 8,
        contract_object: 'Obra civil',
        items: costItems as any,
      } as any),
    );

    expect(result.profile_id).toBe(7);
    expect(result.contract_economic_snapshot).toMatchObject({
      schema_version: 1,
      invoice_profile: { profile_id: 8, version: 3, name: 'Contrato AIU' },
      quotation_profile: { profile_id: 7, version: 4 },
      contract_object: 'Obra civil',
      due_date: null,
      direct_cost: '200.00',
      contract_value: '266.66',
    });
    expect(result.quotation_items.create[0]).toMatchObject({
      unit_price: '100.01',
      discount_amount: '0.02',
      total_price: '200.00',
      tax_rate: null,
      tax_amount_item: null,
    });
  });

  it('previews an explicit 100% no_sumada contract value with a zero-cost line', async () => {
    const test = buildService();
    const current = test.currentInvoiceProfile.value;
    const frozenConfig = config();
    frozenConfig.aiu!.accounting_model = 'no_sumada';
    frozenConfig.aiu!.components = {
      administracion: '40.00',
      imprevistos: '30.00',
      utilidad: '30.00',
    };
    current.version.config = frozenConfig;

    const preview: any = await RequestContextService.run(context, () =>
      test.service.previewContractEconomics({
        invoice_profile_id: 8,
        contract_object: 'Objeto pactado',
        aiu_value: 100,
        items: [{ product_name: 'AIU acordado', quantity: 1, unit_price: 0, total_price: 0 }],
      } as any),
    );

    expect(preview).toMatchObject({ direct_cost: '0.00', contract_value: '100.00', aiu_value: '100.00' });
  });

  it('reuses the frozen AIU input for a fractional 100% no_sumada profile with zero costs', async () => {
    const test = buildService();
    const fractionalConfig = config();
    fractionalConfig.aiu!.accounting_model = 'no_sumada';
    fractionalConfig.aiu!.components = {
      administracion: '18.10',
      imprevistos: '46.20',
      utilidad: '35.70',
    };
    const frozen = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-01T00:00:00.000Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'AIU cien por ciento', config: fractionalConfig },
      quotation_profile: null,
      contract_object: 'Objeto del contrato acordado.',
      aiu_value: '100.00',
      cost_lines: [{ description: 'AIU acordado', quantity: 1, unit_price: 0 }],
    });
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      profile_id: null,
      contract_economic_snapshot: frozen,
      quotation_items: [{ product_name: 'AIU acordado', quantity: 1, unit_price: 0, discount_amount: 0, total_price: 0 }],
    });

    const preview = await RequestContextService.run(context, () =>
      test.service.previewContractEconomics({ quotation_id: 12 }),
    );

    expect(preview.aiu_value).toBe('100.00');
    expect(preview.contract_value).toBe('100.00');
  });

  it('does not refresh the frozen profile on a notes-only edit after the live profile changes', async () => {
    const test = buildService();
    const frozen = {
      schema_version: 1,
      frozen_at: '2026-10-01T00:00:00.000Z',
      invoice_profile: {
        profile_id: 8,
        version: 3,
        name: 'Contrato AIU',
        config: config(),
      },
      quotation_profile: null,
      contract_object: 'Obra civil',
      due_date: null,
      aiu_value: '66.66',
      direct_cost: '199.99',
      contract_value: '266.65',
      invoice_lines: [],
      calculation: {
        totals: {
          gross_subtotal: '266.65',
          discount_amount: '0.02',
          tax_amount: '12.67',
          total_amount: '279.30',
        },
      },
    };
    test.currentInvoiceProfile.value = invoiceProfile(4, {
      name: 'Perfil editado',
      version: { version: 4, config: config() },
    });
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      profile_id: null,
      contract_economic_snapshot: frozen,
      quotation_items: [
        {
          product_name: 'Materiales',
          quantity: 2,
          unit_price: 100.005,
          discount_amount: 0.02,
          total_price: 199.99,
        },
      ],
    });

    const result: any = await RequestContextService.run(context, () =>
      test.service.update(12, { notes: 'Nota editada' } as any),
    );

    expect(result.contract_economic_snapshot).toBeUndefined();
    expect(test.invoiceProfiles.findOne).not.toHaveBeenCalled();
    expect(test.tx.quotations.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        store_id: 2,
        status: 'draft',
        updated_at: expect.any(Date),
        store: { is: { organization_id: 1 } },
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(test.tx.quotation_items.deleteMany).not.toHaveBeenCalled();
    expect(test.tx.quotations.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ contract_economic_snapshot: expect.anything() }) }),
    );
  });

  it('clears an agreed due date on preview and draft update, and blocks credit send until one is set again', async () => {
    const test = buildService();
    const creditConfig = config();
    creditConfig.dian.payment_method_code = '2';
    const frozen = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-01T00:00:00.000Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'Crédito AIU', config: creditConfig },
      quotation_profile: null,
      contract_object: 'Servicio de construcción con objeto acordado.',
      due_date: '2027-10-10',
      cost_lines: [{ description: 'Materiales', quantity: 2, unit_price: 100, discount_amount: 0 }],
    });
    const quotation: any = {
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      profile_id: null,
      contract_economic_snapshot: frozen,
      quotation_items: [{ product_name: 'Materiales', quantity: 2, unit_price: 100, discount_amount: 0, total_price: 200 }],
    };
    test.prisma.quotations.findFirst.mockResolvedValue(quotation);

    const preview = await RequestContextService.run(context, () =>
      test.service.previewContractEconomics({ quotation_id: 12, due_date: null }),
    );
    expect(preview.due_date).toBeNull();

    await RequestContextService.run(context, () =>
      test.service.update(12, { due_date: null } as any),
    );
    const updateData = test.tx.quotations.update.mock.calls[0][0].data;
    expect(updateData.contract_economic_snapshot.due_date).toBeNull();

    quotation.contract_economic_snapshot = updateData.contract_economic_snapshot;
    await expect(RequestContextService.run(context, () => test.service.send(12)))
      .rejects.toThrow(/fecha de vencimiento acordada/);
  });

  it('recalculates changed cost lines with the frozen contract-basis profile without treating AIU output as input', async () => {
    const test = buildService();
    const frozen = {
      schema_version: 1,
      frozen_at: '2026-10-01T00:00:00.000Z',
      invoice_profile: {
        profile_id: 8,
        version: 3,
        name: 'Contrato AIU',
        config: config(),
      },
      quotation_profile: null,
      contract_object: 'Obra civil',
      due_date: null,
      aiu_value: '50.00',
      direct_cost: '150.00',
      contract_value: '200.00',
      invoice_lines: [],
      calculation: { totals: {} },
    };
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      profile_id: null,
      contract_economic_snapshot: frozen,
      quotation_items: costItems,
    });

    await RequestContextService.run(context, () =>
      test.service.update(12, { items: costItems as any } as any),
    );

    expect(test.invoiceProfiles.findOne).not.toHaveBeenCalled();
    const updateCall = test.tx.quotations.update.mock.calls[0][0];
    expect(updateCall.data.contract_economic_snapshot.aiu_value).toBe('66.66');
    expect(updateCall.data.contract_economic_snapshot.contract_value).toBe('266.66');
    expect(updateCall.data.contract_economic_snapshot.invoice_profile).toMatchObject({
      profile_id: 8,
      version: 3,
    });
  });

  it('recalculates only after explicit profile selection and uses the new immutable version', async () => {
    const test = buildService();
    const quotation: any = {
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      profile_id: null,
      contract_economic_snapshot: {
        schema_version: 1,
        frozen_at: '2026-10-01T00:00:00.000Z',
        invoice_profile: {
          profile_id: 8,
          version: 3,
          name: 'Contrato AIU',
          config: config(),
        },
        quotation_profile: null,
        contract_object: 'Obra civil',
        due_date: null,
        aiu_value: '66.66',
        direct_cost: '199.99',
        contract_value: '266.65',
        invoice_lines: [],
        calculation: { totals: {} },
      },
      quotation_items: costItems,
    };
    test.prisma.quotations.findFirst.mockResolvedValue(quotation);
    test.currentInvoiceProfile.value = invoiceProfile(4, {
      name: 'Perfil versión 4',
    });

    await RequestContextService.run(context, () =>
      test.service.update(12, { invoice_profile_id: 8 } as any),
    );

    expect(test.invoiceProfiles.findOne).toHaveBeenCalledWith(8);
    const updateCall = test.tx.quotations.update.mock.calls[0][0];
    expect(updateCall.data.contract_economic_snapshot.invoice_profile).toMatchObject({
      profile_id: 8,
      version: 4,
      name: 'Perfil versión 4',
    });
  });

  it('requires an explicit profile on new contract economics and rejects foreign/inactive profiles', async () => {
    const noProfile = buildService();
    const missing = await RequestContextService.run(context, () =>
      noProfile.service.create({
        destination: 'contract' as any,
        customer_id: 55,
        items: costItems as any,
      } as any).catch((error) => error),
    );
    expect(missing.message).toContain('Selecciona un perfil');
    expect(noProfile.prisma.quotations.create).not.toHaveBeenCalled();

    const foreign = buildService();
    foreign.invoiceProfiles.findOne.mockRejectedValue(new Error('scoped 404'));
    await expect(
      RequestContextService.run(context, () =>
        foreign.service.create({
          destination: 'contract' as any,
          customer_id: 55,
          invoice_profile_id: 99,
          items: costItems as any,
        } as any),
      ),
    ).rejects.toThrow('scoped 404');

    const inactive = buildService();
    inactive.currentInvoiceProfile.value = invoiceProfile(3, { state: 'inactive' });
    await expect(
      RequestContextService.run(context, () =>
        inactive.service.create({
          destination: 'contract' as any,
          customer_id: 55,
          invoice_profile_id: 8,
          items: costItems as any,
        } as any),
      ),
    ).rejects.toMatchObject({ errorCode: expect.any(String) });
  });

  it('rejects a buyer outside this organization/store before creating contract economics', async () => {
    const test = buildService();
    test.prisma.users.findFirst.mockResolvedValue(null);

    await expect(
      RequestContextService.run(context, () =>
        test.service.create({
          destination: 'contract' as any,
          customer_id: 999,
          invoice_profile_id: 8,
          items: costItems as any,
        } as any),
      ),
    ).rejects.toMatchObject({ errorCode: expect.any(String) });
    expect(test.prisma.quotations.create).not.toHaveBeenCalled();
  });

  it('previews the same canonical economics without creating or numbering a quotation', async () => {
    const test = buildService();
    const result = await RequestContextService.run(context, () =>
      test.service.previewContractEconomics({
        invoice_profile_id: 8,
        items: costItems as any,
      }),
    );

    expect(result.contract_value).toBe('266.66');
    expect(result.calculation.totals.total_amount).toBeDefined();
    expect(test.prisma.quotations.findFirst).not.toHaveBeenCalled();
    expect(test.prisma.quotations.create).not.toHaveBeenCalled();
  });

  it('requires an explicit invoice profile to recover a historical draft without a snapshot', async () => {
    const test = buildService();
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      contract_economic_snapshot: null,
      quotation_items: costItems,
    });
    await expect(
      RequestContextService.run(context, () =>
        test.service.update(12, { notes: 'Solo texto' } as any),
      ),
    ).rejects.toThrow('no tiene economía congelada');
    expect(test.tx.quotations.updateMany).not.toHaveBeenCalled();
  });

  it('refuses the update if the quote stopped being a draft before the transactional CAS', async () => {
    const test = buildService();
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      store_id: 2,
      customer_id: 55,
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      contract_economic_snapshot: {
        schema_version: 1,
        frozen_at: '2026-10-01T00:00:00.000Z',
        invoice_profile: {
          profile_id: 8,
          version: 3,
          name: 'Contrato AIU',
          config: config(),
        },
        quotation_profile: null,
        contract_object: 'Obra civil',
        due_date: null,
        aiu_value: '66.66',
        direct_cost: '199.99',
        contract_value: '266.65',
        invoice_lines: [],
        calculation: { totals: {} },
      },
      quotation_items: costItems,
    });
    test.tx.quotations.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      RequestContextService.run(context, () =>
        test.service.update(12, { items: costItems as any } as any),
      ),
    ).rejects.toThrow('dejó de ser un borrador');
    expect(test.tx.quotation_items.deleteMany).not.toHaveBeenCalled();
    expect(test.tx.quotations.update).not.toHaveBeenCalled();
  });

  it('does not send a contract quote before its economics and DIAN note are complete', async () => {
    const test = buildService();
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      contract_economic_snapshot: null,
      quotation_items: [],
    });

    await expect(
      RequestContextService.run(context, () => test.service.send(12)),
    ).rejects.toThrow('falta la economía AIU congelada');
    expect(test.prisma.quotations.update).not.toHaveBeenCalled();
  });

  it('requires an agreed due date before sending a credit-term contract quote', async () => {
    const test = buildService();
    const snapshot = {
      schema_version: 1,
      frozen_at: '2026-10-01T00:00:00.000Z',
      invoice_profile: {
        profile_id: 8,
        version: 3,
        name: 'Contrato AIU',
        config: {
          ...config(),
          dian: { document_type: 'sales_invoice', payment_method_code: '2' },
        },
      },
      quotation_profile: null,
      contract_object: 'Obra civil',
      due_date: null,
      aiu_value: '66.66',
      direct_cost: '200.00',
      contract_value: '266.66',
      invoice_lines: [],
      calculation: { totals: {} },
    };
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      updated_at: new Date('2026-10-01T00:00:00.000Z'),
      contract_economic_snapshot: snapshot,
      quotation_items: [],
    });

    await expect(
      RequestContextService.run(context, () => test.service.send(12)),
    ).rejects.toThrow('sin una fecha de vencimiento acordada');
    expect(test.prisma.quotations.updateMany).not.toHaveBeenCalled();
  });

  it('compares the quoted revision when sending a contract to prevent racing a draft edit', async () => {
    const test = buildService();
    const updated_at = new Date('2026-10-01T00:00:00.000Z');
    test.prisma.quotations.findFirst.mockResolvedValue({
      id: 12,
      destination: 'contract',
      status: 'draft',
      updated_at,
      contract_economic_snapshot: {
        schema_version: 1,
        frozen_at: updated_at.toISOString(),
        invoice_profile: {
          profile_id: 8,
          version: 3,
          name: 'Contrato AIU',
          config: config(),
        },
        quotation_profile: null,
        contract_object: 'Obra civil',
        due_date: null,
        aiu_value: '66.66',
        direct_cost: '200.00',
        contract_value: '266.66',
        invoice_lines: [],
        calculation: { totals: {} },
      },
      quotation_items: [],
    });
    test.prisma.quotations.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      RequestContextService.run(context, () => test.service.send(12)),
    ).rejects.toThrow('cambió mientras se validaba');
    expect(test.prisma.quotations.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        status: 'draft',
        updated_at,
        store_id: 2,
        store: { is: { organization_id: 1 } },
      },
      data: expect.objectContaining({ status: 'sent' }),
    });
  });

  it('rejects contract-only fields on a sale quote before allocation or persistence', async () => {
    const test = buildService();
    await expect(
      RequestContextService.run(context, () =>
        test.service.create({
          destination: 'sale' as any,
          invoice_profile_id: 8,
          items: costItems as any,
        } as any),
      ),
    ).rejects.toThrow('sólo se admiten en cotizaciones con destino contrato');
    expect(test.prisma.quotations.findFirst).not.toHaveBeenCalled();
    expect(test.prisma.quotations.create).not.toHaveBeenCalled();
  });
});
