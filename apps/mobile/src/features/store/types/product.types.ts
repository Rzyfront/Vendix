export type ProductState = 'active' | 'inactive' | 'archived';
export type PricingType = 'unit' | 'weight';
export type ProductType = 'physical' | 'service';

export interface Product {
  id: number;
  store_id: number;
  brand_id?: number | null;
  name: string;
  slug: string;
  description?: string | null;
  base_price: number;
  cost_price?: number | null;
  profit_margin?: number | null;
  is_on_sale?: boolean;
  sale_price?: number | null;
  available_for_ecommerce?: boolean;
  sku?: string | null;
  stock_quantity?: number | null;
  track_inventory?: boolean;
  weight?: number | null;
  state: ProductState;
  pricing_type?: PricingType;
  product_type?: ProductType;
  service_duration_minutes?: number | null;
  service_modality?: string | null;
  requires_booking?: boolean;
  final_price: number;
  image_url?: string | null;
  created_at: string;
  updated_at: string;
  brand?: Brand | null;
  categories?: ProductCategory[];
  product_variants?: ProductVariant[];
  product_images?: ProductImage[];
  tax_assignments?: ProductTaxAssignment[];
  total_stock_available?: number;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  name?: string | null;
  attributes?: string | null;
  price_override?: number | null;
  cost_price?: number | null;
  profit_margin?: number | null;
  is_on_sale?: boolean;
  sale_price?: number | null;
  stock_quantity: number;
  track_inventory_override?: boolean | null;
  effective_track_inventory?: boolean;
  image_id?: number | null;
  image?: ProductImage | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: number;
  product_id: number;
  url: string;
  alt_text?: string | null;
  is_main: boolean;
  sort_order: number;
  created_at: string;
}

export interface ProductCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  image_url?: string | null;
  parent_id?: number | null;
  product_count?: number;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  logo_url?: string | null;
  product_count?: number;
}

export interface ProductTaxAssignment {
  id: number;
  product_id: number;
  tax_category_id: number;
  tax_category?: TaxCategory;
}

export interface TaxCategory {
  id: number;
  name: string;
  description?: string | null;
  store_id?: number;
  tax_rates?: TaxRate[];
}

export interface TaxRate {
  id: number;
  name: string;
  rate: number;
  tax_category_id: number;
}

export interface ProductStats {
  total_products: number;
  active_products: number;
  inactive_products: number;
  low_stock_products: number;
  out_of_stock_products: number;
  total_value: number;
  categories_count: number;
  brands_count: number;
}

export interface ProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: ProductState;
  store_id?: number;
  category_id?: number;
  brand_id?: number;
  include_inactive?: boolean;
  pos_optimized?: boolean;
  barcode?: string;
  include_stock?: boolean;
  include_variants?: boolean;
  product_type?: ProductType;
}

export interface StockByLocationDto {
  location_id: number;
  quantity: number;
  notes?: string;
}

export interface CreateProductVariantDto {
  id?: number;
  sku: string;
  name?: string;
  price_override?: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  stock_quantity?: number;
  stock_by_location?: StockByLocationDto[];
  attributes?: Record<string, unknown>;
  track_inventory_override?: boolean | null;
}

export interface CreateProductDto {
  name: string;
  slug?: string;
  description?: string;
  base_price: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  available_for_ecommerce?: boolean;
  sku?: string;
  stock_quantity?: number;
  track_inventory?: boolean;
  state?: ProductState;
  pricing_type?: PricingType;
  product_type?: ProductType;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];
  stock_by_location?: StockByLocationDto[];
  variants?: CreateProductVariantDto[];
  stock_transfer_mode?: 'first' | 'distribute' | 'reset';
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';
}

export type UpdateProductDto = Partial<CreateProductDto>;
