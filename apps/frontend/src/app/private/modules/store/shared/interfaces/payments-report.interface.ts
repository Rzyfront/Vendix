/**
 * Contrato frontend del "Reporte y analítica de pagos".
 * Espejo exacto de `GET /store/analytics/payments` (+ `/summary`, `/trends`).
 * Los montos llegan como `number` (el backend ya los normaliza).
 */

export type PaymentState =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled';

export type PaymentsGranularity = 'hour' | 'day' | 'week' | 'month' | 'year';

export type PaymentsSortBy = 'effective_date' | 'amount' | 'state';

export type PaymentsSortOrder = 'asc' | 'desc';

/** Preset de rango de fechas (mismo vocabulario que `DateRangeFilter.preset`). */
export type PaymentsDatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'custom';

export interface PaymentReportRow {
  id: number;
  /** COALESCE(paid_at, created_at) — TIMESTAMP, se muestra en hora local. */
  effective_date: string;
  paid_at: string | null;
  created_at: string;
  state: PaymentState;
  amount: number;
  refunded_amount: number;
  net_amount: number;
  currency: string;
  transaction_id: string | null;
  gateway_reference: string | null;
  order: {
    id: number;
    order_number: string;
    state: string;
    channel: string | null;
  };
  customer: {
    id: number;
    name: string;
    document: string | null;
    email: string | null;
  } | null;
  payment_method: {
    id: number;
    display_name: string;
    type: string;
  } | null;
  bank_account: { id: number; name: string } | null;
  cash_register: { session_id: number; register_name: string } | null;
  has_receipt: boolean;
}

export interface PaymentsSummaryByMethod {
  payment_method_id: number | null;
  display_name: string;
  type: string;
  count: number;
  collected_amount: number;
  percentage: number;
}

export interface PaymentsSummaryByState {
  state: PaymentState;
  count: number;
  amount: number;
}

export interface PaymentsSummary {
  total_collected: number;
  collected_count: number;
  total_amount: number;
  payments_count: number;
  average_payment: number;
  total_refunded: number;
  net_collected: number;
  pending_amount: number;
  failed_count: number;
  previous_total_collected: number;
  /** `null` cuando el período anterior no tiene base (sin porcentaje falso). */
  collected_growth: number | null;
  by_method: PaymentsSummaryByMethod[];
  by_state: PaymentsSummaryByState[];
}

export interface PaymentsTrendPoint {
  /** Etiqueta de período en TZ de tienda (texto del SQL, según granularidad). */
  period: string;
  collected_amount: number;
  payments_count: number;
}

/** Query de servicio (arrays reales; el servicio los serializa a CSV). */
export interface PaymentsReportQuery {
  date_preset?: PaymentsDatePreset;
  /** Solo se envían cuando `date_preset === 'custom'`. */
  date_from?: string;
  date_to?: string;
  granularity?: PaymentsGranularity;
  page?: number;
  limit?: number;
  state?: PaymentState[];
  payment_method_id?: number[];
  search?: string;
  sort_by?: PaymentsSortBy;
  sort_order?: PaymentsSortOrder;
}

export interface PaymentsListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Respuesta paginada estándar de `ResponseService.paginated`. */
export interface PaymentsListResponse {
  success: boolean;
  data: PaymentReportRow[];
  meta: PaymentsListMeta;
}

/** Opción del filtro de método de pago de la tienda. */
export interface StorePaymentMethodOption {
  id: number;
  label: string;
}
