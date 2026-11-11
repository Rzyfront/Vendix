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

/** Plain quantity: up to 3 decimals, es-CO separators; "—" when there is no value. */
export function formatSupplyQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(value);
}
