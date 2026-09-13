/**
 * Frontend contract for the `GET /store/analytics/dispatch/*` aggregate
 * endpoints (PLAN-analytics-despachos-2026-09-12, step 4). Mirrors the
 * envelopes built by the backend `dispatch-analytics.service.ts` — see the
 * plan's "CONTRATO DEL BACKEND" section for the exact shape of each response.
 *
 * `cash_collected` ("Recaudo en caja", conciliates with the cash close /
 * `cash_variance`) and `delivered_value` ("Valor entregado", operation incl.
 * prepaid + withholdings) are TWO DIFFERENT metrics — never merge them under
 * a single "Recaudo" label anywhere in the UI (vendix-analytics-metrics).
 */
import { ApiResponse, DateRangeFilter } from './analytics.interface';

/** Route population segmented by who ran the delivery. */
export type DispatchRouteType = 'all' | 'dsd' | 'carrier';

export interface DispatchAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  route_type?: DispatchRouteType;
  /** Only consumed by `dispatch/trends`; other endpoints ignore it. */
  granularity?: 'day' | 'week' | 'month';
}

export interface DispatchSummary {
  total_dispatch_notes: number;
  total_deliveries: number;
  total_rejected: number;
  total_released: number;
  fulfillment_rate: number;
  total_routes: number;
  active_routes: number;
  closed_routes: number;
  avg_stops_per_route: number;
  avg_cycle_hours: number | null;
  /** "Valor entregado" — operación, incluye anticipo/prepagado/retenciones. */
  delivered_value: number;
  /** "Recaudo en caja" — fórmula del cierre, concilia con `cash_variance`. */
  cash_collected: number;
  total_withholdings: number;
  cash_variance: number;
  /** `null` = el periodo anterior no tiene base; renderizar "sin base de comparación", nunca 0%. */
  deliveries_growth: number | null;
  delivered_value_growth: number | null;
}

export interface DispatchTrendPoint {
  period: string;
  deliveries: number;
  rejected: number;
  released: number;
  delivered_value: number;
  cash_collected: number;
}

export interface DispatchTrends {
  granularity: string;
  points: DispatchTrendPoint[];
}

/** ADR-01 `PortadorTipo`: explica de dónde salió el nombre del portador. */
export type PortadorTipo =
  | 'conductor_interno'
  | 'conductor_externo'
  | 'auxiliar'
  | 'domiciliario'
  | 'registrado_por';

export interface DispatchFulfillmentCarrier {
  portador_nombre: string | null;
  portador_tipo: PortadorTipo | null;
  deliveries: number;
  rejected: number;
  released: number;
  fulfillment_rate: number;
  delivered_value: number;
  routes: number;
}

export interface DispatchFulfillmentTotals {
  deliveries: number;
  rejected: number;
  released: number;
  fulfillment_rate: number;
}

export interface DispatchFulfillment {
  carriers: DispatchFulfillmentCarrier[];
  totals: DispatchFulfillmentTotals;
}

export interface DispatchWithholdingBreakdown {
  retefuente: number;
  reteiva: number;
  reteica: number;
}

export interface DispatchCollectionsRoute {
  route_number: string;
  planned_date: string | null;
  status: string;
  conductor_nombre: string | null;
  conductor_tipo: PortadorTipo | null;
  placa_vehiculo: string | null;
  is_carrier_route: boolean;
  delivered_value: number;
  cash_collected: number;
  total_prepaid: number;
  total_withholdings: number;
  withholding_breakdown: DispatchWithholdingBreakdown;
  /** `null` cuando la ruta aún no tiene cierre de caja registrado. */
  declared_cash: number | null;
  /** "Diferencia de caja": viene del cierre, NUNCA se recalcula en cliente. */
  cash_variance: number | null;
}

export interface DispatchCollectionsTotals {
  delivered_value: number;
  cash_collected: number;
  total_prepaid: number;
  total_withholdings: number;
  cash_variance: number;
  retefuente: number;
  reteiva: number;
  reteica: number;
}

/**
 * OJO — ventana temporal distinta a `DispatchSummary` / `DispatchFulfillment` /
 * `DispatchTrends`: esos tres agregan en grano REMISIÓN (`dispatch_notes.emission_date`,
 * una parada activa por remisión, ADR-02), mientras que esta agrega en grano RUTA
 * (`dispatch_routes.planned_date`, TODAS las paradas de la ruta). Por eso
 * `delivered_value` y `cash_collected` de esta vista NO tienen por qué cuadrar con
 * los del Resumen para el mismo rango de fechas — no es un bug: una remisión emitida
 * fuera del rango puede pertenecer a una ruta planeada dentro, y una remisión
 * reasignada cuenta una vez por ruta. Cada vista declara su ventana en el subtítulo.
 */
export interface DispatchCollections {
  routes: DispatchCollectionsRoute[];
  totals: DispatchCollectionsTotals;
}

export type DispatchSummaryEnvelope = ApiResponse<DispatchSummary>;
export type DispatchTrendsEnvelope = ApiResponse<DispatchTrends>;
export type DispatchFulfillmentEnvelope = ApiResponse<DispatchFulfillment>;
export type DispatchCollectionsEnvelope = ApiResponse<DispatchCollections>;
