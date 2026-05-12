/**
 * Frontend interfaces for the org-level inventory adjustments domain.
 *
 * Mirrors the backend response shape produced by `OrgAdjustmentsService` and
 * the DTOs accepted by `OrgAdjustmentsController` under
 * `/api/organization/inventory/adjustments`.
 */

export type OrgAdjustmentType =
  | 'damage'
  | 'loss'
  | 'theft'
  | 'expiration'
  | 'count_variance'
  | 'manual_correction';

export type OrgAdjustmentStatus = 'pending' | 'approved' | 'cancelled';

export interface OrgAdjustment {
  id: number;
  organization_id: number;
  product_id: number;
  product_variant_id?: number | null;
  location_id: number;
  batch_id?: number | null;
  adjustment_type: OrgAdjustmentType;
  quantity_before: number;
  quantity_after: number;
  quantity_change: number;
  reason_code?: string | null;
  description?: string | null;
  created_by_user_id?: number | null;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  created_at?: string;

  products?: { id: number; name: string; sku?: string | null } | null;
  product_variants?: { id: number; sku?: string | null; name?: string | null } | null;
  inventory_locations?: {
    id: number;
    name: string;
    code?: string | null;
    type?: string | null;
    store_id?: number | null;
    is_central_warehouse?: boolean | null;
  } | null;
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date?: string | null;
    quantity: number;
    quantity_used: number;
  } | null;
  organizations?: { id: number; name: string } | null;
  users_inventory_adjustments_created_by_user_idTousers?: {
    id: number;
    username?: string | null;
    email?: string | null;
  } | null;
  users_inventory_adjustments_approved_by_user_idTousers?: {
    id: number;
    username?: string | null;
    email?: string | null;
  } | null;
}

export interface OrgAdjustmentQuery {
  page?: number;
  limit?: number;
  offset?: number;
  store_id?: number;
  location_id?: number;
  product_id?: number;
  product_variant_id?: number;
  batch_id?: number;
  type?: OrgAdjustmentType;
  status?: 'pending' | 'approved';
  created_by_user_id?: number;
  approved_by_user_id?: number;
  start_date?: string;
  end_date?: string;
  search?: string;
  sort_by?: 'created_at' | 'approved_at' | 'quantity_change';
  sort_order?: 'asc' | 'desc';
}

/**
 * Single-row adjustment create payload accepted by `POST /adjustments`.
 * Mirrors `CreateOrgAdjustmentDto`.
 */
export interface CreateOrgAdjustmentRequest {
  product_id: number;
  product_variant_id?: number;
  location_id: number;
  batch_id?: number;
  type: OrgAdjustmentType;
  quantity_after: number;
  reason_code?: string;
  description?: string;
  /** When true, the adjustment lands as approved. Defaults to false. */
  auto_approve?: boolean;
}

/**
 * Bulk variant accepted by `POST /adjustments/bulk`. All items target the
 * same `location_id`. Mirrors `CreateOrgAdjustmentBulkDto`.
 */
export interface CreateOrgAdjustmentBulkRequest {
  location_id: number;
  items: {
    product_id: number;
    product_variant_id?: number;
    batch_id?: number;
    type: OrgAdjustmentType;
    quantity_after: number;
    reason_code?: string;
    description?: string;
  }[];
  auto_approve?: boolean;
  reason?: string;
}
