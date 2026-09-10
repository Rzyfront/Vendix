import { DateRangeFilter } from './analytics.interface';

/**
 * QUI-628 v3 — definición operativa del abandono de carrito.
 *
 *   abandoned = `carts.state='abandoned'` con items, contados por
 *               `last_activity_at` en la ventana.
 *   recovered = `carts.state='converted'` contados por `converted_at` en
 *               la ventana (UNIVERSO carts, no orders).
 *   rates     = ambos lados comparten denominador (abandoned + recovered).
 *   *_growth  = `number | null` (null = sin base comparable). El de
 *               `recovery_rate` queda null hasta que el backfill cubra
 *               una ventana comparable post-fix.
 *
 * Removido en v3: `potential_recovery_value` (era duplicado de
 * `recovered_value` con dos nombres).
 */
export interface AbandonedCartsSummary {
  total_abandoned_carts: number;
  total_abandoned_value: number;
  abandonment_rate: number;
  /**
   * Crecimiento vs período anterior. `null` cuando el período previo no
   * tiene base (regla 9 del contrato de métricas). UI debe renderizar
   * "sin base de comparación", NUNCA "0 %".
   */
  abandonment_rate_growth: number | null;
  recovered_carts: number;
  recovered_value: number;
  recovery_rate: number;
  /** Null hasta que el backfill de converted_at cubra la ventana previa. */
  recovery_rate_growth: number | null;
  average_cart_value: number;
}

export interface AbandonedCartTrend {
  period: string;
  abandoned_carts: number;
  recovered_carts: number;
  abandonment_rate: number;
  recovery_rate: number;
  /** Suma de subtotales de los carritos abandonados en el bucket. */
  cart_value: number;
}

export interface AbandonedCartByReason {
  reason: string;
  count: number;
  percentage: number;
  total_value: number;
}

export interface AbandonedCartByHour {
  hour: number;
  abandoned_carts: number;
  recovery_rate: number;
}

export interface AbandonedCartsAnalyticsQueryDto {
  date_range?: DateRangeFilter;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'year';
}
