export interface BulkValidationMessage {
  code: string;
  message: string;
  field?: string;
}

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
  warnings: (string | BulkValidationMessage)[];
  errors: (string | BulkValidationMessage)[];
  service_duration_minutes?: number;
  service_modality?: string;
  service_pricing_type?: string;
  requires_booking?: boolean;
  booking_mode?: string;
  buffer_minutes?: number;
  is_recurring?: boolean;
  min_stock_level?: number;
  max_stock_level?: number;
  reorder_point?: number;
  reorder_quantity?: number;
  requires_serial_numbers?: boolean;
  requires_batch_tracking?: boolean;
  pricing_type?: string;
  modified_fields?: string[];
  nulled_fields?: string[];
}

export class BulkProductAnalysisResultDto {
  session_id: string;
  total_products: number;
  ready: number;
  with_warnings: number;
  with_errors: number;
  products: BulkProductAnalysisItemDto[];
}
