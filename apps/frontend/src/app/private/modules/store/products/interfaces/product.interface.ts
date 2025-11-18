export enum ProductState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
}

export interface Product {
  id: number;
  store_id: number;
  category_id?: number;
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
  tax_assignments?: ProductTaxAssignment[];
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
  category_id?: number;
  brand_id?: number;
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
  category_id?: number;
  brand_id?: number;
  category_ids?: number[];
  tax_category_ids?: number[];
}

export interface CreateProductVariantDto {
  sku: string;
  price_override?: number;
  stock_quantity: number;
  image_id?: number;
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
