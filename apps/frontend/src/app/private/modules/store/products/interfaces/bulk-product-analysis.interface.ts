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
  action: 'create' | 'update';
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
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
