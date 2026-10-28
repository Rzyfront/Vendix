import {
  buildPriceTierRulePayload,
  customerPriceTierOptions,
  describePriceTierRule,
  tierFallbackPackagePrice,
  toCustomerPriceTierId,
} from './price-tier-rule.util';
import { PriceTier } from '../interfaces/price-tier.interface';

/**
 * Etiquetas y precio sugerido de la regla de una tarifa en el admin.
 * Spec: odd/tasks/price-tier-adjustments-customers.md S1, S2 (H1).
 */
describe('describePriceTierRule', () => {
  it('describe cada tipo de ajuste en español', () => {
    expect(describePriceTierRule({ discount_percentage: 15 })).toBe('15 % de descuento');
    expect(
      describePriceTierRule({ adjustment_type: 'percent_surcharge', adjustment_value: 10 }),
    ).toBe('+10 %');
    expect(
      describePriceTierRule({
        adjustment_type: 'fixed_amount_surcharge',
        adjustment_value: 500,
        amount_scope: 'per_package',
      }),
    ).toBe('+$500 por paquete');
    expect(
      describePriceTierRule({ adjustment_type: 'fixed_amount_discount', adjustment_value: 500 }),
    ).toBe('−$500 por unidad');
    expect(
      describePriceTierRule({ adjustment_type: 'fixed_price', adjustment_value: '10000.00' }),
    ).toBe('Precio fijo $10.000 por unidad');
  });

  it('un descuento de 0 % no dice nada', () => {
    expect(describePriceTierRule({ discount_percentage: 0 })).toBeNull();
  });
});

describe('tierFallbackPackagePrice', () => {
  it('aplica la regla al paquete', () => {
    expect(
      tierFallbackPackagePrice(1000, 12, {
        adjustment_type: 'fixed_amount_surcharge',
        adjustment_value: 100,
      }),
    ).toBe(13200);
  });

  it('un precio fijo no necesita precio base', () => {
    expect(
      tierFallbackPackagePrice(0, 1, { adjustment_type: 'fixed_price', adjustment_value: 9000 }),
    ).toBe(9000);
  });

  it('sin precio base las reglas relativas no sugieren nada', () => {
    expect(tierFallbackPackagePrice(0, 1, { discount_percentage: 10 })).toBeNull();
  });
});

describe('buildPriceTierRulePayload', () => {
  it('el descuento porcentual viaja en discount_percentage, sin valor de ajuste', () => {
    expect(
      buildPriceTierRulePayload({
        adjustment_type: 'percent_discount',
        discount_percentage: 12,
        adjustment_value: 999,
        amount_scope: 'per_package',
      }),
    ).toEqual({
      payload: {
        adjustment_type: 'percent_discount',
        discount_percentage: 12,
        adjustment_value: null,
        amount_scope: 'per_unit',
      },
      error: null,
    });
  });

  it('un monto fijo viaja con su valor y su alcance, y el descuento en 0', () => {
    expect(
      buildPriceTierRulePayload({
        adjustment_type: 'fixed_amount_surcharge',
        discount_percentage: 12,
        adjustment_value: 500,
        amount_scope: 'per_package',
      }),
    ).toEqual({
      payload: {
        adjustment_type: 'fixed_amount_surcharge',
        discount_percentage: 0,
        adjustment_value: 500,
        amount_scope: 'per_package',
      },
      error: null,
    });
  });

  it('los porcentajes no guardan alcance', () => {
    expect(
      buildPriceTierRulePayload({
        adjustment_type: 'percent_surcharge',
        discount_percentage: 0,
        adjustment_value: 10,
        amount_scope: 'per_package',
      }).payload.amount_scope,
    ).toBe('per_unit');
  });

  it('un tipo nuevo sin valor o con recargo > 1000 % devuelve el error a mostrar', () => {
    expect(
      buildPriceTierRulePayload({
        adjustment_type: 'fixed_price',
        discount_percentage: 0,
        adjustment_value: null,
        amount_scope: 'per_unit',
      }).error,
    ).toBe('Indica un valor mayor que 0.');
    expect(
      buildPriceTierRulePayload({
        adjustment_type: 'percent_surcharge',
        discount_percentage: 0,
        adjustment_value: 1001,
        amount_scope: 'per_unit',
      }).error,
    ).toBe('El recargo no puede pasar de 1000 %.');
  });
});

describe('customerPriceTierOptions', () => {
  const tier = (over: Partial<PriceTier>): PriceTier =>
    ({
      id: 1,
      name: 'Mayorista',
      kind: 'customer_tier',
      is_active: true,
      discount_percentage: 10,
      ...over,
    }) as PriceTier;

  it('ofrece "Sin tarifa" y solo las tarifas de cliente, con su regla', () => {
    expect(
      customerPriceTierOptions(
        [tier({}), tier({ id: 2, name: 'Bulto', kind: 'sale_unit' })],
        null,
      ),
    ).toEqual([
      { value: '', label: 'Sin tarifa' },
      { value: 1, label: 'Mayorista', description: '10 % de descuento' },
    ]);
  });

  it('una tarifa asignada que ya no está activa sigue visible para poder quitarla', () => {
    expect(customerPriceTierOptions([tier({})], 9).at(-1)).toEqual({
      value: 9,
      label: 'Tarifa inactiva o eliminada',
    });
  });
});

describe('toCustomerPriceTierId', () => {
  it('"Sin tarifa" se guarda como null y un id como número', () => {
    expect(toCustomerPriceTierId('')).toBeNull();
    expect(toCustomerPriceTierId(null)).toBeNull();
    expect(toCustomerPriceTierId('7')).toBe(7);
    expect(toCustomerPriceTierId(7)).toBe(7);
  });
});
