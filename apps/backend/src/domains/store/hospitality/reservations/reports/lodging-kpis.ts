import { round2 } from '../../../analytics/analytics-metrics.contract';

/** Hotel KPIs of a period; `null` when the denominator is zero (no base). */
export interface LodgingKpis {
  /** Occupancy = nights sold / nights available, in %. */
  occupancy_pct: number | null;
  /** ADR = room revenue / nights sold. */
  adr: number | null;
  /** RevPAR = room revenue / nights available. */
  revpar: number | null;
}

/**
 * Hospitality Suite (H7.2) — the three hotel KPIs. A zero denominator gives
 * `null` (the UI shows "—"), never 0 % or a division by zero.
 */
export function lodgingKpis(nights_sold: number, nights_available: number, room_revenue: number): LodgingKpis {
  return {
    occupancy_pct: nights_available > 0 ? round2((nights_sold / nights_available) * 100) : null,
    adr: nights_sold > 0 ? round2(room_revenue / nights_sold) : null,
    revpar: nights_available > 0 ? round2(room_revenue / nights_available) : null,
  };
}
