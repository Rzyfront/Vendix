export interface InventoryBatch {
  id: string;
  batch_number: string;
  product_id: string;
  product_variant_id?: string;
  quantity: number;
  quantity_available: number;
  unit_cost: number;
  expiration_date?: Date;
  manufacture_date?: Date;
  location_id: string;
  organization_id: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export class CreateBatchDto {
  batch_code: string;
  batchNumber?: string;
  product_id: number;
  productId?: number;
  quantity: number;
  product_variant_id?: number;
  variantId?: number;
  location_id?: number;
  locationId?: number;
  manufacturing_date?: Date;
  manufacturingDate?: Date;
  expiry_date?: Date;
  expirationDate?: Date;
  notes?: string;
  userId?: number;
}

export class BatchQueryDto {
  page?: number;
  limit?: number;
  product_id?: number;
  productId?: number;
  product_variant_id?: number;
  variantId?: number;
  location_id?: number;
  locationId?: number;
  status?: string;
  search?: string;
  batchNumber?: string;
  expiring?: number;
  manufacturingDate?: Date;
  expirationDate?: Date;
  offset?: number;
}

export class BatchResponse {
  batches?: any[];
  hasMore?: boolean;
  total?: number;
  id: number;
  batch_code: string;
  product_id: number;
  quantity: number;
  quantity_remaining: number;
  manufacturing_date?: Date;
  expiry_date?: Date;
  status: string;
  notes?: string;
  created_at: Date;
  updated_at: Date;
}

export class BatchExpiringItem {
  id: number;
  batch_code: string;
  product_name: string;
  quantity_remaining: number;
  expiry_date: Date;
  days_until_expiry: number;
}
