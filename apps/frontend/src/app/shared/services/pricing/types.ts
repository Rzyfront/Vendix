export interface ProductLike {
  id: string;
  base_price: number;
  is_on_sale: boolean;
  sale_price: number | null;
  track_inventory: boolean;
  product_variants?: VariantLike[];
  // Multi-tarifa flag (replicated from backend products schema).
  // Packaging (units-per-package) now lives on the price tier / override,
  // not on the product. See packaging.util.ts.
  has_multiple_price_tiers?: boolean | null;
}

export interface VariantLike {
  id: string;
  price_override: number | null;
  is_on_sale: boolean;
  sale_price: number | null;
  track_inventory_override: boolean | null;
}

/**
 * Minimal subset of price-tier required by the frontend resolver.
 * Mirrors the backend `PriceTier` row used by `resolveWithTier`.
 */
export interface PriceTierLike {
  id: number;
  name: string;
  discount_percentage?: number | null;
  is_package_unit?: boolean | null;
  /** Units per package carried by the tier (packaging cascade source). */
  units_per_package?: number | null;
}

/**
 * Per-product override row used when the resolver applies a tier.
 * Caller must pre-load overrides for the product (and pass the rows that
 * match the selected tier).
 */
export interface ProductPriceTierOverrideLike {
  variant_id?: number | null;
  /**
   * Whole-package override price. When `!= null && > 0` it is the price of the
   * ENTIRE package and wins over the tier discount rule. `null` => fall through
   * to the rule path.
   */
  override_price: number | null;
  /** Per-product/per-variant override of units-per-package (packaging cascade). */
  override_units_per_package?: number | null;
}

export type PriceResolutionSource =
  | 'variant'
  | 'product'
  | 'base'
  | 'tier_override'
  | 'tier_rule'
  | 'legacy_cascade';

export interface PriceResolution {
  unitBasePrice: number;
  unitPrice: number;
  unitPriceWithTax: number;
  compareAtPrice: number | null;
  isOnSale: boolean;
  totalTaxRate: number;
  currency: string;
  source: PriceResolutionSource;
  reason: string;
  // Multi-tarifa fields (populated only by resolveWithTier when a tier
  // is actually applied; legacy `resolve` returns null/false defaults).
  appliedPriceTierId?: number | null;
  appliedPriceTierName?: string | null;
  isPackageUnit?: boolean;
  unitsPerPackage?: number | null;
}
