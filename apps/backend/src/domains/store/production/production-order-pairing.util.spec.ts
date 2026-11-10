import { findProductionOrderForLine } from './production-order-pairing.util';

describe('findProductionOrderForLine (QUI-995)', () => {
  const base = { id: 1, product_id: 50, product_variant_id: null };
  const v10 = { id: 2, product_id: 50, product_variant_id: 10 };
  const v11 = { id: 3, product_id: 50, product_variant_id: 11 };

  it('pairs a line with the order of its exact product and variant', () => {
    expect(findProductionOrderForLine([v10, v11], { product_id: 50, product_variant_id: 11 })).toBe(v11);
    expect(findProductionOrderForLine([base], { product_id: 50 })).toBe(base);
  });

  it('legacy shape: a variant line takes the product NULL-variant order when no order of the product has a variant', () => {
    expect(findProductionOrderForLine([base], { product_id: 50, product_variant_id: 10 })).toBe(base);
  });

  it('never falls back when the sale has any variant order for the product', () => {
    expect(findProductionOrderForLine([base, v10], { product_id: 50, product_variant_id: 11 })).toBeUndefined();
    expect(findProductionOrderForLine([v10], { product_id: 50, product_variant_id: 11 })).toBeUndefined();
  });

  it('a base line never takes a variant order, and another product never matches', () => {
    expect(findProductionOrderForLine([v10], { product_id: 50, product_variant_id: null })).toBeUndefined();
    expect(findProductionOrderForLine([base], { product_id: 60, product_variant_id: 10 })).toBeUndefined();
  });
});
