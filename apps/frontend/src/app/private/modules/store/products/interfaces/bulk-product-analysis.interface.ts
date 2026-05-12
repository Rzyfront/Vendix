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
  brand_name?: string;
  brand_will_create: boolean;
  category_names?: string[];
  categories_will_create: string[];
  warehouse_code?: string;
  warehouse_name?: string;
  track_inventory?: boolean;
  service_duration_minutes?: number;
  service_modality?: string;
  service_pricing_type?: string;
  requires_booking?: boolean;
  action: 'create' | 'update';
  status: 'ready' | 'warning' | 'error';
  warnings: (string | BulkValidationMessage)[];
  errors: (string | BulkValidationMessage)[];
  modified_fields?: string[];
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

export interface BulkProductUploadItemResult {
  product_name?: string;
  sku?: string;
  action?: 'create' | 'update';
  product: any;
  status: 'success' | 'error' | 'skipped';
  message: string;
}

export interface BulkProductUploadResult {
  success: boolean;
  total_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkProductUploadItemResult[];
}
