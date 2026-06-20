export type DispatchRouteStatus =
  | 'draft'
  | 'dispatched'
  | 'in_transit'
  | 'settling'
  | 'closed'
  | 'voided';

export type DispatchRouteStopStatus =
  | 'pending'
  | 'in_progress'
  | 'delivered'
  | 'partial'
  | 'rejected'
  | 'released';

export type DispatchRouteStopResult =
  | 'delivered'
  | 'partial'
  | 'rejected'
  | 'released';

export interface Vehicle {
  id: number;
  plate: string;
  type?: string;
  brand?: string;
  model_name?: string;
}

export interface DriverUser {
  id: number;
  first_name?: string;
  last_name?: string;
  document_number?: string;
}

export interface DispatchNoteSalesOrderSummary {
  id: number;
  order_number?: string;
  status?: string;
}

export interface DispatchNoteSummary {
  id: number;
  dispatch_number: string;
  customer_id: number;
  customer_name?: string;
  grand_total: string | number;
  status: string;
  sales_order_id?: number | null;
  /**
   * Linked sales order summary (`{ id, order_number, status }`) returned by the
   * backend `DISPATCH_ROUTE_INCLUDE`. Present only when the dispatch note was
   * generated from a sales order (COD flow). Used to surface the
   * "Orden pendiente de pago" chip on the planilla detail.
   */
  sales_order?: DispatchNoteSalesOrderSummary | null;
  /**
   * Customer summary (subset of the parent `customer` user) — used by the
   * settle modal to surface the withholding-agent banner and by the
   * backend to re-validate the rule.
   */
  customer?: {
    is_withholding_agent?: boolean;
  } | null;
  /**
   * Convenience top-level alias of `customer.is_withholding_agent`,
   * mirrored on the response for legacy code paths. Prefer the nested
   * `customer` accessor in new code.
   */
  customer_is_withholding_agent?: boolean;
}

export interface DispatchRouteStop {
  id: number;
  route_id: number;
  dispatch_note_id: number;
  stop_sequence: number;
  status: DispatchRouteStopStatus;
  result?: DispatchRouteStopResult | null;
  is_extra_route: boolean;
  is_prepaid: boolean;
  /**
   * Optional flag indicating the stop still requires cash collection (COD).
   * Not a persisted backend column today — the detail page derives it from
   * `is_prepaid`, the stop `status`/`result`, and `collected_amount`. Kept
   * optional so a future backend summary can populate it without breaking the
   * derived fallback.
   */
  needs_collection?: boolean;
  collected_amount: string | number;
  anticipo_amount: string | number;
  change_amount: string | number;
  withholding_amount: string | number;
  withholding_breakdown?: { retefuente?: number; reteiva?: number; reteica?: number } | null;
  credit_amount: string | number;
  payment_method?: string | null;
  notes?: string | null;
  settled_at?: string | null;
  released_at?: string | null;
  dispatch_note?: DispatchNoteSummary | null;
}

export interface DispatchRoute {
  id: number;
  store_id: number;
  route_number: string;
  route_code?: string | null;
  status: DispatchRouteStatus;
  vehicle_id?: number | null;
  driver_user_id?: number | null;
  external_driver_name?: string | null;
  external_driver_id_number?: string | null;
  is_primary_driver_external: boolean;
  assistants?: any;
  origin_location_id?: number | null;
  planned_date: string;
  dispatch_started_at?: string | null;
  closed_at?: string | null;
  voided_at?: string | null;
  total_to_collect: string | number;
  total_collected: string | number;
  total_prepaid: string | number;
  total_changes: string | number;
  total_withholdings: string | number;
  total_credit: string | number;
  declared_cash?: string | number | null;
  cash_variance?: string | number | null;
  currency?: string | null;
  notes?: string | null;
  void_reason?: string | null;
  vehicle?: Vehicle | null;
  driver_user?: DriverUser | null;
  stops?: DispatchRouteStop[];
  _count?: { stops?: number };
}

export interface DispatchRouteStats {
  total: number;
  draft: number;
  dispatched: number;
  in_transit: number;
  closed: number;
  voided: number;
  total_to_collect: number;
  total_collected: number;
  total_cash_variance: number;
}

export interface DispatchRouteQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: DispatchRouteStatus;
  vehicle_id?: number;
  driver_user_id?: number;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedDispatchRoutesResponse {
  data: DispatchRoute[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface SettleStopDto {
  result: DispatchRouteStopResult;
  collected_amount?: number;
  anticipo_amount?: number;
  change_amount?: number;
  withholding_amount?: number;
  withholding_breakdown?: { retefuente?: number; reteiva?: number; reteica?: number };
  payment_method?: string;
  notes?: string;
}

export interface CreateStopDto {
  dispatch_note_id: number;
  stop_sequence: number;
  is_extra_route?: boolean;
}

export interface CreateDispatchRouteDto {
  route_code?: string;
  vehicle_id?: number;
  driver_user_id?: number;
  external_driver_name?: string;
  external_driver_id_number?: string;
  is_primary_driver_external?: boolean;
  assistants?: any[];
  origin_location_id?: number;
  planned_date: string;
  currency?: string;
  notes?: string;
  stops: CreateStopDto[];
}

export interface CloseDispatchRouteDto {
  declared_cash: number;
  notes?: string;
}

export interface VoidDispatchRouteDto {
  reason: string;
  /** Optional free-form notes (mirrors CloseDispatchRouteDto.notes). */
  notes?: string;
}

export interface ReleaseStopDto {
  reason: string;
}

// ============================================================================
// Route-sheet AI scanner (mirror of backend `scan-route-sheet.dto.ts`)
// ============================================================================

/** One extracted row from the AI scan of a physical/photo route sheet. */
export interface RouteSheetScanStop {
  stop_sequence: number;
  remision_number: string | null;
  delivered: boolean;
  collected_amount: number | null;
  payment_method: string | null;
  notes: string | null;
}

/** `POST /scan` → normalized AI extraction. */
export interface RouteSheetScanResult {
  stops: RouteSheetScanStop[];
  confidence: number;
}

/** How an extracted row was resolved to a real stop. */
export type RouteSheetMatchMethod = 'remision' | 'sequence' | 'none';

/** Current persisted state of the resolved stop (actual side of the diff). */
export interface RouteSheetCurrentStop {
  status: string;
  result: string | null;
  grand_total: number;
  collected_amount: number;
}

/** One proposed match: extracted row + resolved real stop + suggested result. */
export interface RouteSheetMatchedStop {
  extracted: RouteSheetScanStop;
  stop_id: number | null;
  stop_sequence: number | null;
  remision_number: string | null;
  match_method: RouteSheetMatchMethod;
  current: RouteSheetCurrentStop | null;
  suggested_result: DispatchRouteStopResult;
}

/** `POST /scan/match` → proposal (no persistence). */
export interface RouteSheetMatchResult {
  stops: RouteSheetMatchedStop[];
  confidence: number;
  warnings: string[];
}

/** Human-confirmed decision for a single stop. */
export interface ConfirmRouteSheetStopDto {
  stop_id: number;
  delivered: boolean;
  collected_amount?: number;
  payment_method?: string;
  result?: DispatchRouteStopResult;
  withholding_breakdown?: {
    retefuente?: number;
    reteiva?: number;
    reteica?: number;
  };
  notes?: string;
}

/** `POST /scan/confirm` body (human-confirmed decisions to settle). */
export interface ConfirmRouteSheetDto {
  stops: ConfirmRouteSheetStopDto[];
  scan_result?: RouteSheetScanResult;
}

/** `POST /scan/confirm` → settlement summary returned by the backend. */
export interface ConfirmRouteSheetResult {
  route_id: number;
  planilla_pdf_key: string;
  settled: Array<{ stop_id: number; result: string }>;
}
