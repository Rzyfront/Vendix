export type DispatchNoteStatus =
  | 'draft'
  | 'confirmed'
  | 'delivered'
  | 'received'
  | 'invoiced'
  | 'voided';

// ============================================================================
// Bidirectional dispatch notes — direction / subtype / reason
// (ref plan Remisiones Bidireccionales, Fase 3 frontend cimiento)
// ============================================================================

export type DispatchNoteDirection = 'outbound' | 'inbound';

export type DispatchNoteSubtype =
  | 'customer_delivery'
  | 'customer_return'
  | 'transfer_out'
  | 'transfer_in'
  | 'purchase_receipt';

export type DispatchNoteReason =
  // outbound — customer_delivery
  | 'sale'
  | 'sample'
  | 'consignment'
  | 'replacement_shipment'
  | 'loan'
  // outbound — transfer_out
  | 'transfer_to_consignee'
  // inbound — customer_return
  | 'defective'
  | 'wrong_item'
  | 'cancellation'
  | 'warranty'
  | 'overdelivery_return'
  // inbound — transfer_in
  | 'returned_from_consignee'
  // shared between transfer_out / transfer_in
  | 'replenishment'
  | 'rebalancing'
  // inbound — purchase_receipt
  | 'normal_purchase'
  | 'replacement_for_damage'
  | 'sample_received';

/**
 * Map: direction → valid subtypes. Drives the subtype selector in the
 * wizard's Type step. Kept in sync with the plan's direction→subtype table.
 */
export const DISPATCH_SUBTYPE_BY_DIRECTION: Record<
  DispatchNoteDirection,
  DispatchNoteSubtype[]
> = {
  outbound: ['customer_delivery', 'transfer_out'],
  inbound: ['customer_return', 'transfer_in', 'purchase_receipt'],
};

/**
 * Map: subtype → valid reasons. `undefined` means the subtype has no
 * reason selector (reason is nullable / optional). Drives the reason
 * selector in the wizard's Type step.
 */
export const DISPATCH_REASON_BY_SUBTYPE: Record<
  DispatchNoteSubtype,
  DispatchNoteReason[] | undefined
> = {
  customer_delivery: ['sale', 'sample', 'consignment', 'replacement_shipment', 'loan'],
  customer_return: ['defective', 'wrong_item', 'cancellation', 'warranty', 'overdelivery_return'],
  transfer_out: ['replenishment', 'rebalancing', 'transfer_to_consignee'],
  transfer_in: ['replenishment', 'rebalancing', 'returned_from_consignee'],
  purchase_receipt: ['normal_purchase', 'replacement_for_damage', 'sample_received'],
};

export interface DispatchNoteItem {
  id: number;
  dispatch_note_id: number;
  product_id: number;
  product_variant_id?: number;
  location_id?: number;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_price?: number;
  cost_price?: number;
  lot_serial?: string;
  sales_order_item_id?: number;
  created_at: string;
  product?: any;
  product_variant?: any;
  location?: any;
}

export interface DispatchNote {
  id: number;
  store_id: number;
  dispatch_number: string;
  status: DispatchNoteStatus;
  /** Bidirectional fields (ref plan Remisiones Bidireccionales). */
  direction?: DispatchNoteDirection;
  subtype?: DispatchNoteSubtype;
  reason?: DispatchNoteReason | null;
  supplier_id?: number | null;
  related_dispatch_id?: number | null;
  from_location_id?: number | null;
  to_location_id?: number | null;
  customer_id: number;
  customer_name: string;
  customer_tax_id?: string;
  customer_address?: any;
  sales_order_id?: number;
  order_id?: number | null;
  needs_collection?: boolean;
  invoice_id?: number;
  emission_date: string;
  agreed_delivery_date?: string;
  actual_delivery_date?: string;
  dispatch_location_id?: number;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  grand_total: number;
  currency?: string;
  notes?: string;
  internal_notes?: string;
  void_reason?: string;
  created_by_user_id?: number;
  confirmed_by_user_id?: number;
  delivered_by_user_id?: number;
  voided_by_user_id?: number;
  confirmed_at?: string;
  delivered_at?: string;
  voided_at?: string;
  created_at: string;
  updated_at: string;
  dispatch_note_items?: DispatchNoteItem[];
  customer?: any;
  sales_order?: any;
  invoice?: any;
  dispatch_location?: any;
  created_by_user?: any;
  confirmed_by_user?: any;
  delivered_by_user?: any;
  voided_by_user?: any;
  /**
   * Reverse relation: where the dispatch note is currently assigned. A
   * note can be on multiple historical routes (after being released and
   * reassigned), so the consumer should pick the non-released entry as the
   * "active" assignment. Each item carries the route summary so the UI can
   * render a clickable chip with `route_number` without a second query.
   */
  dispatch_route_stops?: Array<{
    id: number;
    route_id: number;
    stop_sequence: number;
    status: 'pending' | 'in_progress' | 'delivered' | 'partial' | 'released' | 'rejected';
    result?: 'delivered' | 'partial' | 'released' | 'rejected' | null;
    route?: {
      id: number;
      route_number: string;
      route_code?: string | null;
      status: string;
    } | null;
  }>;
}

export interface DispatchNoteStats {
  total: number;
  draft: number;
  confirmed: number;
  delivered: number;
  invoiced: number;
  voided: number;
}

export interface DispatchNoteQuery {
  status?: DispatchNoteStatus;
  direction?: DispatchNoteDirection;
  subtype?: DispatchNoteSubtype;
  reason?: DispatchNoteReason;
  customer_id?: number;
  sales_order_id?: number;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedDispatchNotesResponse {
  data: DispatchNote[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateDispatchNoteItemDto {
  product_id: number;
  product_variant_id?: number;
  location_id?: number;
  ordered_quantity: number;
  dispatched_quantity: number;
  unit_price?: number;
  discount_amount?: number;
  tax_amount?: number;
  lot_serial?: string;
  sales_order_item_id?: number;
}

export interface CreateDispatchNoteDto {
  customer_id: number;
  sales_order_id?: number;
  dispatch_location_id?: number;
  emission_date?: string;
  agreed_delivery_date?: string;
  notes?: string;
  internal_notes?: string;
  currency?: string;
  items: CreateDispatchNoteItemDto[];
}

/**
 * QUI-431 — Mirror of backend `ConfirmDispatchNoteItemSerialsDto`. Maps a
 * serialized dispatch-note line to the serials that satisfy it. For each
 * serialized line the backend requires exactly `dispatched_quantity` valid
 * serials (pool-resolved `serial_ids` + free-text `serial_numbers`); otherwise
 * it raises `SERIAL_REQUIRED_001` and leaves the note in draft.
 */
export interface ConfirmDispatchNoteItemSerialsDto {
  /** The `dispatch_note_items.id` of the serialized line. */
  dispatch_note_item_id: number;
  /** In_stock pool serial ids picked for this line. */
  serial_ids?: number[];
  /** Free-text serials (resolved-or-created by the backend) for this line. */
  serial_numbers?: string[];
}

/**
 * QUI-431 — Mirror of backend `ConfirmDispatchNoteDto`. Body for
 * `POST /store/dispatch-notes/:id/confirm`. When the note has no serialized
 * lines, `item_serials` is omitted and the body is `{}`.
 */
export interface ConfirmDispatchNoteDto {
  item_serials?: ConfirmDispatchNoteItemSerialsDto[];
}

/**
 * Mirror of backend `CreateFromOrderItemDto` (apps/backend/.../dto/create-from-order.dto.ts).
 * Items are keyed by `order_item_id` + the quantity to dispatch.
 */
export interface CreateDispatchFromOrderItemDto {
  order_item_id: number;
  dispatched_quantity: number;
  location_id?: number;
  lot_serial?: string;
}

/**
 * Mirror of backend `NewRouteDto` (apps/backend/.../dto/create-from-order.dto.ts).
 * Subset of CreateDispatchRouteDto used when creating a brand-new route inline
 * from the dispatch-note creation flow. Stops are derived from the dispatch
 * note; assistants are passed as a flat list of user ids (`assistant_ids`).
 */
export interface CreateDispatchFromOrderNewRouteDto {
  driver_user_id: number;
  planned_date: string;
  vehicle_id?: number;
  assistant_ids?: number[];
  route_code?: string;
  external_driver_name?: string;
  external_driver_id_number?: string;
  is_primary_driver_external?: boolean;
  origin_location_id?: number;
  currency?: string;
  notes?: string;
}

/**
 * Mirror of backend `RouteAssignmentDto`. Determines whether the created
 * dispatch note is left unassigned (`none`), attached to an existing route
 * (`existing` + `route_id`), or attached to a brand-new route created in the
 * same transaction (`new` + `new_route`).
 */
export interface CreateDispatchFromOrderRouteAssignmentDto {
  mode: 'none' | 'existing' | 'new';
  /** Required ONLY when mode === 'existing'. */
  route_id?: number;
  /** Required ONLY when mode === 'new'. */
  new_route?: CreateDispatchFromOrderNewRouteDto;
}

/**
 * Mirror of backend `CreateFromOrderDto`. Body for
 * `POST /store/dispatch-notes/from-order/:orderId`.
 */
export interface CreateDispatchFromOrderDto {
  /** Target status of the created dispatch note. Defaults to `draft`. */
  target_status?: 'draft' | 'confirmed';
  dispatch_location_id?: number;
  agreed_delivery_date?: string;
  notes?: string;
  route_assignment?: CreateDispatchFromOrderRouteAssignmentDto;
  items: CreateDispatchFromOrderItemDto[];
}

// ============================================================================
// Bidirectional DTOs — mirrors of backend DTOs to be created in Fase 1.
// Frontend cimiento only; HTTP wiring deferred until backend exposes endpoints.
// ============================================================================

/**
 * Body for creating a transfer dispatch note (outbound or inbound).
 * `direction` determines whether origin is `from_location_id` (outbound) or
 * destination is `to_location_id` (inbound). Cross-store scope validation
 * is delegated to the backend.
 */
export interface CreateTransferDispatchDto {
  direction: DispatchNoteDirection;
  subtype: 'transfer_out' | 'transfer_in';
  reason?: DispatchNoteReason;
  from_location_id?: number;
  to_location_id?: number;
  dispatch_location_id?: number;
  notes?: string;
  internal_notes?: string;
  currency?: string;
  items: CreateDispatchNoteItemDto[];
  target_status?: 'draft' | 'confirmed';
}

/**
 * Body for creating a customer return dispatch note (inbound). Links the
 * return to the original dispatch via `related_dispatch_id` and delegates
 * financial processing to `ReturnOrdersService` on the backend.
 */
export interface CreateReturnDispatchDto {
  direction: 'inbound';
  subtype: 'customer_return';
  reason?: DispatchNoteReason;
  customer_id: number;
  related_dispatch_id?: number;
  related_order_id?: number;
  dispatch_location_id?: number;
  notes?: string;
  internal_notes?: string;
  currency?: string;
  items: CreateDispatchNoteItemDto[];
  target_status?: 'draft' | 'confirmed';
}

/**
 * Body for creating a purchase receipt dispatch note (inbound). When
 * `purchase_order_id` is present the backend delegates to
 * `PurchaseOrdersService.receive`; otherwise it emits its own `stock_in`
 * movement.
 */
export interface CreatePurchaseReceiptDispatchDto {
  direction: 'inbound';
  subtype: 'purchase_receipt';
  reason?: DispatchNoteReason;
  supplier_id: number;
  purchase_order_id?: number;
  dispatch_location_id?: number;
  notes?: string;
  internal_notes?: string;
  currency?: string;
  items: CreateDispatchNoteItemDto[];
  target_status?: 'draft' | 'confirmed';
}
