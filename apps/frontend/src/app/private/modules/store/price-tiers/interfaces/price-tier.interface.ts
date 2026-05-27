/**
 * Price tier (multi-tarifa) domain interfaces shared across:
 *  - Phase 3 admin module (Precios y Tarifas list/form)
 *  - Phase 4 product form (per-product overrides)
 *  - Phase 5 POS/orders/quotations (line-level tier selection)
 *
 * IMPORTANT: This file is the SOURCE OF TRUTH for tier-related types.
 * Phase 3 must reuse these — do not duplicate.
 */

/**
 * A store-scoped price tier (e.g. "Retail", "Wholesale", "Distributor").
 * `discount_percentage` applies over `base_price` when no per-product override
 * exists. `is_package_unit` flags package/bulk tiers that consume multiple
 * stock units when combined with `products.package_consumes_multiple_stock`.
 */
export interface PriceTier {
  id: number;
  store_id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  discount_percentage?: number | null;
  is_active: boolean;
  is_default: boolean;
  is_package_unit: boolean;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
  deleted_at?: string | Date | null;
}

/**
 * Per-product (or per-variant) price override for a given tier.
 * If `variant_id` is null/undefined, the override applies to the base product.
 */
export interface ProductPriceTierOverride {
  id: number;
  product_id: number;
  variant_id?: number | null;
  price_tier_id: number;
  override_price: number;
  created_at: string | Date;
  updated_at: string | Date;

  // Optional relation (populated by GET /products/:id/overrides)
  price_tier?: PriceTier;
}

export interface CreatePriceTierDto {
  name: string;
  code?: string;
  description?: string;
  discount_percentage?: number;
  is_active?: boolean;
  is_default?: boolean;
  is_package_unit?: boolean;
  sort_order?: number;
}

export type UpdatePriceTierDto = Partial<CreatePriceTierDto>;

export interface PriceTierQuery {
  page?: number;
  limit?: number;
  search?: string;
  is_active?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface UpsertProductPriceTierOverrideDto {
  /** Omit/undefined => override applies to base product. */
  variant_id?: number;
  override_price: number;
}
