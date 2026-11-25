import { mapEcommerceProductToItem } from './app-page-products.util';
import type { EcommerceProduct } from '../../private/modules/ecommerce/services/catalog.service';

function product(overrides: Partial<EcommerceProduct> = {}): EcommerceProduct {
  return {
    id: 1,
    slug: 'producto',
    name: 'Producto',
    image_url: null,
    final_price: 50000,
    regular_final_price: 50000,
    is_on_sale: false,
    brand: null,
    categories: [],
    ...overrides,
  } as EcommerceProduct;
}

describe('mapEcommerceProductToItem (paridad con la vista previa)', () => {
  it('omite la promoción plana cuando el producto expone variantes, aunque no lleguen en el payload', () => {
    const item = mapEcommerceProductToItem(
      product({
        final_price: 80000,
        regular_final_price: 80000,
        // El bloque no pide `include_variants`: solo llega el contador.
        variant_count: 2,
        active_promotion: {
          id: 3,
          name: 'Promo camisa',
          promotional_price: 60000,
        } as EcommerceProduct['active_promotion'],
      }),
    );

    // Si se aplicara la promo, la tarjeta quedaría en 60.000 y al elegir la
    // variante el precio subiría: por eso se ignora.
    expect(item.final_price).toBe(80000);
    expect(item.is_on_sale).toBe(false);
  });

  it('aplica la promoción plana cuando el producto no tiene variantes', () => {
    const item = mapEcommerceProductToItem(
      product({
        final_price: 50000,
        regular_final_price: 50000,
        variant_count: 0,
        active_promotion: {
          id: 1,
          name: 'Promo 20%',
          promotional_price: 40000,
        } as EcommerceProduct['active_promotion'],
      }),
    );

    expect(item.final_price).toBe(40000);
    expect(item.regular_final_price).toBe(50000);
    expect(item.is_on_sale).toBe(true);
  });

  it('marca is_on_sale con solo el flag, aunque no haya precio rebajado', () => {
    const item = mapEcommerceProductToItem(
      product({ final_price: 30000, regular_final_price: 30000, is_on_sale: true }),
    );

    expect(item.is_on_sale).toBe(true);
  });
});
