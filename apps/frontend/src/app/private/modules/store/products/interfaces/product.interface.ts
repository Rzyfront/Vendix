export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
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
  sku?: string;
  stock_quantity?: number;
  state: ProductState;
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
  price_override?: number;
  stock_quantity: number;
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

export interface ProductCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  store_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  description?: string;
  logo_url?: string;
  store_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProductTaxAssignment {
  product_id: number;
  tax_category_id: number;
  tax_category?: TaxCategory;
}

export interface TaxCategory {
  id: number;
  name: string;
  description?: string;
  rate: number;
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
  sku?: string;
  stock_quantity?: number;
  state?: ProductState;
  brand_id?: number | null;
  category_ids?: number[];
  tax_category_ids?: number[];
  images?: CreateProductImageDto[];
  variants?: CreateProductVariantDto[];
  stock_by_location?: StockByLocationDto[];
}

export interface UpdateProductDto {
  name?: string;
  slug?: string;
  description?: string;
  base_price?: number;
  sku?: string;
  stock_quantity?: number;
  state?: ProductState;
  brand_id?: number;
  category_ids?: number[];
  tax_category_ids?: number[];
  images?: CreateProductImageDto[];
}

export interface CreateProductVariantDto {
  sku: string;
  name?: string;
  price_override?: number;
  price?: number;
  stock_quantity: number;
  image_id?: number;
  attributes?: Record<string, any>;
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

export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
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

// Interface para gestión combinada de producto y variantes
export interface ProductVariantManagement {
  id?: number;
  sku: string;
  name?: string;
  price_override?: number;
  price?: number;
  stock_quantity: number;
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
  sku?: string;
  stock_quantity?: number;
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

// UI interfaces for selectors and filters
export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

// UI interfaces for selectors (following orders pattern)
export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

// UI interfaces - Para selectores y filtros
export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

// DTO para creación/actualización combinada
export interface ProductVariantManagementDto {
  // Datos del producto
  name: string;
  slug?: string;
  description?: string;
  base_price: number;
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
