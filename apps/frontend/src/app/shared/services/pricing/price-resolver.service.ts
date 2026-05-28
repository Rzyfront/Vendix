import { Injectable } from '@angular/core';
import {
  ProductLike,
  VariantLike,
  PriceResolution,
  PriceTierLike,
  ProductPriceTierOverrideLike,
} from './types';

/**
 * PriceResolverService
 *
 * Replica las reglas de resolución de precios del backend:
 *
 * `resolve(...)` — Cascada legacy:
 *   1. variant.is_on_sale && variant.sale_price > 0 → net = variant.sale_price
 *   2. variant.price_override != null && > 0 → net = variant.price_override
 *   3. product.is_on_sale && sale_price < base_price → net = sale_price
 *   4. fallback → net = base_price
 *
 * `resolveWithTier(...)` — Multi-tarifa (Phase 5):
 *   a. Si la tarifa no aplica (producto sin `has_multiple_price_tiers` o sin
 *      tier seleccionado), retorna la cascada legacy.
 *   b. Si hay override per-producto (o per-variante) para la tarifa →
 *      `unit_price = override_price`.
 *   c. En caso contrario, aplica `discount_percentage` sobre la base
 *      (variant.price_override si existe, sino product.base_price).
 *
 * Esta lógica replica `PriceResolverService.resolveWithTier` del backend
 * (apps/backend/src/domains/store/products/services/price-resolver.service.ts)
 * para que UIs como POS, orders create y quotations puedan mostrar el
 * precio resuelto antes de enviar al backend. El backend re-resuelve el
 * precio canónico y persiste el snapshot — el frontend solo presenta.
 */
@Injectable({
  providedIn: 'root',
})
export class PriceResolverService {

  /**
   * Resuelve el precio para un producto, considerando opcionalmente una variante.
   * Cascada legacy, sin lógica de multi-tarifa.
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
        unitPriceWithTax: netPrice,
        compareAtPrice,
        isOnSale: true,
        totalTaxRate,
        currency: 'USD',
        source: 'variant',
        reason: 'Variant on sale',
        appliedPriceTierId: null,
        appliedPriceTierName: null,
        isPackageUnit: false,
        unitsPerPackage: product.units_per_package ?? null,
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
        appliedPriceTierId: null,
        appliedPriceTierName: null,
        isPackageUnit: false,
        unitsPerPackage: product.units_per_package ?? null,
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
        appliedPriceTierId: null,
        appliedPriceTierName: null,
        isPackageUnit: false,
        unitsPerPackage: product.units_per_package ?? null,
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
      appliedPriceTierId: null,
      appliedPriceTierName: null,
      isPackageUnit: false,
      unitsPerPackage: product.units_per_package ?? null,
    };
  }

  /**
   * Resuelve el precio con impuestos aplicados (cascada legacy).
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

  /**
   * Resuelve el precio aplicando una tarifa (multi-tarifa) — Phase 5.
   *
   * @param product Producto base con flag `has_multiple_price_tiers`.
   * @param variant Variante opcional.
   * @param priceTier Tarifa seleccionada (null/undefined = legacy cascade).
   * @param tierOverrides Overrides per-producto YA filtrados por
   *   `price_tier_id === priceTier.id`. El caller debe pre-cargar y filtrar.
   * @param taxRate Tasa de impuesto efectiva (0 = sin tax).
   */
  resolveWithTier(
    product: ProductLike,
    variant: VariantLike | undefined,
    priceTier: PriceTierLike | null | undefined,
    tierOverrides: ProductPriceTierOverrideLike[] | undefined,
    taxRate: number = 0,
  ): PriceResolution {
    // (a) Tier not applicable → legacy cascade.
    if (!priceTier || !product.has_multiple_price_tiers) {
      const legacy = this.resolveWithTax(product, variant, taxRate);
      return {
        ...legacy,
        source: priceTier ? 'legacy_cascade' : legacy.source,
        appliedPriceTierId: null,
        appliedPriceTierName: null,
        isPackageUnit: false,
        unitsPerPackage: product.units_per_package ?? null,
      };
    }

    const basePrice = Number(product.base_price) || 0;
    const variantHasOverride =
      variant?.price_override != null && Number(variant.price_override) > 0;
    const ruleBasePrice = variantHasOverride
      ? Number(variant!.price_override)
      : basePrice;

    // (b) Override lookup — variant-specific first, then product base.
    const overrides = tierOverrides ?? [];
    const variantIdNum = variant ? Number(variant.id) : null;
    let overrideRow: ProductPriceTierOverrideLike | undefined;
    if (variant && Number.isFinite(variantIdNum)) {
      overrideRow = overrides.find(
        (o) => o.variant_id !== null && o.variant_id !== undefined &&
               Number(o.variant_id) === variantIdNum,
      );
    }
    if (!overrideRow) {
      overrideRow = overrides.find(
        (o) => o.variant_id === null || o.variant_id === undefined,
      );
    }

    let unitPrice: number;
    let source: PriceResolution['source'];
    let reason: string;
    if (overrideRow) {
      unitPrice = Number(overrideRow.override_price);
      source = 'tier_override';
      reason = `Explicit override for tier "${priceTier.name}"`;
    } else {
      const discount = Number(priceTier.discount_percentage ?? 0);
      const clampedDiscount = Math.max(0, Math.min(100, discount));
      unitPrice = ruleBasePrice * (1 - clampedDiscount / 100);
      source = 'tier_rule';
      reason = `Tier "${priceTier.name}" rule (${clampedDiscount}% off)`;
    }

    const compareAtPrice = ruleBasePrice > unitPrice ? ruleBasePrice : null;

    return {
      unitBasePrice: ruleBasePrice,
      unitPrice,
      unitPriceWithTax: unitPrice * (1 + taxRate),
      compareAtPrice,
      isOnSale: false,
      totalTaxRate: taxRate,
      currency: 'USD',
      source,
      reason,
      appliedPriceTierId: priceTier.id,
      appliedPriceTierName: priceTier.name,
      isPackageUnit: !!priceTier.is_package_unit,
      unitsPerPackage: product.units_per_package ?? null,
    };
  }
}
