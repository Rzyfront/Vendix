import { buildDefaultAiuProfileConfig } from '../invoicing/profiles/invoice-profile-config.contract';
import { buildQuotationContractEconomicSnapshot } from './quotation-contract-economics';
import { buildQuotationContractPresentation } from './quotation-contract-presentation';

describe('buildQuotationContractPresentation', () => {
  const quoteSnapshot = (accountingModel: 'sumada' | 'no_sumada' = 'no_sumada') => {
    const config = buildDefaultAiuProfileConfig('Obra & adecuación <local>');
    config.aiu!.accounting_model = accountingModel;
    const economic = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T12:00:00.000Z',
      invoice_profile: {
        profile_id: 81,
        version: 7,
        name: 'Perfil AIU & Construcción',
        config,
      },
      quotation_profile: null,
      contract_object: 'Obra & adecuación <local>',
      due_date: '2026-12-31',
      cost_lines: [
        {
          description: 'Costo <principal>',
          quantity: '1',
          unit_price: '100.00',
          discount_amount: '10.00',
          unit_code: '94',
        },
      ],
    });
    return economic;
  };

  it('presenta snapshot no_sumada como una línea contractual y conserva costo fuente aparte', () => {
    const economic = quoteSnapshot();
    const result = buildQuotationContractPresentation(economic, {
      notes: 'Nota acordada & completa',
      terms_and_conditions: `${'Condición <fija> & válida. '.repeat(30)}`,
      quotation_items: [
        {
          product_name: 'Costo <principal>',
          quantity: 1,
          unit_price: '100.00',
          discount_amount: '10.00',
          total_price: '90.00',
        },
      ],
    });

    expect(result).toMatchObject({
      accounting_model: 'no_sumada',
      contract_object: 'Obra & adecuación <local>',
      invoice_profile_name: 'Perfil AIU & Construcción',
      invoice_profile_version: 7,
      due_date: '2026-12-31',
      agreed_notes: 'Nota acordada & completa',
      source_cost_details: [{
        description: 'Costo <principal>',
        unit_price: 100,
        discount_amount: 10,
        net_base: 90,
      }],
      lines: [{ bucket: 'contrato', aiu_component: 'contrato' }],
    });
    expect(result!.lines).toHaveLength(1);
    expect(result!.lines[0].net_base).toBe(
      Number(economic.calculation.lines[0].line_extension_amount),
    );
    expect(result!.terms_and_conditions).toHaveLength(30 * 'Condición <fija> & válida. '.length);
    expect(result!.tax_summary[0]).toMatchObject({ dian_tax_code: '01', tax_rate: 19 });
    expect(result!.grand_total).toBe(Number(economic.calculation.totals.total_amount));
    expect(result!.grand_total_formatted).toContain(',');
  });

  it('uses canonical lines and header taxes for sumada, preserving discounts and tax classification', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.accounting_model = 'sumada';
    config.taxes.rules = config.taxes.rules.map((rule) =>
      rule.bucket === 'utilidad'
        ? { ...rule, tax_code: '04', rate: '8.00' }
        : rule,
    );
    const economic = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T12:00:00.000Z',
      invoice_profile: { profile_id: 4, version: 2, name: 'AIU', config },
      quotation_profile: null,
      contract_object: 'Obra',
      cost_lines: [{ description: 'Trabajo', quantity: '1', unit_price: '100.00', discount_amount: '10.00' }],
    });
    const result = buildQuotationContractPresentation(economic, { quotation_items: [] });

    expect(result!.lines).toHaveLength(4);
    expect(result!.lines[0]).toMatchObject({
      bucket: 'costo',
      unit_price: 100,
      discount_amount: 10,
    });
    expect(result!.tax_summary.map((tax) => tax.dian_tax_code)).toEqual(['01', '04']);
    expect(result!.lines.find((line) => line.bucket === 'utilidad')?.taxes[0]).toMatchObject({
      dian_tax_code: '04',
      tax_type: 'inc',
      tax_rate: 8,
    });
  });

  it('returns null only for legacy absence and rejects malformed frozen economics', () => {
    expect(buildQuotationContractPresentation(null)).toBeNull();
    expect(() => buildQuotationContractPresentation({ schema_version: 2 })).toThrow(
      /schema_version/,
    );
    const malformed = quoteSnapshot() as any;
    malformed.calculation.totals.total_amount = null;
    expect(() => buildQuotationContractPresentation(malformed)).toThrow(
      /calculation.totals.total_amount/,
    );
  });
});
