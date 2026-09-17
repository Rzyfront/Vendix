/**
 * CP-pos-smart-search · B.2 — Contador de degradación del rank (F-012/ADR-08).
 *
 * `search_degraded_total{reason,store}`: cada vez que el path rankeado cae al
 * `orderBy` legacy (scan-cap excedido o throw en light/rank/slice/hydrate).
 * Provider-free a propósito: `ProductsService` se construye en specs viejos
 * sin este provider (B.3 fija specs nuevos; los existentes no se tocan), así
 * que la métrica no entra por constructor. Registro perezoso con
 * `getSingleMetric` para no duplicar en re-imports de test.
 *
 * Never-throw: métricas no rompen el read path.
 */
import { Counter, register } from 'prom-client';

export const SEARCH_DEGRADED_METRIC = 'search_degraded_total';

export type SearchDegradedReason = 'scan_cap' | 'rank_error';

let cached: Counter<'reason' | 'store'> | null = null;

function getCounter(): Counter<'reason' | 'store'> | null {
  try {
    if (cached) return cached;
    const existing = register.getSingleMetric(SEARCH_DEGRADED_METRIC);
    if (existing) {
      cached = existing as Counter<'reason' | 'store'>;
      return cached;
    }
    cached = new Counter({
      name: SEARCH_DEGRADED_METRIC,
      help: 'Smart search rank fallbacks to legacy orderBy (scan-cap or rank-path throw).',
      labelNames: ['reason', 'store'] as const,
    });
    return cached;
  } catch {
    return null;
  }
}

/**
 * Suma 1 a `search_degraded_total{reason,store}`. `storeId` ausente ⇒ '0'
 * (mismo shape, sin serie fantasma por undefined).
 */
export function recordSearchDegraded(
  reason: SearchDegradedReason,
  storeId: number | null | undefined,
): void {
  try {
    getCounter()?.inc({
      reason,
      store: typeof storeId === 'number' ? String(storeId) : '0',
    });
  } catch {
    // Métricas nunca rompen el request.
  }
}
