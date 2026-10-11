import {
  buildDefaultAiuProfileConfig,
  InvoiceProfileConfig,
} from '../invoicing/profiles/invoice-profile-config.contract';
import { buildQuotationContractEconomicSnapshot } from './quotation-contract-economics';

function profileConfig(): InvoiceProfileConfig {
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

describe('quotation-contract-economics', () => {
  it('builds a frozen snapshot through the real invoice-profile engine and rounds line discounts', () => {
    const snapshot = buildQuotationContractEconomicSnapshot({
      frozen_at: '2026-10-10T00:00:00.000Z',
      invoice_profile: {
        profile_id: 8,
        version: 3,
        name: 'Contrato AIU',
        config: profileConfig(),
      },
      quotation_profile: null,
      contract_object: ' Obra contratada ',
      cost_lines: [
        {
          description: 'Materiales',
          quantity: 2,
          unit_price: '100.005',
          discount_amount: '0.02',
        },
      ],
    });

    expect(snapshot).toMatchObject({
      schema_version: 1,
      frozen_at: '2026-10-10T00:00:00.000Z',
      invoice_profile: { profile_id: 8, version: 3, name: 'Contrato AIU' },
      contract_object: 'Obra contratada',
      direct_cost: '199.99',
    });
    expect(snapshot.contract_value).toBe('266.65');
    expect(snapshot.aiu_value).toBe('66.66');
    expect(snapshot.invoice_lines.length).toBeGreaterThan(1);
    expect(snapshot.calculation.aiu?.contract_value).toBe(
      snapshot.contract_value,
    );
    expect(snapshot.invoice_profile.config).toEqual(profileConfig());
  });
});
