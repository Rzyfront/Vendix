import { buildDefaultAiuProfileConfig } from '../../invoicing/profiles/invoice-profile-config.contract';
import { buildQuotationContractEconomicSnapshot } from '../../quotations/quotation-contract-economics';
import { QuotationDataProvider } from './quotation.provider';

describe('QuotationDataProvider · frozen contract presentation', () => {
  const economic = () => {
    const config = buildDefaultAiuProfileConfig('Obra contractual');
    config.aiu!.accounting_model = 'no_sumada';
    return buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T12:00:00.000Z',
      invoice_profile: {
        profile_id: 81,
        version: 5,
        name: 'Perfil AIU congelado',
        config,
      },
      quotation_profile: null,
      contract_object: 'Obra contractual & adecuación',
      due_date: '2026-12-31',
      cost_lines: [{
        description: 'Costo directo',
        quantity: '1',
        unit_price: '100.00',
        discount_amount: '10.00',
      }],
    });
  };

  const quotationRow = (economicSnapshot: any = economic()) => ({
    id: 41,
    quotation_number: 'QT-CONTRACT-41',
    destination: 'contract',
    status: 'accepted',
    channel: 'store',
    subtotal_amount: '100.00',
    discount_amount: '0.00',
    tax_amount: '999.99',
    shipping_cost: '80.00',
    grand_total: '1079.99',
    valid_until: null,
    created_at: new Date('2026-10-10T12:00:00.000Z'),
    contract_economic_snapshot: economicSnapshot,
    notes: 'Condición acordada completa.',
    internal_notes: 'No imprimir interna.',
    terms_and_conditions: `${'Términos largos congelados. '.repeat(40)}`,
    customer: {
      id: 9,
      first_name: 'Cliente',
      last_name: 'Contractual',
      legal_name: null,
      document_number: null,
      phone: null,
      email: 'cliente@example.com',
      addresses: [],
    },
    store: {
      name: 'Tienda demo',
      legal_name: 'Tienda S.A.S.',
      phone: null,
      email: null,
      logo_url: null,
      addresses: [],
      store_settings: { settings: {} },
      organizations: {
        tax_id: '900000000',
        legal_name: 'Tienda S.A.S.',
        organization_settings: { settings: {} },
      },
    },
    // Legacy product values intentionally disagree with frozen contract totals.
    quotation_items: [{
      id: 1,
      product_name: 'Costo directo',
      quantity: 1,
      unit_price: '100.00',
      discount_amount: '10.00',
      total_price: '90.00',
      tax_rate: '0.19000',
      tax_amount_item: '999.99',
    }],
  });

  const providerWith = (row: any) => {
    const calls: any[] = [];
    const prisma: any = {
      quotations: {
        findFirst: jest.fn(async (args: any) => {
          calls.push(args);
          return row;
        }),
      },
    };
    return { provider: new QuotationDataProvider(prisma), calls };
  };

  it('uses frozen line, taxes, gross/discount/net totals and keeps original costs separate', async () => {
    const frozen = economic();
    const { provider, calls } = providerWith(quotationRow(frozen));
    const data = await provider.fetchDocumentData(2, 41);

    expect(calls[0].where).toEqual({ id: 41, store_id: 2 });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      product_name: frozen.invoice_lines[0].description,
      tax_name: expect.stringContaining('DIAN 01'),
      tax_rate: 19,
      total_price: Number(frozen.calculation.lines[0].line_extension_amount),
    });
    expect(data.items[0].discount_amount).toBe(0);
    expect(data.taxes[0]).toMatchObject({
      name: expect.stringContaining('DIAN 01'),
      rate: 19,
      tax_amount: Number(frozen.calculation.header_taxes[0].tax_amount),
    });
    expect(data.taxes[0].tax_amount).not.toBe(999.99);
    expect(data.totals.subtotal).toBe(Number(frozen.calculation.totals.gross_subtotal));
    expect(data.totals.discount_total).toBe(Number(frozen.calculation.totals.discount_amount));
    expect(data.totals.tax_total).toBe(Number(frozen.calculation.totals.tax_amount));
    expect(data.totals.grand_total).toBe(Number(frozen.calculation.totals.total_amount));
    expect(data.totals.shipping_total).toBe(0);
    expect(data.document.notes).toContain('Objeto contractual: Obra contractual & adecuación');
    expect(data.document.notes).toContain('Perfil AIU congelado · versión 5');
    expect(data.document.notes).toContain('31/12/2026');
    expect(data.document.notes).toContain('Costo directo');
    expect(data.document.terms_and_conditions).toHaveLength(40 * 'Términos largos congelados. '.length);
    expect(data.document.notes).not.toContain('No imprimir interna');
    expect((data.custom_variables as any).contract_presentation.accounting_model).toBe('no_sumada');
  });

  it('keeps sale quotation mapping unchanged and warns for legacy contract snapshot', async () => {
    const legacy = quotationRow(null);
    const { provider } = providerWith({ ...legacy, destination: 'contract' });
    const oldData = await provider.fetchDocumentData(2, 41);
    expect(oldData.items[0].product_name).toBe('Costo directo');
    expect(oldData.taxes[0].tax_amount).toBe(999.99);
    expect(oldData.document.notes).toContain('sin economía congelada');

    const { provider: salesProvider } = providerWith({ ...legacy, destination: 'sale' });
    const sales = await salesProvider.fetchDocumentData(2, 41);
    expect(sales.items[0].product_name).toBe('Costo directo');
    expect(sales.items[0].total_price).toBe(90);
    expect(sales.taxes[0].name).toBe('Impuesto');
    expect(sales.document.notes).toBe('Condición acordada completa.');
  });
});
