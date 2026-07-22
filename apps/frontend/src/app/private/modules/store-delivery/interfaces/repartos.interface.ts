/**
 * Interfaces del namespace Carrier (Vendix Repartos, app_type STORE_DELIVERY).
 *
 * Fuente de verdad: `scratchpad/carrier-api-contract.md`.
 * Base path backend: `/store/carrier` (bajo el marker que abre DomainScopeGuard).
 * Dinero SIEMPRE como string (Decimal), nunca float.
 *
 * Reutiliza `DispatchRoute` / `DispatchRouteStop` (y los DTO de acción) desde
 * la interfaz de planillas de despacho — NO se redefinen aquí para que el lado
 * carrier y el lado admin compartan exactamente la misma forma de ruta/parada.
 */
import type {
  DispatchRoute,
  DispatchRouteStop,
  SettleStopDto,
  ReleaseStopDto,
  CloseDispatchRouteDto,
} from '../../store/planillas-rutas/interfaces/planilla.interface';

// Re-export para que los consumidores del módulo carrier importen todo desde
// un único punto (`repartos.interface`) sin acoplarse a la ruta de planillas.
export type {
  DispatchRoute,
  DispatchRouteStop,
  DispatchRouteStatus,
  DispatchRouteStopStatus,
  DispatchRouteStopResult,
  SettleStopDto,
  ReleaseStopDto,
  CloseDispatchRouteDto,
} from '../../store/planillas-rutas/interfaces/planilla.interface';

/**
 * Una orden esperando en el pool de reparto — lista para que un carrier la tome
 * a su ruta. Mirror EXACTO de `data[]` de `GET /store/carrier/pool`.
 * `total_to_collect` es string (Decimal); `pooled_at` es ISO.
 */
export interface PoolItem {
  order_id: number;
  order_number: string;
  customer_name: string | null;
  total_to_collect: string;
  address: string | null;
  pooled_at: string;
  delivery_type: string;
}

/** Query del pool paginado (`GET /store/carrier/pool`). */
export interface PoolQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/** Meta de paginación del pool. */
export interface PoolMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** `GET /store/carrier/pool` → `data` desempaquetado. */
export interface PoolResponse {
  data: PoolItem[];
  meta: PoolMeta;
}

/**
 * Payout estimado/ganado del carrier por su ruta. Mirror de `CarrierPayout`.
 * `amount` es el valor unitario (por parada o por ruta según `mode`).
 * `estimated` aparece en la ruta activa; `earned` aparece al cerrar.
 */
export interface CarrierPayout {
  mode: 'per_stop' | 'per_route';
  amount: string;
  currency: string;
  estimated?: string;
  earned?: string;
}

/** `POST /store/carrier/pool/:orderId/claim` → `data`. */
export interface CarrierClaimResult {
  route_id: number;
  stop_id: number;
  order_id: number;
}

/** `GET /store/carrier/route` → `data`. `route: null` si no hay ruta activa. */
export interface CarrierActiveRouteResponse {
  route: DispatchRoute | null;
  stops: DispatchRouteStop[];
  payout: CarrierPayout;
}

/** `POST /store/carrier/route/close` → `data` (con payout ganado + varianza). */
export interface CarrierCloseRouteResult {
  route: DispatchRoute;
  variance: string;
  payout: CarrierPayout;
}

/** `POST /store/dispatch-notes/orders/:orderId/send-to-dispatch` → `data`. */
export interface PublishToPoolResult {
  order_id: number;
  pooled_at: string;
}

/** Query del historial de rutas (`GET /store/carrier/routes`). */
export interface RouteHistoryQuery {
  page?: number;
  limit?: number;
  /** Filtro opcional por estado (`closed`, `voided`, `in_transit`, …). */
  status?: string;
}

/**
 * `GET /store/carrier/routes` → envelope paginado. Cada fila es una
 * `DispatchRoute` enriquecida con `vehicle` y `_count.stops` (el backend
 * incluye ambos). Reusa `PoolMeta` para la paginación.
 */
export interface RouteHistoryResponse {
  data: DispatchRoute[];
  meta: PoolMeta;
}
