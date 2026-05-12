import { Injectable } from '@nestjs/common';

export interface PriceResolverParams {
  product: {
    base_price: number;
    is_on_sale: boolean;
    sale_price: number | null;
    track_inventory: boolean;
  };
  variant?: {
    price_override: number | null;
    is_on_sale: boolean;
    sale_price: number | null;
    track_inventory_override: boolean | null;
  };
}

export interface PriceResolutionResult {
  unitBasePrice: number;
  unitPrice: number;
  unitPriceWithTax: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  totalTaxRate: number;
  currency: string;
  source: 'variant' | 'product' | 'base';
  reason: string;
}

/**
 * PriceResolverService
 *
 * Resolves the effective price for a product or variant following priority rules:
 * 1. variant.is_on_sale && variant.sale_price > 0 → net = variant.sale_price, compareAt = variant.price_override ?? product.base_price
 * 2. variant.price_override != null && variant.price_override > 0 → net = variant.price_override, compareAt = null
 * 3. product.is_on_sale && product.sale_price < product.base_price → net = product.sale_price, compareAt = product.base_price
 * 4. fallback → net = product.base_price, compareAt = null
 *
 * CRITICAL: Uses != null && > 0 checks (no falsy coercion like || or ?? default)
 */
@Injectable()
export class PriceResolverService {
  /**
   * Default currency code (ISO 4217)
   */
  private readonly DEFAULT_CURRENCY = 'COP';

  /**
   * Default tax rate when none provided
   */
  private readonly DEFAULT_TAX_RATE = 0;

  resolvePrice(
    params: PriceResolverParams,
    taxRate?: number,
  ): PriceResolutionResult {
    const { product, variant } = params;
    const totalTaxRate = taxRate ?? this.DEFAULT_TAX_RATE;
    const currency = this.DEFAULT_CURRENCY;

    // Initialize with base product values
    let unitBasePrice = product.base_price;
    let unitPrice = product.base_price;
    let compareAtPrice: number | null = null;
    let isOnSale = false;
    let source: 'variant' | 'product' | 'base' = 'base';
    let reason = 'Base product price';

    // Rule 1: Variant on sale with valid sale_price takes priority
    // variant.is_on_sale && variant.sale_price > 0 → net = variant.sale_price, compareAt = variant.price_override ?? product.base_price
    if (
      variant?.is_on_sale &&
      variant.sale_price != null &&
      variant.sale_price > 0
    ) {
      unitPrice = variant.sale_price;
      unitBasePrice = variant.price_override ?? product.base_price;
      compareAtPrice = variant.price_override ?? product.base_price;
      isOnSale = true;
      source = 'variant';
      reason =
        variant.price_override != null
          ? 'Variant sale price with price override'
          : 'Variant sale price';

      return this.buildResult(
        unitBasePrice,
        unitPrice,
        totalTaxRate,
        currency,
        compareAtPrice,
        isOnSale,
        source,
        reason,
      );
    }

    // Rule 2: Variant has a valid price_override (no sale, just override)
    // variant.price_override != null && variant.price_override > 0 → net = variant.price_override, compareAt = null
    if (variant?.price_override != null && variant.price_override > 0) {
      unitPrice = variant.price_override;
      unitBasePrice = variant.price_override;
      compareAtPrice = null;
      isOnSale = false;
      source = 'variant';
      reason = 'Variant price override';

      return this.buildResult(
        unitBasePrice,
        unitPrice,
        totalTaxRate,
        currency,
        compareAtPrice,
        isOnSale,
        source,
        reason,
      );
    }

    // Rule 3: Product on sale with valid sale_price
    // product.is_on_sale && product.sale_price < product.base_price → net = product.sale_price, compareAt = product.base_price
    if (
      product.is_on_sale &&
      product.sale_price != null &&
      product.sale_price > 0 &&
      product.sale_price < product.base_price
    ) {
      unitPrice = product.sale_price;
      unitBasePrice = product.base_price;
      compareAtPrice = product.base_price;
      isOnSale = true;
      source = 'product';
      reason = 'Product sale price';

      return this.buildResult(
        unitBasePrice,
        unitPrice,
        totalTaxRate,
        currency,
        compareAtPrice,
        isOnSale,
        source,
        reason,
      );
    }

    // Rule 4: Fallback to base product price
    // net = product.base_price, compareAt = null
    unitPrice = product.base_price;
    unitBasePrice = product.base_price;
    compareAtPrice = null;
    isOnSale = false;
    source = 'base';
    reason = 'Base product price';

    return this.buildResult(
      unitBasePrice,
      unitPrice,
      totalTaxRate,
      currency,
      compareAtPrice,
      isOnSale,
      source,
      reason,
    );
  }

  /**
   * Build the result object with all price information
   */
  private buildResult(
    unitBasePrice: number,
    unitPrice: number,
    totalTaxRate: number,
    currency: string,
    compareAtPrice: number | null,
    isOnSale: boolean,
    source: 'variant' | 'product' | 'base',
    reason: string,
  ): PriceResolutionResult {
    // Calculate price with tax: unitPrice * (1 + taxRate)
    const unitPriceWithTax = unitPrice * (1 + totalTaxRate);

    return {
      unitBasePrice,
      unitPrice,
      unitPriceWithTax,
      compareAtPrice,
      isOnSale,
      totalTaxRate,
      currency,
      source,
      reason,
    };
  }

  /**
   * Calculate tax amount from a price
   */
  calculateTaxAmount(unitPrice: number, taxRate: number): number {
    return unitPrice * taxRate;
  }

  /**
   * Calculate price including tax
   */
  calculatePriceWithTax(unitPrice: number, taxRate: number): number {
    return unitPrice * (1 + taxRate);
  }
}
