import { buildDefaultAiuProfileConfig } from './invoice-profile-config.contract';
import {
  calculateProfileContractEconomics,
  ProfileContractCostLine,
} from './profile-contract-economics';

const costs: ProfileContractCostLine[] = [
  {
    description: 'Mano de obra',
    quantity: '1',
    unit_price: '900.00',
    discount_amount: '0.00',
    unit_code: '94',
  },
];
const roundTripCosts: ProfileContractCostLine[] = [
  { description: 'Costo directo', quantity: '1', unit_price: '100.00' },
];

describe('calculateProfileContractEconomics', () => {
  it('derives contract-based percentages from direct cost and uses the canonical calculator', () => {
    const config = buildDefaultAiuProfileConfig('Obra');

    const result = calculateProfileContractEconomics(config, costs);

    expect(result.direct_cost).toBe('900.00');
    expect(result.contract_value).toBe('1000.00');
    expect(result.aiu_value).toBe('100.00');
    expect(result.invoice_lines).toHaveLength(4);
    expect(result.calculation.aiu?.contract_value).toBe('1000.00');
    expect(result.calculation.aiu?.aiu_value).toBe('100.00');
  });

  it('requires an explicit AIU value when component percentages are based on AIU', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.components_basis = 'aiu';
    config.aiu!.components = {
      administracion: '50.00',
      imprevistos: '20.00',
      utilidad: '30.00',
    };

    expect(() => calculateProfileContractEconomics(config, costs)).toThrow(
      /indica explícitamente el valor AIU acordado/,
    );

    const result = calculateProfileContractEconomics(config, costs, '100.00');
    expect(result.contract_value).toBe('1000.00');
    expect(result.aiu_value).toBe('100.00');
  });

  it('represents no_sumada with one contract line and keeps AIU inside its value', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.accounting_model = 'no_sumada';

    const result = calculateProfileContractEconomics(config, roundTripCosts);

    expect(result.invoice_lines).toHaveLength(1);
    expect(result.invoice_lines[0].aiu_component).toBe('contrato');
    expect(result.invoice_lines[0].unit_price).toBe('111.12');
    expect(result.direct_cost).toBe('100.00');
    expect(result.contract_value).toBe('111.12');
    expect(result.calculation.aiu?.contract_value).toBe('111.12');
    expect(result.calculation.aiu?.aiu_value).toBe('11.12');
  });

  it('blocks no_sumada with AIU-based percentages when direct cost is present', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.accounting_model = 'no_sumada';
    config.aiu!.components_basis = 'aiu';
    config.aiu!.components = {
      administracion: '50.00',
      imprevistos: '20.00',
      utilidad: '30.00',
    };

    expect(() => calculateProfileContractEconomics(config, costs, '100.00')).toThrow(
      /usa base por porcentajes de contrato o modelo sumado/,
    );
  });

  it('requires an explicit positive contract value when no_sumada is 100% AIU with zero cost', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.accounting_model = 'no_sumada';
    config.aiu!.components = {
      administracion: '40.00',
      imprevistos: '30.00',
      utilidad: '30.00',
    };

    expect(() => calculateProfileContractEconomics(config, [])).toThrow(
      /valor AIU explícito mayor que cero/,
    );
    const result = calculateProfileContractEconomics(config, [], '10.00');
    expect(result.direct_cost).toBe('0.00');
    expect(result.contract_value).toBe('10.00');
    expect(result.aiu_value).toBe('10.00');
  });

  it('blocks no_sumada when the gravable AIU buckets do not share one tax rate/code', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.accounting_model = 'no_sumada';
    config.taxes.rules = config.taxes.rules.map((rule) =>
      rule.bucket === 'utilidad' ? { ...rule, rate: '5.00' } : rule,
    );

    expect(() => calculateProfileContractEconomics(config, costs)).toThrow(
      /necesita una única tarifa y código fiscal/,
    );
  });
});
