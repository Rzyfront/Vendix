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
  | 'completed'
  // D4 — recepción parcial (sigue con saldo en camino) y cierre con pérdida.
  | 'partially_received'
  | 'closed_with_loss';

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
  /** Conteo de salida (D3). Null en filas históricas: salió `quantity`. */
  quantity_dispatched?: number | null;
  /** Unidades dadas de baja en un cierre con pérdida (D4). */
  quantity_lost?: number | null;
  /** Lote de la fila (D5). */
  batch_id?: number | null;
  inventory_batches?: {
    id: number;
    batch_number: string;
    expiration_date?: string | null;
  } | null;
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
  /** D8 — null en una salida a destino externo (no hay bodega de destino). */
  to_location_id: number | null;
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
  is_external_destination?: boolean;
  external_destination_name?: string | null;
  external_destination_tax_id?: string | null;
  external_destination_address?: string | null;
  /** D3 — null en filas del flujo anterior. */
  movement_mode?: 'quick' | 'mass_only' | 'with_dispatch_notes' | null;
  support_document_type?: string | null;
  support_document_id?: string | null;
  exit_reason?: string | null;
  /** D8 — salida externa sin documento soporte ni motivo. */
  no_support_alert?: boolean;
  transport_method?: string | null;
  driver_name?: string | null;
  carrier_name?: string | null;
  tracking_number?: string | null;
  shipping_cost?: number | string | null;
  loss_reason?: string | null;
  dispatch_note?: OrgTransferLinkedNote | null;
  receipt_note?: OrgTransferLinkedNote | null;
  stock_transfer_items: OrgTransferItem[];
}

/** Remisión ligada a la transferencia (`transfer_out` / `transfer_in`). */
export interface OrgTransferLinkedNote {
  id: number;
  dispatch_number: string;
  status?: string | null;
  subtype?: string | null;
  emission_date?: string | null;
  store_id?: number | null;
  store?: { id: number; name: string } | null;
}

/** Saldo por recibir de una línea: lo que salió menos lo recibido y lo perdido. */
export function orgTransferItemPending(item: OrgTransferItem): number {
  const dispatched = item.quantity_dispatched ?? item.quantity;
  return Math.max(
    0,
    dispatched - (item.quantity_received ?? 0) - (item.quantity_lost ?? 0),
  );
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
  /** D8 — solo salidas externas con alerta. */
  with_alert?: boolean;
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
  /** Conteo de salida por línea y lote (D3/D5). Sin `items` sale lo pedido. */
  items?: Array<{ id: number; quantity_dispatched: number; batch_id?: number }>;
}

export interface CloseOrgTransferWithLossRequest {
  reason: string;
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
    case 'partially_received':
    case 'closed_with_loss':
      return status;
    default:
      return 'pending';
  }
}
