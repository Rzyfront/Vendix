export type ProductState = 'active' | 'inactive' | 'archived';
export type BrandState = 'active' | 'inactive';
export type CategoryState = 'active' | 'inactive';
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
  /**
   * Mapeo de `product_tax_assignments` (nombre en la respuesta del backend).
   * El backend lo devuelve con prefijo `product_` por la relación Prisma.
   */
  product_tax_assignments?: ProductTaxAssignment[];
  total_stock_available?: number;
  /**
   * Código de barras del producto suelto. El de una PRESENTACIÓN vive en
   * `product_price_tier_assignments.barcode`, no acá: la "Caja x12" de dos
   * productos distintos nunca comparte código con la unidad suelta.
   */
  barcode?: string | null;
  /* ============================================================
   * QUI-648 — Unidad de stock, escala de precio y presentaciones
   * ============================================================ */
  /**
   * FK a `units_of_measure`. El stock y `order_items.quantity` viven SIEMPRE
   * en la unidad MÍNIMA de la dimensión (mm, g, ml, unidad).
   */
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  stock_uom?: UnitOfMeasureRef | null;
  purchase_uom?: UnitOfMeasureRef | null;
  purchase_to_stock_factor?: number | null;
  /**
   * "Precio por N unidades de stock", estilo SAP. Un cable medido en
   * milímetros guarda `base_price = 5000` y `price_unit_quantity = 1000` —
   * "$5.000 por metro". El total de una línea es
   * `unit_price × quantity / price_unit_quantity`, redondeado al FINAL.
   *
   * `1` (el default y el valor de todo el catálogo histórico) colapsa la
   * fórmula a la aritmética de siempre: cero regresión.
   *
   * ⚠️ El backend lo expone hoy en `GET /store/products/:id`; el listado puede
   * omitirlo. Toda la aritmética del móvil trata la ausencia como `1`
   * (`resolvePriceUnitQuantity`), así que un listado sin el campo cobra igual
   * que hoy en vez de romperse.
   */
  price_unit_quantity?: number | null;
  /** Frase única que explica cómo se vende. La arma el backend. */
  sale_config_summary?: SaleConfigSummary | null;
  /** El producto participa del sistema de tarifas/presentaciones. */
  has_multiple_price_tiers?: boolean;
  /**
   * Allowlist duro del par (producto, tarifa). El backend rechaza con
   * `PRICE_TIER_NOT_ALLOWED` cualquier tarifa fuera de esta lista, así que el
   * POS no puede ofrecer nada que no esté acá.
   */
  enabled_price_tier_ids?: number[];
  /**
   * Solo en `GET /store/products?barcode=XXXX`: cuál de las presentaciones del
   * producto corresponde al código pistoleado. `null` = se escaneó la unidad
   * suelta.
   */
  scanned_price_tier_id?: number | null;
}

/** Fila de `units_of_measure` tal como la expone el backend. */
export interface UnitOfMeasureRef {
  id: number;
  code: string;
  name: string;
  dimension?: string | null;
  factor_to_base?: number | null;
  is_stock_eligible?: boolean;
}

/**
 * Explicación de cómo se vende un producto, generada por el backend
 * (`sale-config-explainer.util.ts`). Es texto listo para mostrar: el móvil no
 * la reconstruye, solo la pinta.
 */
export interface SaleConfigSummary {
  headline: string;
  lines: string[];
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
  /**
   * URL plana de la imagen específica de la variante. La retorna el
   * backend en el endpoint POS (`products.service.ts` línea ~1193,
   * `image_url: variant.product_images?.image_url`) — es la fuente
   * de verdad para el thumbnail del VariantPicker. Si está ausente,
   * cae al fallback del producto padre (`product.image_url`).
   */
  image_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImage {
  id: number;
  product_id: number;
  /**
   * El backend devuelve `image_url` directamente del modelo Prisma
   * `product_images` (campo firmado si la key no es una URL completa).
   * Históricamente la mobile lo leía como `url` y eso rompía la carga
   * de imágenes al editar un producto.
   */
  image_url: string;
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
  state?: CategoryState;
  is_featured?: boolean;
  store_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  logo_url?: string | null;
  product_count?: number;
  state?: BrandState;
  is_featured?: boolean;
  store_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateBrandDto {
  name: string;
  slug?: string;
  description?: string;
  logo_url?: string;
  state?: BrandState;
  is_featured?: boolean;
}

export type UpdateBrandDto = Partial<CreateBrandDto>;

export interface BrandQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: BrandState;
  is_featured?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface BrandStats {
  total: number;
  active: number;
  inactive: number;
  featured: number;
}

export interface CreateCategoryDto {
  name: string;
  slug?: string;
  description?: string;
  image_url?: string;
  state?: CategoryState;
  is_featured?: boolean;
}

export type UpdateCategoryDto = Partial<CreateCategoryDto>;

export interface CategoryQuery {
  page?: number;
  limit?: number;
  search?: string;
  state?: CategoryState;
  is_featured?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface CategoryStats {
  total: number;
  active: number;
  inactive: number;
  featured: number;
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
  /**
   * Filtros de paridad web `pos-product-search.component.ts`. El backend
   * actualmente NO los declara en `ProductQueryDto`, pero los aceptamos
   * silenciosamente vía `whitelist: false` — el cliente aplica fallback
   * local (sort/inStock) si la respuesta los ignora.
   */
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  sort_by?: 'name' | 'price' | 'stock' | 'createdAt';
  sort_order?: 'asc' | 'desc';
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
  barcode?: string;
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
  /* ===== QUI-648: unidad de stock, escala de precio, presentaciones ===== */
  stock_uom_id?: number | null;
  purchase_uom_id?: number | null;
  /**
   * A cuántas unidades de stock corresponde `base_price`. Entero >= 1; `1` es
   * el default y deja la aritmética histórica intacta.
   */
  price_unit_quantity?: number;
  has_multiple_price_tiers?: boolean;
  enabled_price_tier_ids?: number[];
}

export type UpdateProductDto = Partial<CreateProductDto>;

/**
 * Tarifa de precio (multi-tarifa). El backend devuelve estos registros
 * en `GET /store/price-tiers` con paginación `{ data, meta }`.
 */
export interface PriceTier {
  id: number;
  store_id: number;
  name: string;
  code?: string | null;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  is_package_unit?: boolean;
  units_per_package?: number | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  /**
   * Discriminador de los dos ejes que conviven en la tabla: `customer_tier`
   * ("a quién le vendo") vs `sale_unit` ("en qué presentación vendo"). Los
   * selectores filtran por acá para no mezclarlos.
   */
  kind?: PriceTierKind;
  /** Descuento global de la tarifa cuando el par no tiene override explícito. */
  discount_percentage?: number | string | null;
}

export type PriceTierKind = 'customer_tier' | 'sale_unit';

/**
 * Fila de `product_price_tier_overrides` para un producto.
 * `GET /store/price-tiers/products/:productId/overrides`.
 */
export interface ProductPriceTierOverride {
  price_tier_id: number;
  variant_id?: number | null;
  override_price?: number | string | null;
  override_profit_margin?: number | string | null;
  /** Factor de la presentación para ESTE producto. Gana sobre el de la tarifa. */
  override_units_per_package?: number | null;
}

/* ============================================================
 * Bulk product upload (wizard 3-step: analyze → upload-session)
 * ============================================================
 * Mirror exacto de los DTOs backend en
 * apps/backend/src/domains/store/products/dto/bulk-product-analysis.dto.ts
 * Cualquier divergencia causa data loss silenciosa en el wizard mobile.
 */

export interface BulkValidationMessage {
  code: string;
  message: string;
  field?: string;
}

export interface BulkProductAnalysisItem {
  row_number: number;
  name: string;
  sku: string;
  product_type: 'physical' | 'service';
  base_price: number;
  cost_price: number;
  stock_quantity: number;
  track_inventory?: boolean;
  brand_name?: string;
  brand_will_create: boolean;
  category_names?: string[];
  categories_will_create: string[];
  warehouse_code?: string;
  warehouse_name?: string;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  has_multiple_price_tiers?: boolean;
  action: 'create' | 'update';
  existing_product_id?: number;
  status: 'ready' | 'warning' | 'error';
  warnings: (string | BulkValidationMessage)[];
  errors: (string | BulkValidationMessage)[];
  service_duration_minutes?: number;
  service_modality?: string;
  service_pricing_type?: string;
  requires_booking?: boolean;
  booking_mode?: string;
  buffer_minutes?: number;
  is_recurring?: boolean;
  is_consultation?: boolean;
  send_preconsultation?: boolean;
  consultation_template_id?: number;
  preconsultation_template_id?: number;
  min_stock_level?: number;
  max_stock_level?: number;
  reorder_point?: number;
  reorder_quantity?: number;
  requires_serial_numbers?: boolean;
  requires_batch_tracking?: boolean;
  pricing_type?: string;
  /** Sparse-update preview: fields with new values (not NULL marker). */
  modified_fields?: string[];
  /** Sparse-update preview: fields set to NULL via NULL marker. */
  nulled_fields?: string[];
}

export interface BulkProductAnalysisResult {
  session_id: string;
  total_products: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  products: BulkProductAnalysisItem[];
}

export interface BulkUploadItemResult {
  row_number?: number;
  product_name?: string;
  sku?: string;
  action?: 'create' | 'update';
  product?: unknown;
  status: 'success' | 'error' | 'skipped';
  message: string;
  error?: string;
  error_code?: string;
}

export interface BulkUploadResult {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkUploadItemResult[];
}
