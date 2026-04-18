export class BulkProductAnalysisItemDto {
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
  action: 'create' | 'update';
  existing_product_id?: number;
  status: 'ready' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

export class BulkProductAnalysisResultDto {
  session_id: string;
  total_products: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  products: BulkProductAnalysisItemDto[];
}
