export interface CreateAdjustmentDto {
  organizationId: number;
  productId: number;
  variantId?: number;
  locationId: number;
  type:
    | 'damage'
    | 'loss'
    | 'theft'
    | 'expiration'
    | 'count_variance'
    | 'manual_correction';
  quantityAfter: number;
  reasonCode?: string;
  description?: string;
  createdByUserId: number;
  approvedByUserId?: number;
}

export interface AdjustmentQueryDto {
  organizationId?: number;
  productId?: number;
  variantId?: number;
  locationId?: number;
  type?:
    | 'damage'
    | 'loss'
    | 'theft'
    | 'expiration'
    | 'count_variance'
    | 'manual_correction';
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
  adjustment_type:
    | 'damage'
    | 'loss'
    | 'theft'
    | 'expiration'
    | 'count_variance'
    | 'manual_correction';
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
  products?: {
    id: number;
    name: string;
    sku: string | null;
  };
  product_variants?: {
    id: number;
    sku: string;
  } | null;
  inventory_locations?: {
    id: number;
    name: string;
    code: string;
  };
  organizations?: {
    id: number;
    name: string;
  };
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
