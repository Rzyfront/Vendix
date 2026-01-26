export type AdjustmentType =
  | 'damage'
  | 'loss'
  | 'theft'
  | 'expiration'
  | 'count_variance'
  | 'manual_correction';

export interface CreateAdjustmentDto {
  organization_id: number;
  product_id: number;
  product_variant_id?: number;
  location_id: number;
  batch_id?: number; // Optional: adjust specific batch
  type: AdjustmentType;
  quantity_after: number;
  reason_code?: string;
  description?: string;
  created_by_user_id: number;
  approved_by_user_id?: number;
}

export interface AdjustmentQueryDto {
  organizationId?: number;
  productId?: number;
  variantId?: number;
  locationId?: number;
  batchId?: number;
  type?: AdjustmentType;
  status?: 'pending' | 'approved';
  createdByUserId?: number;
  startDate?: Date;
  endDate?: Date;
  offset?: number;
  limit?: number;
}

export interface InventoryAdjustment {
  id: number;
  organization_id: number;
  product_id: number;
  product_variant_id: number | null;
  location_id: number;
  batch_id: number | null;
  adjustment_type: AdjustmentType;
  quantity_before: number;
  quantity_after: number;
  quantity_change: number;
  reason_code: string | null;
  description: string | null;
  approved_by_user_id: number | null;
  created_by_user_id: number | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // Relations
  products?: {
    id: number;
    name: string;
    sku: string | null;
  };
  product_variants?: {
    id: number;
    sku: string;
    name: string | null;
  } | null;
  inventory_locations?: {
    id: number;
    name: string;
    code: string;
    type: string;
  };
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date: Date | null;
    quantity: number;
    quantity_used: number;
  } | null;
  organizations?: {
    id: number;
    name: string;
  };
  created_by_user?: {
    id: number;
    user_name: string;
    email: string;
  } | null;
  approved_by_user?: {
    id: number;
    user_name: string;
    email: string;
  } | null;
}

export interface AdjustmentResponse {
  adjustments: InventoryAdjustment[];
  total: number;
  hasMore: boolean;
}

export interface AdjustmentSummary {
  type: string;
  totalQuantity: number;
  adjustmentCount: number;
}
