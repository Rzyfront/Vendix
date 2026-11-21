import type { VexContextBudget } from '../models/vex.models';

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

interface PersistedMessage {
  role: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Budget persisted with the newest assistant answer (`metadata.context_budget`),
 * so a reloaded conversation shows the same «Contexto N %» the last `done`
 * frame did. The server compacts on this exact value, so the ring and the
 * compaction keep reading one measure. Null when no answer carries a valid one.
 */
export function latestContextBudget(
  messages: readonly PersistedMessage[] | null | undefined,
): VexContextBudget | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const raw = message.metadata?.['context_budget'];
    if (!raw || typeof raw !== 'object') continue;
    const budget = raw as Partial<VexContextBudget>;
    if (computeContextPercent(budget) === null) continue;
    if (budget.provenance !== 'configured' && budget.provenance !== 'fallback') continue;
    return {
      estimated_input_tokens: budget.estimated_input_tokens as number,
      omitted_messages:
        typeof budget.omitted_messages === 'number' ? budget.omitted_messages : 0,
      context_window_tokens: budget.context_window_tokens as number,
      provenance: budget.provenance,
      method: 'conservative_estimate',
    };
  }
  return null;
}
