import { Injectable } from '@nestjs/common';
import { resolvePackSize } from './packaging.util';

export interface PriceResolverParams {
  product: {
    base_price: number;
    is_on_sale: boolean;
    sale_price: number | null;
    track_inventory: boolean;
    has_multiple_price_tiers?: boolean;
  };
  variant?: {
    price_override: number | null;
    is_on_sale: boolean;
    sale_price: number | null;
    track_inventory_override: boolean | null;
  };
}

/**
 * Source of the resolved price.
 *
 * Legacy values (`variant` | `product` | `base`) are preserved for
 * backward compatibility with checkout.service.ts and any existing
 * consumer. The new `tier_override` / `tier_rule` values are returned
 * exclusively by `resolveWithTier` when a multi-tarifa is applied.
 */
export type PriceResolutionSource =
  | 'variant'
  | 'product'
  | 'base'
  | 'tier_override'
  | 'tier_rule'
  | 'legacy_cascade';

export interface PriceResolutionResult {
  unitBasePrice: number;
  unitPrice: number;
  unitPriceWithTax: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  totalTaxRate: number;
  currency: string;
  source: PriceResolutionSource;
  reason: string;
  // Multi-tarifa (only populated by resolveWithTier when a tier is applied)
  appliedPriceTierId?: number | null;
  appliedPriceTierName?: string | null;
  isPackageUnit?: boolean;
  unitsPerPackage?: number | null;
}

/**
 * Input for the multi-tarifa aware resolver. The `priceTier` is optional;
 * when undefined OR the product has `has_multiple_price_tiers = false`
 * the resolver falls back to the legacy cascade.
 */
export interface PriceResolverWithTierParams {
  product: PriceResolverParams['product'];
  variant?: PriceResolverParams['variant'];
  priceTier?: {
    id: number;
    name: string;
    discount_percentage: number;
    is_package_unit: boolean;
    units_per_package: number | null;
  } | null;
  /** Override prices/quantities for this product+tier (variant-specific or base). */
  tierOverrides?: Array<{
    variant_id: number | null;
    override_price: number | null;
    override_units_per_package?: number | null;
  }>;
  taxRate?: number;
  /** Optional quantity hint (does not affect unit price, only callers). */
  quantity?: number;
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
    let source: PriceResolutionSource = 'base';
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
    source: PriceResolutionSource,
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

  /**
   * Multi-tarifa aware resolver. Does NOT replace `resolvePrice`; checkout
   * and any consumer that does not pass a tier keeps using the legacy
   * cascade by calling `resolvePrice` directly.
   *
   * Resolution order:
   *
   *   a. If `product.has_multiple_price_tiers === false` OR `priceTier == null`
   *      → delegate to legacy cascade (`resolvePrice`) and report
   *      `source = 'legacy_cascade'` for traceability.
   *
   *   b. Resolve the packaging cascade:
   *      packSize = override_units_per_package ?? tier.units_per_package ?? 1.
   *      Look for an explicit override row in `tierOverrides`:
   *      - first try the variant-specific row (when a variant is provided);
   *      - if absent fall back to the base product override (variant_id = null).
   *      When the row carries a positive `override_price` it is treated as the
   *      price of the WHOLE PACKAGE → `unitPrice = override_price`,
   *      `source = 'tier_override'`.
   *
   *   c. Otherwise apply the tier rule on the full-package base:
   *      base = variant.price_override (if > 0) or product.base_price.
   *      packageBase = base * packSize.
   *      unitPrice = packageBase * (1 - discount_percentage / 100).
   *      `source = 'tier_rule'`.
   *
   *      With packSize === 1 the math is identical to the legacy single-unit
   *      behavior (zero regression for non-package tiers).
   *
   *   d. Taxes are applied identically to the legacy cascade
   *      (`unitPrice * (1 + taxRate)`).
   *
   * The returned `appliedPriceTierId` / `appliedPriceTierName` are used by
   * orders/quotations for the immutable snapshot in line items.
   */
  resolveWithTier(args: PriceResolverWithTierParams): PriceResolutionResult {
    const {
      product,
      variant,
      priceTier,
      tierOverrides,
      taxRate,
    } = args;
    const totalTaxRate = taxRate ?? this.DEFAULT_TAX_RATE;
    const currency = this.DEFAULT_CURRENCY;

    // (a) Tier not applicable → legacy cascade.
    if (!priceTier || !product.has_multiple_price_tiers) {
      const legacy = this.resolvePrice({ product, variant }, totalTaxRate);
      return {
        ...legacy,
        source: priceTier ? 'legacy_cascade' : legacy.source,
        appliedPriceTierId: null,
        appliedPriceTierName: null,
        isPackageUnit: false,
        unitsPerPackage: null,
      };
    }

    // Resolve the price-base used by tier rule (variant override wins over
    // product base price, identical to the legacy cascade's notion of base).
    const variantHasOverride =
      variant?.price_override != null && variant.price_override > 0;
    const ruleBasePrice = variantHasOverride
      ? Number(variant!.price_override)
      : Number(product.base_price);

    // (b) Override lookup — variant-specific first, then product base.
    const overrides = tierOverrides ?? [];
    let overrideRow:
      | {
          variant_id: number | null;
          override_price: number | null;
          override_units_per_package?: number | null;
        }
      | undefined;
    if (variant) {
      overrideRow = overrides.find(
        (o) => o.variant_id !== null && o.variant_id !== undefined,
      );
    }
    if (!overrideRow) {
      overrideRow = overrides.find(
        (o) => o.variant_id === null || o.variant_id === undefined,
      );
    }

    // packSize cascade: override ?? tier ?? 1. When packSize === 1 every
    // calculation below collapses to the legacy behavior (zero regression).
    const packSize = resolvePackSize(
      priceTier.units_per_package,
      overrideRow?.override_units_per_package,
    );

    // packageBase is the full-package list price used both for the rule path
    // and as compareAt. With packSize === 1 it equals ruleBasePrice.
    const packageBase = ruleBasePrice * packSize;

    let unitPrice: number;
    let source: PriceResolutionSource;
    let reason: string;
    if (
      overrideRow &&
      overrideRow.override_price != null &&
      Number(overrideRow.override_price) > 0
    ) {
      // Explicit override price is the price of the WHOLE PACKAGE.
      unitPrice = Number(overrideRow.override_price);
      source = 'tier_override';
      reason = `Explicit package price for tier "${priceTier.name}"`;
    } else {
      // (c) Apply discount rule on the full-package base.
      const discount = Number(priceTier.discount_percentage ?? 0);
      const clampedDiscount = Math.max(0, Math.min(100, discount));
      unitPrice = packageBase * (1 - clampedDiscount / 100);
      source = 'tier_rule';
      reason = `Tier "${priceTier.name}" rule (${clampedDiscount}% off, x${packSize})`;
    }

    const compareAtPrice = packageBase > unitPrice ? packageBase : null;

    return {
      unitBasePrice: ruleBasePrice,
      unitPrice,
      unitPriceWithTax: unitPrice * (1 + totalTaxRate),
      compareAtPrice,
      isOnSale: false,
      totalTaxRate,
      currency,
      source,
      reason,
      appliedPriceTierId: priceTier.id,
      appliedPriceTierName: priceTier.name,
      isPackageUnit: packSize > 1,
      unitsPerPackage: packSize > 1 ? packSize : null,
    };
  }
}
