import { mapEcommerceProductToItem, resolveEcommerceFinalPrice } from './app-page-products.util';
import { mapEcommerceServiceToCard } from '../service-page/service-page.util';
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

  it('paridad de promoción plana entre productos y servicios: aplica promo plana, omite escalonada, inválida o con variantes sin sale_unit', () => {
    const flat = product({
      id: 10,
      product_type: 'service',
      final_price: 80000,
      regular_final_price: 80000,
      variant_count: 0,
      active_promotion: {
        id: 1,
        name: 'Promo plana',
        promotional_price: 60000,
        is_quantity_tiered: false,
      } as EcommerceProduct['active_promotion'],
    });
    expect(mapEcommerceProductToItem(flat).final_price).toBe(60000);
    expect(mapEcommerceServiceToCard(flat).final_price).toBe(60000);
    expect(resolveEcommerceFinalPrice(flat).has_flat_promo).toBeTrue();

    // Promoción escalonada por cantidad: no sustituye el precio unitario.
    const tiered = product({
      final_price: 80000,
      active_promotion: {
        id: 2,
        name: 'Lleva 3',
        promotional_price: 60000,
        is_quantity_tiered: true,
      } as EcommerceProduct['active_promotion'],
    });
    expect(mapEcommerceProductToItem(tiered).final_price).toBe(80000);
    expect(mapEcommerceServiceToCard(tiered).final_price).toBe(80000);

    // Con variantes expuestas sin `sale_unit`: omite promoción plana; con `sale_unit`: sí aplica.
    const withVariants = product({
      final_price: 80000,
      variant_count: 2,
      active_promotion: { id: 3, name: 'Promo', promotional_price: 60000 } as EcommerceProduct['active_promotion'],
    });
    expect(mapEcommerceServiceToCard(withVariants).final_price).toBe(80000);

    const withSaleUnit = product({
      final_price: 80000,
      variant_count: 2,
      sale_unit: { price_tier_id: 1, name: 'Pack', units_per_package: 6 } as unknown as EcommerceProduct['sale_unit'],
      active_promotion: { id: 4, name: 'Promo', promotional_price: 60000 } as EcommerceProduct['active_promotion'],
    });
    expect(mapEcommerceProductToItem(withSaleUnit).final_price).toBe(60000);
    expect(mapEcommerceServiceToCard(withSaleUnit).final_price).toBe(60000);

    // Precio promocional inválido (<= 0 o >= final_price): se ignora.
    const invalid = product({
      final_price: 50000,
      active_promotion: { id: 5, name: 'Mayor', promotional_price: 55000 } as EcommerceProduct['active_promotion'],
    });
    expect(mapEcommerceServiceToCard(invalid).final_price).toBe(50000);
  });
});
