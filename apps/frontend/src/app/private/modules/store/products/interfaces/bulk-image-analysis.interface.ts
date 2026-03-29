export interface BulkImageAnalysisSkuItem {
  sku: string;
  sku_found: boolean;
  product_id?: number;
  product_name?: string;
  images_in_zip: number;
  valid_images: number;
  invalid_files: string[];
  current_image_count: number;
  slots_available: number;
  images_to_upload: number;
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

export interface BulkImageAnalysisResult {
  session_id: string;
  total_skus: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  supported_formats: string[];
  skus: BulkImageAnalysisSkuItem[];
}

export interface BulkImageSkuResult {
  sku: string;
  status: 'success' | 'error' | 'skipped';
  message: string;
  images_uploaded: number;
  product_id?: number;
}

export interface BulkImageUploadResult {
  success: boolean;
  total_skus_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkImageSkuResult[];
}
