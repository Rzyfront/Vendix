/**
 * Contrato tipado del submódulo super-admin `Cuentas > Actividad`.
 *
 * Espejo exacto del dominio backend `superadmin/stores/activity`
 * (controlador + `store-activity-query.dto.ts` +
 * `store-activity-detail-query.dto.ts` + `StoreActivityRow/Stats/TimelineItem`
 * del servicio). La actividad se deriva de `orders` + `audit_logs` +
 * `login_attempts` (sin tabla nueva).
 *
 * Convenciones:
 * - El rango viaja como `YYYY-MM-DD` y el tablero cross-store bucketiza en UTC.
 * - `score = orders*1 + audit_events*0.2 + active_users*2` en la ventana.
 * - Ordenamiento cerrado: `sort ∈ {score, orders_count, audit_events,
 *   active_users, revenue_operating, last_activity_at}` + `order`.
 */

/** Envoltura estándar `ResponseService.paginated()` del backend. */
export interface PaginatedApiResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: PaginationMeta;
}

/** Envoltura estándar `ResponseService.success()` del backend. */
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

/** Una fila del ranking, ordenada mayor → menor por `score`. */
export interface StoreActivityRow {
  store_id: number;
  name: string;
  slug: string;
  organization_name: string | null;
  is_active: boolean;
  score: number;
  orders_count: number;
  audit_events: number;
  active_users: number;
  revenue_operating: number;
  last_activity_at: string | null;
}

/** Las 4 cards del encabezado del ranking. */
export interface StoreActivityStats {
  active_stores: number;
  activity_pct_vs_meta_80: number;
  avg_hours_per_day: number;
  inactive_stores: number;
  orders_total: number;
}

/** Vocabulario cerrado de `sort` del backend (`STORE_ACTIVITY_SORTS`). */
export const STORE_ACTIVITY_SORTS: readonly string[] = [
  'score',
  'orders_count',
  'audit_events',
  'active_users',
  'revenue_operating',
  'last_activity_at',
];

export type StoreActivitySortBy =
  | 'score'
  | 'orders_count'
  | 'audit_events'
  | 'active_users'
  | 'revenue_operating'
  | 'last_activity_at';

export type SortOrder = 'asc' | 'desc';

/** Query del ranking y de las stats (`StoreActivityQueryDto`). */
export interface StoreActivityQuery {
  page?: number;
  limit?: number;
  /** Nombre o slug de la tienda. */
  search?: string;
  /** Filtro por organización (ID numérico del backend). */
  organization_id?: number;
  is_active?: boolean;
  from?: string;
  to?: string;
  sort?: StoreActivitySortBy | string;
  order?: SortOrder;
}

/** Tipos de evento del timeline (`STORE_ACTIVITY_EVENT_TYPES`). */
export type StoreActivityEventType = 'order' | 'audit' | 'login';

/** Canales de orden (`order_channel_enum` de Prisma). */
export const STORE_ACTIVITY_CHANNELS = [
  'pos',
  'ecommerce',
  'agent',
  'whatsapp',
  'marketplace',
] as const;

/** Estados de orden (`order_state_enum` de Prisma). */
export const STORE_ACTIVITY_ORDER_STATES = [
  'draft',
  'created',
  'pending_payment',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'finished',
  'pending_delivery',
] as const;

/** Filtros avanzados propios del modal (`StoreActivityDetailQueryDto`).
 * `channel` y `order_state` solo aplican a los items de tipo `order`. */
export interface StoreActivityDetailQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  event_type?: StoreActivityEventType | string;
  channel?: string;
  order_state?: string;
}

/** Resumen que encabeza el modal: la fila del ranking + logins exitosos. */
export interface StoreActivitySummary extends StoreActivityRow {
  successful_logins: number;
}

/** Un evento del timeline (`StoreActivityTimelineItem` del backend). */
export interface StoreActivityTimelineEvent {
  kind: StoreActivityEventType;
  id: string;
  occurred_at: string;
  title: string;
  detail?: string;
  channel?: string;
  state?: string;
  actor?: string;
}

/** Detalle por tienda: resumen + timeline paginada. */
export interface StoreActivityDetail {
  summary: StoreActivitySummary;
  timeline: StoreActivityTimelineEvent[];
  /** Paginación del `timeline`. El backend no pagina nada más aquí. */
  meta: PaginationMeta;
}

/** Un bucket diario de la serie (`GET /superadmin/stores/activity/:storeId/series`).
 * Rango en UTC con días en cero incluidos. */
export interface StoreActivitySeriesDay {
  date: string;
  orders: number;
  revenue_operating: number;
  audit_events: number;
  logins: number;
}

/** Serie diaria + agregados por canal y por estado de orden del rango. */
export interface StoreActivitySeries {
  days: StoreActivitySeriesDay[];
  by_channel: Record<string, number>;
  by_state: Record<string, number>;
}

/** Query de la serie: rango `YYYY-MM-DD` + acotadores de pedidos.
 * `channel` y `order_state` solo aplican a las métricas de pedidos. */
export interface StoreActivitySeriesQuery {
  from?: string;
  to?: string;
  channel?: string;
  order_state?: string;
}
