import { PriceResolverService } from './price-resolver.service';
import { ProductLike } from './types';

/**
 * El POS y el admin calculan el precio de tarifa con este resolver; el backend
 * lo recalcula con `applyTierAdjustment`. Si el frontend sigue leyendo solo
 * `discount_percentage`, una tarifa de precio fijo se cotiza al precio base y
 * el cobro choca con el backend. Spec: odd/tasks/price-tier-adjustments-customers.md S1, S2, S9.
 */
describe('PriceResolverService.resolveWithTier — tipos de ajuste', () => {
  const service = new PriceResolverService();
  const product: ProductLike = {
    id: '1',
    base_price: 10000,
    is_on_sale: false,
    sale_price: null,
    track_inventory: false,
    has_multiple_price_tiers: true,
  };
  const tier = (over: Record<string, unknown>) => ({
    id: 4,
    name: 'Mayorista',
    discount_percentage: 0,
    ...over,
  });

  it('la tarifa histórica sigue aplicando su porcentaje de descuento', () => {
    const r = service.resolveWithTier(product, undefined, tier({ discount_percentage: 15 }), []);
    expect(r.unitPrice).toBe(8500);
  });

  it('precio fijo: todos valen 10.000 sin importar su precio', () => {
    const r = service.resolveWithTier(
      { ...product, base_price: 4500 },
      undefined,
      tier({ adjustment_type: 'fixed_price', adjustment_value: 10000 }),
      [],
    );
    expect(r.unitPrice).toBe(10000);
  });

  it('monto adicional por paquete se suma una vez', () => {
    const r = service.resolveWithTier(
      { ...product, base_price: 1000 },
      undefined,
      tier({
        adjustment_type: 'fixed_amount_surcharge',
        adjustment_value: 100,
        amount_scope: 'per_package',
        units_per_package: 12,
      }),
      [],
    );
    expect(r.unitPrice).toBe(12100);
  });

  it('el precio propio del producto sigue ganando sobre la regla', () => {
    const r = service.resolveWithTier(
      product,
      undefined,
      tier({ adjustment_type: 'fixed_price', adjustment_value: 10000 }),
      [{ price_tier_id: 4, variant_id: null, override_price: 7000 } as any],
    );
    expect(r.unitPrice).toBe(7000);
  });
});
