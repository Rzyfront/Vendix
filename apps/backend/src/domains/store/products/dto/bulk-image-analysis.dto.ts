export class BulkImageAnalysisSkuDto {
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

export class BulkImageAnalysisResultDto {
  session_id: string;
  total_skus: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  supported_formats: string[];
  skus: BulkImageAnalysisSkuDto[];
}
