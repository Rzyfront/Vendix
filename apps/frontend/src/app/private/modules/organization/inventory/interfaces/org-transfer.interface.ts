/**
 * Frontend interfaces for the org-level stock transfers domain.
 *
 * Mirrors the backend response shape produced by `OrgTransfersService` and
 * the DTOs accepted by `OrgTransfersController` under
 * `/api/organization/inventory/transfers`.
 *
 * Status backward-compat: the backend folds physical legacy enum values
 * (`draft` / `completed`) into logical states (`pending` / `received`) before
 * returning, so the UI only needs to handle the new lifecycle. We keep the
 * legacy values in the union type so historical rows that escape the mapping
 * still render gracefully.
 */

export type OrgTransferStatus =
  | 'pending'
  | 'approved'
  | 'in_transit'
  | 'received'
  | 'cancelled'
  // Legacy values that may slip through if a backend mapping bug occurs.
  | 'draft'
  | 'completed';

export interface OrgTransferLocationRef {
  id: number;
  name: string;
  code?: string | null;
  store_id?: number | null;
}

export interface OrgTransferItem {
  id: number;
  stock_transfer_id: number;
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
  quantity_received: number;
  cost_per_unit?: number | string | null;
  notes?: string | null;
  received_date?: string | null;
  products?: { id: number; name: string; sku?: string | null } | null;
  product_variants?: { id: number; name?: string | null; sku?: string | null } | null;
}

export interface OrgTransfer {
  id: number;
  organization_id: number;
  transfer_number: string;
  from_location_id: number;
  to_location_id: number;
  status: OrgTransferStatus;
  transfer_date?: string | null;
  expected_date?: string | null;
  approved_at?: string | null;
  dispatched_at?: string | null;
  completed_date?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  approved_by_user_id?: number | null;
  dispatched_by_user_id?: number | null;
  cancelled_by_user_id?: number | null;
  created_at?: string;
  updated_at?: string;
  from_location?: OrgTransferLocationRef | null;
  to_location?: OrgTransferLocationRef | null;
  stock_transfer_items: OrgTransferItem[];
}

export interface OrgTransferStats {
  total: number;
  pending: number;
  approved: number;
  in_transit: number;
  received: number;
  cancelled: number;
}

export interface OrgTransferQuery {
  page?: number;
  limit?: number;
  status?: OrgTransferStatus;
  store_id?: number;
  from_location_id?: number;
  to_location_id?: number;
  product_id?: number;
  transfer_date_from?: string;
  transfer_date_to?: string;
  search?: string;
  sort_by?: 'transfer_date' | 'created_at' | 'transfer_number';
  sort_order?: 'asc' | 'desc';
}

export interface CreateOrgTransferItemRequest {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  cost_per_unit?: number;
  notes?: string;
}

export interface CreateOrgTransferRequest {
  from_location_id: number;
  to_location_id: number;
  expected_date?: string;
  notes?: string;
  items: CreateOrgTransferItemRequest[];
}

export interface CompleteOrgTransferItemRequest {
  stock_transfer_item_id: number;
  quantity_received: number;
}

export interface CompleteOrgTransferRequest {
  items: CompleteOrgTransferItemRequest[];
  notes?: string;
}

export interface DispatchOrgTransferRequest {
  notes?: string;
}

export interface CancelOrgTransferRequest {
  reason?: string;
}

/**
 * Folds the legacy enum values (`draft` / `completed`) into the canonical
 * five-state lifecycle the UI knows about. The backend already does this on
 * read, but consumers should use this helper when storing or comparing the
 * status (e.g. status filter buttons, badges).
 */
export function normalizeOrgTransferStatus(
  status: OrgTransferStatus | string | null | undefined,
): Exclude<OrgTransferStatus, 'draft' | 'completed'> {
  switch (status) {
    case 'draft':
      return 'pending';
    case 'completed':
      return 'received';
    case 'pending':
    case 'approved':
    case 'in_transit':
    case 'received':
    case 'cancelled':
      return status;
    default:
      return 'pending';
  }
}
