import { Injectable, inject } from '@angular/core';
import { ProductLike, VariantLike, PriceResolution } from './types';

/**
 * PriceResolverService
 * 
 * Replica las reglas de resolución de precios del backend:
 * 1. variant.is_on_sale && variant.sale_price > 0 → net = variant.sale_price, compareAt = variant.price_override ?? product.base_price
 * 2. variant.price_override != null && variant.price_override > 0 → net = variant.price_override, compareAt = null
 * 3. product.is_on_sale && product.sale_price < product.base_price → net = product.sale_price, compareAt = product.base_price
 * 4. fallback → net = product.base_price, compareAt = null
 */
@Injectable({
  providedIn: 'root',
})
export class PriceResolverService {
  
  /**
   * Resuelve el precio para un producto, considerando opcionalmente una variante.
   * 
   * @param product - El producto base (ProductLike)
   * @param variant - Variante opcional (VariantLike | undefined)
   * @returns PriceResolution con todos los detalles del precio resuelto
   */
  resolve(product: ProductLike, variant?: VariantLike | undefined): PriceResolution {
    const basePrice = Number(product.base_price) || 0;
    const salePrice = Number(product.sale_price) || 0;
    const totalTaxRate = 0; // Se calculará con tax_assignments si está disponible

    // Regla 1: Variante en oferta
    if (variant?.is_on_sale && variant.sale_price && variant.sale_price > 0) {
      const netPrice = Number(variant.sale_price);
      const compareAtPrice = variant.price_override != null && variant.price_override > 0
        ? Number(variant.price_override)
        : basePrice;
      
      return {
        unitBasePrice: basePrice,
        unitPrice: netPrice,
        unitPriceWithTax: netPrice, // Sin tax por ahora, se puede agregar después
        compareAtPrice,
        isOnSale: true,
        totalTaxRate,
        currency: 'USD', // Se puede obtener de CurrencyFormatService
        source: 'variant',
        reason: 'Variant on sale',
      };
    }

    // Regla 2: Variante con price_override
    if (variant?.price_override != null && variant.price_override > 0) {
      return {
        unitBasePrice: basePrice,
        unitPrice: Number(variant.price_override),
        unitPriceWithTax: Number(variant.price_override),
        compareAtPrice: null,
        isOnSale: false,
        totalTaxRate,
        currency: 'USD',
        source: 'variant',
        reason: 'Variant price override',
      };
    }

    // Regla 3: Producto en oferta
    if (product.is_on_sale && salePrice > 0 && salePrice < basePrice) {
      return {
        unitBasePrice: basePrice,
        unitPrice: salePrice,
        unitPriceWithTax: salePrice,
        compareAtPrice: basePrice,
        isOnSale: true,
        totalTaxRate,
        currency: 'USD',
        source: 'product',
        reason: 'Product on sale',
      };
    }

    // Regla 4: Fallback - precio base
    return {
      unitBasePrice: basePrice,
      unitPrice: basePrice,
      unitPriceWithTax: basePrice,
      compareAtPrice: null,
      isOnSale: false,
      totalTaxRate,
      currency: 'USD',
      source: 'base',
      reason: 'Base price',
    };
  }

  /**
   * Resuelve el precio con impuestos aplicados.
   * 
   * @param product - El producto base
   * @param variant - Variante opcional
   * @param taxRate - Tasa de impuesto a aplicar (ej: 0.19 para 19%)
   * @returns PriceResolution con precios incluyendo impuestos
   */
  resolveWithTax(
    product: ProductLike,
    variant: VariantLike | undefined,
    taxRate: number
  ): PriceResolution {
    const resolution = this.resolve(product, variant);
    
    return {
      ...resolution,
      unitPriceWithTax: resolution.unitPrice * (1 + taxRate),
      totalTaxRate: taxRate,
    };
  }
}
