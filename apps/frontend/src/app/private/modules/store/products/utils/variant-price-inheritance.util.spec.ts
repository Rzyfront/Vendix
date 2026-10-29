import {
  followBasePrice,
  variantPriceOverrideToSend,
} from './variant-price-inheritance.util';

/**
 * Una variante sin precio propio hereda el `base_price` del producto. Antes
 * la página enviaba SIEMPRE el precio visible como `price_override`, así que
 * toda variante generada quedaba congelada con el precio base del momento:
 * subir el precio del producto no movía el de sus variantes.
 * Spec: odd/tasks/price-tier-adjustments-customers.md S11.
 */
describe('variantPriceOverrideToSend', () => {
  it('un precio igual al base no es un precio propio: hereda', () => {
    expect(variantPriceOverrideToSend(10000, 10000)).toBeNull();
    expect(variantPriceOverrideToSend('10000.00', 10000)).toBeNull();
  });

  it('un precio distinto del base se guarda como precio propio', () => {
    expect(variantPriceOverrideToSend(12000, 10000)).toBe(12000);
  });

  it('0 o vacío nunca es un precio propio (el backend lo rechaza)', () => {
    expect(variantPriceOverrideToSend(0, 10000)).toBeNull();
    expect(variantPriceOverrideToSend(null, 10000)).toBeNull();
  });
});

describe('followBasePrice', () => {
  it('las variantes que heredaban el precio base siguen al nuevo', () => {
    const variants = [
      { sku: 'A', price: 10000 },
      { sku: 'B', price: 15000 },
    ];
    const result = followBasePrice(variants, 10000, 12000);
    expect(result.map((v) => v.price)).toEqual([12000, 15000]);
  });

  it('devuelve las mismas variantes si nada cambia', () => {
    const variants = [{ sku: 'B', price: 15000 }];
    expect(followBasePrice(variants, 10000, 12000)).toBe(variants);
    expect(followBasePrice(variants, 10000, 10000)).toBe(variants);
  });
});
