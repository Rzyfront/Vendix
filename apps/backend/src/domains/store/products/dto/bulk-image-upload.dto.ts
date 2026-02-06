export class BulkImageSkuResultDto {
  sku: string;
  status: 'success' | 'error' | 'skipped';
  message: string;
  images_uploaded: number;
  product_id?: number;
}

export class BulkImageUploadResultDto {
  success: boolean;
  total_skus_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkImageSkuResultDto[];
}
