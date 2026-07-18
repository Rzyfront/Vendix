export type DispatchRouteStatus =
  | 'draft'
  | 'dispatched'
  | 'in_transit'
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

/**
 * Delivery-address JSON snapshot stored on a dispatch note / order. Mirrors the
 * backend `customer_address` and `shipping_address_snapshot` shape. Every field
 * is optional because legacy remisiones may carry a partial blob (or none).
 */
export interface DispatchDeliveryAddress {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country_code?: string | null;
  postal_code?: string | null;
  /** Legacy aliases tolerated by the address-presence check. */
  line1?: string | null;
  address?: string | null;
  /**
   * GPS coordinates captured at checkout (address-map-picker). Optional because
   * legacy addresses may lack them; when present the backend uses them to
   * geolocate the stop on the route map without a geocoding round-trip.
   */
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Minimal order summary carried by `dispatch_note.order` in the route include.
 * Surfaces the `shipping_address_snapshot` fallback used when the note has no
 * own `customer_address`.
 */
export interface DispatchNoteOrderSummary {
  id?: number;
  order_number?: string | null;
  status?: string | null;
  shipping_address_snapshot?: DispatchDeliveryAddress | null;
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
   * Delivery-address snapshot (JSON) of the dispatch note. Returned by the
   * backend `DISPATCH_ROUTE_INCLUDE` so the planilla detail can show "¿dónde
   * es?" per stop without fetching the full note. May be null on legacy
   * remisiones; the address falls back to `order.shipping_address_snapshot`.
   */
  customer_address?: DispatchDeliveryAddress | null;
  /**
   * Linked order summary carrying the `shipping_address_snapshot` fallback used
   * when `customer_address` is null.
   */
  order?: DispatchNoteOrderSummary | null;
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

// ============================================================================
// Dispatch monitor (GET /store/dispatch-routes/monitor)
// ============================================================================

/**
 * One row of the shipping mini-P&L monitor. Mirrors EXACTLY the backend
 * `data.data[]` shape returned by `GET /store/dispatch-routes/monitor`.
 *
 * The four economic fields are pre-aggregated by the backend as plain numbers:
 * - `recaudo`         — cash collected on the route (COD).
 * - `ingreso_flete`   — freight revenue charged to the customer.
 * - `costo_transporte`— transport cost incurred (own fleet or external carrier).
 * - `margen_flete`    — `ingreso_flete - costo_transporte` (can be NEGATIVE).
 *
 * `ejecutor` is the human-readable executor label (driver / carrier) or null,
 * and `estado_liquidacion` reflects whether the route freight is settled.
 * The endpoint accepts only `page` / `limit` (no `search`).
 */
export interface DispatchRouteMonitorRow {
  id: number;
  route_number: string;
  store_id: number;
  status: DispatchRouteStatus;
  planned_date: string;
  closed_at: string | null;
  shipping_method: { id: number; name: string } | null;
  external_carrier_supplier_id: number | null;
  vehicle_id: number | null;
  recaudo: number;
  ingreso_flete: number;
  costo_transporte: number;
  margen_flete: number;
  ejecutor: string | null;
  estado_liquidacion: 'paid' | 'pending';
}

/** `GET /store/dispatch-routes/monitor` → unwrapped `data`. */
export interface PaginatedMonitorResponse {
  data: DispatchRouteMonitorRow[];
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

/**
 * One stop APPENDED to an already-existing route via `POST /:id/stops`.
 *
 * Unlike `CreateStopDto` (used at route creation, where the operator sets the
 * visiting order), `stop_sequence` is OPTIONAL here: when omitted the backend
 * appends the stop after the route's current max sequence (see
 * `AddStopItemDto` / `addStops()` on the backend). `CreateStopDto` is still
 * assignable to this type, so existing callers passing a full stop keep working.
 */
export interface AddStopDto {
  dispatch_note_id: number;
  stop_sequence?: number;
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
  /**
   * Método de envío elegido para la ruta. Dispara el auto-config de ejecutor
   * (vehículo/conductor/carrier) en el backend a partir de la política del
   * método. Plan Despacho Economía — FASE 3 paso 12.
   */
  shipping_method_id?: number;
  /** Proveedor transportador externo (tercero de la CxP — FASE 5). */
  external_carrier_supplier_id?: number;
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
// Route map (GET /store/dispatch-routes/:id/map-stops)
// ============================================================================

/**
 * A pending (or in-progress) stop that HAS resolvable coordinates and can be
 * rendered on the route map. Mirrors EXACTLY the backend `data.stops[]` shape
 * returned by `GET /store/dispatch-routes/:id/map-stops`. `sequence` is the
 * persisted `stop_sequence` already surfaced camelCase by the backend, so it is
 * consumed as-is (no snake→camel mapping needed on the frontend).
 */
export interface MapStop {
  stopId: number;
  sequence: number;
  /**
   * `pending` / `in_progress` for the active `stops[]`; `delivered` for the
   * `delivered[]` leg (completed stops kept on the map in green).
   */
  status: 'pending' | 'in_progress' | 'delivered';
  customerName: string | null;
  addressText: string | null;
  lat: number;
  lng: number;
  /** True when the coords came from a geocoding pass (vs. stored GPS). */
  geocoded: boolean;
}

/**
 * A pending stop WITHOUT resolvable coordinates: it exists in the route but
 * cannot be painted on the map. Surfaced to the operator as a "Sin ubicación"
 * list so it is not silently dropped. Mirrors `data.unlocated[]`.
 */
export interface MapStopUnlocated {
  stopId: number;
  sequence: number;
  customerName: string | null;
  addressText: string | null;
  /** Id of the backing dispatch note; when present the UI offers "Fijar en mapa". */
  dispatchNoteId?: number | null;
  /** Raw customer_address snapshot (AddressPayload | null) from the dispatch note. */
  customerAddress?: any | null;
}

/**
 * `GET /store/dispatch-routes/:id/map-stops` → `data`.
 *
 * - `stops[]`: only pending / in_progress located stops (optimizer input).
 * - `delivered[]`: already-delivered located stops, ordered by `sequence` asc,
 *   kept so the map can show completed paradas in green with a green leg.
 *   Same shape as `stops[]` (`status` is always `delivered` here).
 * - `unlocated[]`: pending stops without resolvable coordinates.
 */
export interface MapStopsResponse {
  origin: { lat: number; lng: number } | null;
  stops: MapStop[];
  delivered: MapStop[];
  unlocated: MapStopUnlocated[];
}

/** One entry of the reorder payload for `PATCH .../:id/stops/reorder`. */
export interface ReorderStopEntry {
  stopId: number;
  sequence: number;
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

/**
 * `POST /scan/confirm` → idempotent settlement summary returned by the backend.
 *
 * The endpoint no longer throws 400 for already-settled stops; instead it
 * reconciles them into `skipped`. `settled` are the stops settled in this call,
 * `errors` are per-stop failures, and `route` is the fully-updated route (same
 * shape as `GET /store/dispatch-routes/:id`) so the caller can refresh without
 * a second round-trip.
 */
export interface ConfirmRouteSheetResult {
  route_id: number;
  planilla_pdf_key: string;
  settled: Array<{ stop_id: number; result: string }>;
  skipped: Array<{
    stop_id: number;
    reason: 'not_in_route' | 'already_settled';
  }>;
  errors: Array<{ stop_id: number; message: string }>;
  /** Fully-updated route, same shape as `GET /store/dispatch-routes/:id`. */
  route: DispatchRoute;
}
