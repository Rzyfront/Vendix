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

  it('preserves multiple discounted source costs and reconciles cents once', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    const inputs: ProfileContractCostLine[] = [
      { description: 'Mano de obra', quantity: '2', unit_price: '100.00', discount_amount: '10.00' },
      { description: 'Insumos', quantity: '3', unit_price: '50.00', discount_amount: '5.00' },
    ];

    const result = calculateProfileContractEconomics(config, inputs);

    expect(result.direct_cost).toBe('335.00');
    expect(result.invoice_lines.slice(0, 2).map((line) => [
      line.description,
      line.quantity,
      line.unit_price,
      line.discount_amount,
    ])).toEqual([
      ['Mano de obra', '2', '100.00', '10.00'],
      ['Insumos', '3', '50.00', '5.00'],
    ]);
    expect(result.contract_value).toBe('372.22');
    expect(result.calculation.aiu?.contract_value).toBe(result.contract_value);
  });

  it.each(['aiu', 'utilidad', 'subtotal'] as const)(
    'uses the canonical taxable basis «%s» without changing input taxes',
    (taxable_basis) => {
      const config = buildDefaultAiuProfileConfig('Obra');
      config.aiu!.taxable_basis = taxable_basis;
      config.taxes.rules = config.taxes.rules.map((rule) => ({
        ...rule,
        taxable_basis,
        taxable:
          taxable_basis === 'aiu'
            ? rule.bucket !== 'costo'
            : taxable_basis === 'utilidad'
              ? rule.bucket === 'utilidad'
              : true,
      }));

      const result = calculateProfileContractEconomics(config, roundTripCosts);
      expect(result.calculation.aiu?.taxable_basis).toBe(taxable_basis);
      expect(result.calculation.totals.total_before_tax).toBe(result.contract_value);
      expect(result.calculation.divergences).toEqual([]);
    },
  );

  it('distinguishes excluded tax rules from taxable zero-rate typed rules', () => {
    const excluded = buildDefaultAiuProfileConfig('Obra');
    excluded.taxes.rules = excluded.taxes.rules.map((rule) =>
      rule.bucket === 'costo' ? { ...rule, taxable: false, rate: '0.00' } : rule,
    );
    const excludedResult = calculateProfileContractEconomics(excluded, costs);
    expect(excludedResult.invoice_lines[0].taxes).toBeUndefined();

    const zeroRated = buildDefaultAiuProfileConfig('Obra');
    zeroRated.taxes.rules = zeroRated.taxes.rules.map((rule) =>
      rule.bucket === 'administracion' ? { ...rule, taxable: true, rate: '0.00' } : rule,
    );
    const zeroRateResult = calculateProfileContractEconomics(zeroRated, costs);
    expect(zeroRateResult.invoice_lines.find((line) => line.bucket === 'administracion')?.taxes).toEqual([
      expect.objectContaining({ tax_rate: '0.00', tax_type: 'iva' }),
    ]);
  });

  it('requires positive explicit AIU and enforces the frozen floor only when enabled', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.aiu!.components_basis = 'aiu';
    config.aiu!.components = {
      administracion: '50.00',
      imprevistos: '20.00',
      utilidad: '30.00',
    };
    config.aiu!.enforce_minimum_base = true;
    expect(() => calculateProfileContractEconomics(config, costs)).toThrow(
      /indica explícitamente/,
    );
    expect(() => calculateProfileContractEconomics(config, costs, '50.00')).toThrow();

    config.aiu!.enforce_minimum_base = false;
    const result = calculateProfileContractEconomics(config, costs, '50.00');
    expect(result.aiu_value).toBe('50.00');
    expect(result.calculation.divergences).toEqual([]);
  });

  it('rejects invalid quantities and discounts above direct line value', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    expect(() => calculateProfileContractEconomics(config, [
      { description: 'Cantidad inválida', quantity: '0', unit_price: '10.00' },
    ])).toThrow(/cantidad positiva/);
    expect(() => calculateProfileContractEconomics(config, [
      { description: 'Descuento excesivo', quantity: '1', unit_price: '10.00', discount_amount: '10.01' },
    ])).toThrow(/descuento no superior/);
  });

  it('maps DIAN tax codes instead of fabricating IVA for non-IVA taxes', () => {
    const config = buildDefaultAiuProfileConfig('Obra');
    config.taxes.rules = config.taxes.rules.map((rule) =>
      rule.bucket === 'utilidad'
        ? { ...rule, taxable: true, tax_code: '04', rate: '8.00' }
        : rule,
    );
    const result = calculateProfileContractEconomics(config, costs);
    const utility = result.invoice_lines.find((line) => line.bucket === 'utilidad');
    expect(utility?.taxes).toEqual([
      expect.objectContaining({ tax_name: 'INC', tax_rate: '8.00', tax_type: 'inc' }),
    ]);
    expect(utility?.taxes?.[0].tax_type).not.toBe('iva');
  });
});
