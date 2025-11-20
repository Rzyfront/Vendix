import {
  Product,
  ProductImage,
  CreateProductDto,
  CreateProductVariantDto,
  CreateProductImageDto,
  ProductCategory,
  Brand,
} from './product.interface';

// Variant configuration options
export interface VariantOption {
  id: string;
  name: string;
  values: string[];
}

export interface VariantConfiguration {
  options: VariantOption[];
  combinations: VariantCombination[];
}

export interface VariantCombination {
  id: string;
  options: { [key: string]: string }; // option_name: value
  sku?: string;
  price?: number;
  stock?: number;
  image?: string;
}

// Enhanced product creation with variants
export interface CreateProductWithVariantsDto extends CreateProductDto {
  has_variants: boolean;
  variant_config?: VariantConfiguration;
  variants?: CreateProductVariantDto[];
}

// Enhanced product update
export interface UpdateProductWithVariantsDto {
  name?: string;
  slug?: string;
  description?: string;
  base_price?: number;
  sku?: string;
  stock_quantity?: number;
  state?: 'active' | 'inactive' | 'archived';
  category_id?: number;
  brand_id?: number;
  category_ids?: number[];
  tax_category_ids?: number[];
  has_variants?: boolean;
  variant_config?: VariantConfiguration;
  variants?: CreateProductVariantDto[];
}

// Product with full variant information
export interface ProductWithVariants extends Product {
  has_variants: boolean;
  variant_config?: VariantConfiguration;
  variant_count: number;
  total_stock: number;
  min_price: number;
  max_price: number;
}

// Variant management
export interface VariantManagementState {
  mode: 'simple' | 'variant';
  options: VariantOption[];
  combinations: VariantCombination[];
  selectedCombinations: string[];
  bulkEdit: boolean;
}

// Image management
export interface ImageManagementState {
  images: ProductImage[];
  uploading: boolean;
  selectedImages: number[];
  dragActive: boolean;
}

// Category and brand management
export interface CategoryBrandState {
  categories: ProductCategory[];
  brands: Brand[];
  loading: boolean;
  error?: string;
}

// Form validation
export interface ProductFormErrors {
  name?: string;
  base_price?: string;
  category_id?: string;
  brand_id?: string;
  variants?: {
    [combinationId: string]: { sku?: string; price?: string; stock?: string };
  };
}

// UI State
export interface ProductManagementUIState {
  activeTab: 'basic' | 'variants' | 'images' | 'categories' | 'inventory';
  isSubmitting: boolean;
  isDirty: boolean;
  showPreview: boolean;
  validationErrors: ProductFormErrors;
}

// Complete product management state
export interface ProductManagementState {
  product: ProductWithVariants | null;
  variantManagement: VariantManagementState;
  imageManagement: ImageManagementState;
  categoryBrandState: CategoryBrandState;
  ui: ProductManagementUIState;
}

// Events
export interface ProductManagementEvent {
  type:
    | 'product_update'
    | 'variant_add'
    | 'variant_remove'
    | 'variant_update'
    | 'image_add'
    | 'image_remove'
    | 'image_reorder'
    | 'category_change'
    | 'brand_change';
  payload: any;
}

// Quick actions
export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

// Bulk operations
export interface BulkOperation {
  type: 'price_update' | 'stock_update' | 'status_update' | 'delete';
  selectedIds: string[];
  data: any;
}

// Import/Export
export interface ProductImportData {
  name: string;
  sku?: string;
  base_price: number;
  stock_quantity?: number;
  category?: string;
  brand?: string;
  description?: string;
  variants?: {
    sku: string;
    price_override?: number;
    stock_quantity: number;
    options: { [key: string]: string };
  }[];
}

export interface ProductExportData {
  id: number;
  name: string;
  sku: string;
  base_price: number;
  stock_quantity: number;
  category?: string;
  brand?: string;
  state: string;
  created_at: string;
  variants?: {
    sku: string;
    price_override: number;
    stock_quantity: number;
  }[];
}

// Search and filter
export interface ProductSearchFilter {
  query?: string;
  category_id?: number;
  brand_id?: number;
  state?: string;
  price_range?: { min: number; max: number };
  stock_range?: { min: number; max: number };
  has_variants?: boolean;
  date_range?: { start: Date; end: Date };
}

// Statistics
export interface ProductVariantStats {
  total_variants: number;
  active_variants: number;
  inactive_variants: number;
  low_stock_variants: number;
  out_of_stock_variants: number;
  average_price: number;
  price_range: { min: number; max: number };
  total_stock: number;
}

// API Responses
export interface ProductVariantResponse {
  data: ProductWithVariants[];
  stats: ProductVariantStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Component interfaces
export interface ProductVariantManagerComponent {
  product: ProductWithVariants;
  onProductUpdate: (product: ProductWithVariants) => void;
  onVariantCreate: (variant: CreateProductVariantDto) => void;
  onVariantUpdate: (
    id: number,
    variant: Partial<CreateProductVariantDto>,
  ) => void;
  onVariantDelete: (id: number) => void;
}

export interface ProductImageManagerComponent {
  productId: number;
  images: ProductImage[];
  onImageAdd: (image: CreateProductImageDto) => void;
  onImageRemove: (imageId: number) => void;
  onImageReorder: (imageIds: number[]) => void;
  onMainImageChange: (imageId: number) => void;
}

// Utility types
export type VariantOptionMap = { [optionName: string]: string[] };
export type VariantCombinationMap = {
  [combinationId: string]: VariantCombination;
};
export type ProductFormData = Partial<CreateProductWithVariantsDto>;
