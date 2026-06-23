export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export enum PricingType {
  UNIT = 'unit',
  WEIGHT = 'weight',
}

export enum ProductType {
  PHYSICAL = 'physical',
  SERVICE = 'service',
}

export enum ServiceModality {
  IN_PERSON = 'in_person',
  VIRTUAL = 'virtual',
  HYBRID = 'hybrid',
}

export enum ServicePricingType {
  PER_HOUR = 'per_hour',
  PER_SESSION = 'per_session',
  PACKAGE = 'package',
  SUBSCRIPTION = 'subscription',
}

export interface Product {
  id: number;
  store_id: number;
  // category_id removed
  brand_id?: number;
  name: string;
  slug: string;
  description?: string;
  base_price: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  min_stock_level?: number | null;
  reorder_point?: number | null;
  low_stock_threshold?: number | null;
  track_inventory?: boolean;
  requires_serial_numbers?: boolean;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  state: ProductState;
  pricing_type?: 'unit' | 'weight';
  product_type?: 'physical' | 'service' | 'prepared';
  service_duration_minutes?: number;
  service_modality?: 'in_person' | 'virtual' | 'hybrid';
  service_pricing_type?:
    | 'per_hour'
    | 'per_session'
    | 'package'
    | 'subscription';
  requires_booking?: boolean;
  booking_mode?: 'provider_required' | 'free_booking';
  buffer_minutes?: number;
  is_recurring?: boolean;
  service_instructions?: string;
  is_consultation?: boolean;
  send_preconsultation?: boolean;
  consultation_template_id?: number;
  preconsultation_template_id?: number | null;
  preparation_time_minutes?: number;
  online_purchase_url?: string | null;
  online_purchase_qr_code?: string | null;
  online_purchase_domain_id?: number | null;
  online_purchase_generated_at?: string | Date | null;
  online_purchase_domain_hostname?: string | null;
  online_purchase_ready?: boolean;
  online_purchase_status_reason?:
    | 'ready'
    | 'ecommerce_not_configured'
    | 'ecommerce_domain_not_active';
  online_purchase_status_message?: string;
  final_price: number;
  // Multi-tarifa (Phase 4): per-product tier overrides.
  // Packaging (units-per-package) now lives on the price tier / override,
  // not on the product.
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
  // ===== Restaurant Suite toggles (Fase A defaults) =====
  // is_sellable=true, is_ingredient=false, is_combo=false, is_batch_produced=false.
  // stock_unit / purchase_unit are nullable for non-restaurant stores.
  is_sellable?: boolean;
  is_ingredient?: boolean;
  is_combo?: boolean;
  is_batch_produced?: boolean;
  stock_unit?: string | null;
  purchase_unit?: string | null;
  purchase_to_stock_factor?: number | null;
  // ===== UoM FKs (Fase UoM) =====
  // The legacy string fields above remain for display/backfill. The FKs
  // below link the product to the global units_of_measure catalog so the
  // UI can validate dimension compatibility and show proper labels.
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  stock_uom?: { id: number; code: string; name: string; dimension: string } | null;
  purchase_uom?: { id: number; code: string; name: string; dimension: string } | null;
  created_at: Date;
  updated_at: Date;

  // Relaciones opcionales
  category?: ProductCategory;
  brand?: Brand;
  variants?: ProductVariant[];
  images?: ProductImage[];
  categories?: ProductCategory[];
  product_categories?: ProductSubCategory[]; // Updated
  product_tax_assignments?: ProductTaxAssignment[]; // Updated
  product_images?: ProductImage[]; // Added
  product_variants?: ProductVariant[]; // Added
  tax_assignments?: ProductTaxAssignment[];
  stock_levels?: StockLevel[];
  inventory_batches?: InventoryBatch[];
  total_stock_available?: number;
  total_stock_reserved?: number;
  image_url?: string; // Main thumbnail URL from API
}

export interface StockLevel {
  id: number;
  product_id: number;
  location_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point?: number;
  max_stock?: number;
  inventory_locations: {
    id: number;
    name: string;
    type: string;
  };
}

export interface InventoryBatch {
  id: number;
  product_id: number;
  location_id: number;
  batch_number: string;
  quantity_initial: number;
  quantity_remaining: number;
  expiry_date?: Date;
  status: string;
  inventory_locations: {
    id: number;
    name: string;
  };
}

export interface ProductSubCategory {
  category_id: number;
  categories: ProductCategory;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  sku: string;
  barcode?: string;
  name?: string;
  attributes?: Record<string, any>;
  price_override?: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  stock_quantity: number;
  track_inventory_override?: boolean | null;
  effective_track_inventory?: boolean;
  service_duration_minutes?: number;
  service_pricing_type?: 'per_session' | 'package' | 'subscription';
  buffer_minutes?: number;
  preparation_time_minutes?: number;
  image_id?: number;
  created_at: Date;
  updated_at: Date;

  // Relaciones opcionales
  product?: Product;
  image?: ProductImage;
}

export interface ProductImage {
  id: number;
  product_id?: number;
  image_url: string;
  is_main?: boolean;

  // Relaciones opcionales
  product?: Product;
}

export type CategoryState = 'active' | 'inactive';
export type BrandState = 'active' | 'inactive';

export interface ProductCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  image_url?: string | null;
  is_featured?: boolean;
  state?: CategoryState;
  store_id?: number | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  logo_url?: string | null;
  is_featured?: boolean;
  state?: BrandState;
  store_id: number;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface CreateCategoryDto {
  name: string;
  slug?: string;
  description?: string;
  image_url?: string;
  is_featured?: boolean;
  state?: CategoryState;
}

export type UpdateCategoryDto = Partial<CreateCategoryDto>;

export interface CreateBrandDto {
  name: string;
  slug?: string;
  description?: string;
  logo_url?: string;
  is_featured?: boolean;
  state?: BrandState;
}

export type UpdateBrandDto = Partial<CreateBrandDto>;

export interface CategoryQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: CategoryState | 'all';
  is_featured?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface BrandQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: BrandState | 'all';
  is_featured?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ProductTaxAssignment {
  product_id: number;
  tax_category_id: number;
  tax_categories?: TaxCategory;
}

export interface TaxCategory {
  id: number;
  name: string;
  description?: string;
  rate?: number; // Keep it as optional if some APIs provide it
  /** Fiscal classification: iva | inc | ica | withholding | reteiva | reteica */
  tax_type?: string;
  tax_rates?: any[]; // Add this to match the API response
  store_id: number;
  created_at: Date;
  updated_at: Date;
}

// DTOs para operaciones
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
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  track_inventory?: boolean;
  requires_serial_numbers?: boolean;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  state?: ProductState;
  pricing_type?: 'unit' | 'weight';
  product_type?: 'physical' | 'service' | 'prepared';
  service_duration_minutes?: number;
  service_modality?: 'in_person' | 'virtual' | 'hybrid';
  service_pricing_type?:
    | 'per_hour'
    | 'per_session'
    | 'package'
    | 'subscription';
  requires_booking?: boolean;
  booking_mode?: 'provider_required' | 'free_booking';
  buffer_minutes?: number;
  is_recurring?: boolean;
  service_instructions?: string;
  is_consultation?: boolean;
  send_preconsultation?: boolean;
  consultation_template_id?: number | null;
  preconsultation_template_id?: number | null;
  preparation_time_minutes?: number;
  // ===== Restaurant Suite toggles (Fase B) =====
  is_sellable?: boolean;
  is_ingredient?: boolean;
  is_combo?: boolean;
  is_batch_produced?: boolean;
  stock_unit?: string | null;
  purchase_unit?: string | null;
  purchase_to_stock_factor?: number | null;
  // ===== UoM FKs (Fase UoM) =====
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];
  images?: CreateProductImageDto[];
  variants?: CreateProductVariantDto[];
  stock_by_location?: StockByLocationDto[];
  stock_transfer_mode?: 'first' | 'distribute' | 'reset';
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';
  // Multi-tarifa (Phase 4). Packaging lives on the tier / override.
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
}

export interface UpdateProductDto {
  name?: string;
  slug?: string;
  description?: string;
  base_price?: number;
  cost_price?: number;
  profit_margin?: number;
  sale_price?: number;
  is_on_sale?: boolean;
  sku?: string;
  barcode?: string;
  stock_quantity?: number;
  track_inventory?: boolean;
  requires_serial_numbers?: boolean;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  state?: ProductState;
  pricing_type?: 'unit' | 'weight';
  product_type?: 'physical' | 'service' | 'prepared';
  service_duration_minutes?: number;
  service_modality?: 'in_person' | 'virtual' | 'hybrid';
  service_pricing_type?:
    | 'per_hour'
    | 'per_session'
    | 'package'
    | 'subscription';
  requires_booking?: boolean;
  booking_mode?: 'provider_required' | 'free_booking';
  buffer_minutes?: number;
  is_recurring?: boolean;
  service_instructions?: string;
  is_consultation?: boolean;
  send_preconsultation?: boolean;
  consultation_template_id?: number | null;
  preconsultation_template_id?: number | null;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];
  images?: CreateProductImageDto[];
  variants?: CreateProductVariantDto[];
  stock_by_location?: StockByLocationDto[];
  stock_transfer_mode?: 'first' | 'distribute' | 'reset';
  variant_removal_stock_mode?: 'first' | 'distribute' | 'reset';
  // Multi-tarifa (Phase 4). Packaging lives on the tier / override.
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
}

export interface CreateProductVariantDto {
  sku: string;
  name?: string;
  price_override?: number | null;
  price?: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  stock_quantity?: number;
  image_id?: number | null;
  attributes?: Record<string, any>;
  variant_image_url?: string | null;
  track_inventory_override?: boolean | null;
  service_duration_minutes?: number;
  service_pricing_type?: 'per_session' | 'package' | 'subscription';
  buffer_minutes?: number;
  preparation_time_minutes?: number;
}

export interface CreateProductImageDto {
  image_url: string;
  is_main?: boolean;
}

export interface StockByLocationDto {
  location_id: number;
  quantity: number;
  notes?: string;
}

// Query DTOs
export interface ProductQueryDto {
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
  product_type?: 'physical' | 'service' | 'prepared';
  // Restaurant Suite (Fase B): client-side filter — backend does not
  // currently accept these in the WHERE clause. They are forwarded anyway
  // so a future server-side filter can be enabled without touching the
  // frontend.
  is_ingredient?: boolean;
  is_sellable?: boolean;
  // Producibles por lote (insumos con stock propio). El form de Producción
  // envía is_batch_produced=true; el backend lo aplica en el WHERE.
  is_batch_produced?: boolean;
}

// Respuestas paginadas
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Estadísticas
export interface ProductStats {
  total_products: number;
  active_products: number;
  inactive_products: number;
  archived_products: number;
  low_stock_products: number;
  out_of_stock_products: number;
  total_value: number;
  categories_count: number;
  brands_count: number;
  products_without_images?: number;
  productsGrowthRate?: number;
  activeProductsGrowthRate?: number;
  lowStockGrowthRate?: number;
  noImagesGrowthRate?: number;
}

export interface OnlinePurchaseLinkResult {
  generated: boolean;
  product_id: number;
  online_purchase_url?: string | null;
  online_purchase_qr_code?: string | null;
  qr_data_url?: string | null;
  online_purchase_domain_id?: number | null;
  domain_hostname?: string | null;
  online_purchase_generated_at?: string | Date | null;
  online_purchase_ready?: boolean;
  online_purchase_status_reason?:
    | 'ready'
    | 'ecommerce_not_configured'
    | 'ecommerce_domain_not_active';
  online_purchase_status_message?: string;
}

// Interface para gestión combinada de producto y variantes
export interface ProductVariantManagement {
  id?: number;
  sku: string;
  name?: string;
  price_override?: number;
  price?: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  stock_quantity?: number;
  image_id?: number;
  image_url?: string;
  attributes?: Record<string, any>;
  attributeValues?: VariantAttributeValue[];
  isEditing?: boolean;
  isDeleted?: boolean;
}

// Interface para gestión combinada de producto y variantes
export interface ProductManagement {
  // Información básica del producto
  id?: number;
  name: string;
  slug?: string;
  description?: string;
  base_price: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  sku?: string;
  stock_quantity?: number;
  track_inventory?: boolean;
  requires_serial_numbers?: boolean;
  state?: ProductState;
  category_id?: number | null;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];

  // Gestión de variantes
  hasVariants: boolean;
  variants?: ProductVariantManagement[];
  variantAttributes?: VariantAttribute[];

  // Imágenes del producto
  images?: CreateProductImageDto[];

  // Control de creación/edición
  isEditing?: boolean;
}

export interface VariantAttribute {
  id?: number;
  name: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  required: boolean;
  options?: string[]; // Para tipo 'select'
}

export interface VariantAttributeValue {
  attribute_id: number;
  attribute_name: string;
  value: string | number | boolean;
}

// DTO para creación/actualización combinada
export interface ProductVariantManagementDto {
  // Datos del producto
  name: string;
  slug?: string;
  description?: string;
  base_price: number;
  cost_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  sku?: string;
  stock_quantity?: number;
  state?: ProductState;
  category_id?: number | null;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];
  images?: CreateProductImageDto[];

  // Datos de variantes
  hasVariants: boolean;
  variantAttributes?: VariantAttribute[];
  variants?: ProductVariantManagement[];
}
