/** Context usage at or above this percent shows the «summarizing soon» warning. */
export const VEX_CONTEXT_WARNING_PERCENT = 75;

interface ContextMeterInput {
  estimated_input_tokens?: number | null;
  context_window_tokens?: number | null;
}

/**
 * Percent of the context window in use, rounded and capped at 100.
 * Returns null when it cannot be computed (missing/zero window, bad numbers),
 * so callers keep the previous value instead of showing 0 %.
 */
export function computeContextPercent(
  budget: ContextMeterInput | null | undefined,
): number | null {
  if (!budget) return null;
  const used = budget.estimated_input_tokens;
  const window = budget.context_window_tokens;
  if (typeof used !== 'number' || typeof window !== 'number') return null;
  if (!Number.isFinite(used) || !Number.isFinite(window)) return null;
  if (window <= 0 || used < 0) return null;
  return Math.round(Math.min(100, (used / window) * 100));
}

export function isContextWarning(percent: number | null | undefined): boolean {
  return typeof percent === 'number' && percent >= VEX_CONTEXT_WARNING_PERCENT;
}
