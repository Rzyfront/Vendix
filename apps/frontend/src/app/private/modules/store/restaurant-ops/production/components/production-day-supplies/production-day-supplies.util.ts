/** Orders of the day by card status, as the day list / active board summary reports them. */
export interface ProductionDaySummaryCounts {
  waiting: number;
  in_progress: number;
  completed: number;
}

/**
 * The end-of-day summary opens by itself only when, during this session, the
 * day goes from "something still to produce" to "nothing left" with at least
 * one finished order. `prev` is null when there is no earlier reading of the
 * same day, so a page opened on an already closed day never auto-opens.
 */
export function shouldAutoOpenDaySummary(
  prev: ProductionDaySummaryCounts | null,
  next: ProductionDaySummaryCounts,
): boolean {
  if (prev === null) return false;
  const wasOpen = prev.waiting + prev.in_progress > 0;
  const isClosed = next.waiting + next.in_progress === 0;
  return wasOpen && isClosed && next.completed > 0;
}

/**
 * Production quantity (supplies, and the orders of Planta): es-CO separators
 * and up to 4 decimals, the precision `production_order_lines` stores, so the
 * day panel, the summary and the order details read the same figure.
 * Accepts the Decimal strings the API returns; "—" when there is no value.
 */
export function formatProductionQty(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 }).format(n);
}

/** Note for the finished orders of the day that have no consumption breakdown. */
export function withoutBreakdownNote(count: number): string {
  return count === 1
    ? '1 orden del día se finalizó sin desglose de consumo.'
    : `${count} órdenes del día se finalizaron sin desglose de consumo.`;
}
