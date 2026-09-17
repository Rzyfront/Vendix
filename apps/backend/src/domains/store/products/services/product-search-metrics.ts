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
import { Counter, Histogram, register } from 'prom-client';

export const SEARCH_DEGRADED_METRIC = 'search_degraded_total';

/**
 * C.3 (F-070) — `search_latency_ms{layer,rank_mode}`: histograma de latencia
 * del intento rank (L2 memoria o trigram SQL). Buckets con el presupuesto
 * E.2 (250ms) como umbral de alerta natural. Never-throw, igual que el
 * counter: métricas no rompen el read path.
 */
export const SEARCH_LATENCY_METRIC = 'search_latency_ms';

export const SEARCH_LATENCY_BUCKETS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500,
];

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

let cachedHistogram: Histogram<'layer' | 'rank_mode'> | null = null;

function getHistogram(): Histogram<'layer' | 'rank_mode'> | null {
  try {
    if (cachedHistogram) return cachedHistogram;
    const existing = register.getSingleMetric(SEARCH_LATENCY_METRIC);
    if (existing) {
      cachedHistogram = existing as Histogram<'layer' | 'rank_mode'>;
      return cachedHistogram;
    }
    cachedHistogram = new Histogram({
      name: SEARCH_LATENCY_METRIC,
      help: 'Smart search rank attempt latency in ms (memory L2 or trigram SQL).',
      labelNames: ['layer', 'rank_mode'] as const,
      buckets: SEARCH_LATENCY_BUCKETS,
    });
    return cachedHistogram;
  } catch {
    return null;
  }
}

/**
 * Observa la latencia del intento rank. Labels acotados (paths conocidos);
 * valores raros caen a 'unknown' para no cartelear series.
 */
export function observeSearchLatency(
  layer: string | null | undefined,
  rankMode: string | null | undefined,
  ms: number,
): void {
  try {
    const safeLayer =
      layer === 'l2' || layer === 'trigram' ? layer : 'unknown';
    const safeMode =
      rankMode === 'ranked' ||
      rankMode === 'unranked_scan_cap' ||
      rankMode === 'unranked_error'
        ? rankMode
        : 'unknown';
    const safeMs =
      typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : 0;
    getHistogram()?.observe(
      { layer: safeLayer, rank_mode: safeMode },
      safeMs,
    );
  } catch {
    // Métricas nunca rompen el request.
  }
}
