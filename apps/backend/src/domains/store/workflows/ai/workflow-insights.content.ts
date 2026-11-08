/** One flow as the AI sees it: aggregated metrics only, no request content or names. */
export interface WorkflowInsightsFlowInput {
  key: string;
  name: string;
  started: number;
  completed: number;
  open: number;
  completion_rate_percent: number | null;
  avg_cycle_hours: number | null;
  p90_cycle_hours: number | null;
  overdue_share_percent: number | null;
  slowest_stage: { name: string; open_tasks: number } | null;
  insufficient_data: boolean;
}

/**
 * The whole store over the period, computed here: the AI quotes these figures
 * and never adds up the flows itself (it only sees the busiest ones).
 */
export interface WorkflowInsightsTotals {
  active_flows: number;
  started: number;
  completed: number;
  open: number;
  completion_rate_percent: number | null;
}

export interface WorkflowInsightsFlowText {
  key: string;
  definition_id: number;
  name: string;
  text: string;
}

export interface WorkflowInsightsContent {
  headline: string;
  summary: string;
  flows: WorkflowInsightsFlowText[];
  recommendations: string[];
}

export const INSIGHTS_LIMITS = {
  headline: 160,
  summary: 900,
  flowText: 400,
  flows: 8,
  recommendations: 4,
  recommendation: 200,
} as const;

export const INSIGHTS_INVALID_ERROR = 'La respuesta de la IA no fue válida';
export const INSIGHTS_QUOTA_ERROR = 'No se generó: cupo de IA agotado';
export const INSIGHTS_FAILED_ERROR = 'No se pudo generar el resumen con la IA. Inténtalo de nuevo más tarde.';

/** Summary stored when there is nothing to narrate; the AI is not called. */
export function emptyInsightsContent(hasPublishedFlows: boolean): WorkflowInsightsContent {
  return {
    headline: 'Sin actividad en los últimos 30 días',
    summary: hasPublishedFlows
      ? 'Sin actividad en los últimos 30 días: tus flujos publicados no tuvieron solicitudes nuevas, abiertas ni completadas en este periodo.'
      : 'Sin actividad en los últimos 30 días: todavía no tienes flujos publicados, así que no hay procesos que resumir.',
    flows: [],
    recommendations: [],
  };
}

export interface InsightsFlowRef {
  definition_id: number;
  name: string;
}

/**
 * Strict validation of the AI answer. Returns null when any field breaks its
 * type or length; flows whose key is not in the input are dropped.
 */
export function parseInsightsContent(
  raw: unknown,
  flowsByKey: ReadonlyMap<string, InsightsFlowRef>,
): WorkflowInsightsContent | null {
  if (!isRecord(raw)) return null;
  const headline = boundedText(raw.headline, INSIGHTS_LIMITS.headline);
  const summary = boundedText(raw.summary, INSIGHTS_LIMITS.summary);
  if (!headline || !summary) return null;

  const rawFlows = raw.flows === undefined ? [] : raw.flows;
  if (!Array.isArray(rawFlows)) return null;
  const flows: WorkflowInsightsFlowText[] = [];
  const seen = new Set<string>();
  for (const item of rawFlows) {
    if (!isRecord(item) || typeof item.key !== 'string') return null;
    const ref = flowsByKey.get(item.key);
    if (!ref) continue;
    const text = boundedText(item.text, INSIGHTS_LIMITS.flowText);
    if (!text) return null;
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    flows.push({ key: item.key, definition_id: ref.definition_id, name: ref.name, text });
  }
  if (flows.length > INSIGHTS_LIMITS.flows) return null;

  const rawRecs = raw.recommendations === undefined ? [] : raw.recommendations;
  if (!Array.isArray(rawRecs) || rawRecs.length > INSIGHTS_LIMITS.recommendations) return null;
  const recommendations: string[] = [];
  for (const rec of rawRecs) {
    const text = boundedText(rec, INSIGHTS_LIMITS.recommendation);
    if (!text) return null;
    recommendations.push(text);
  }
  return { headline, summary, flows, recommendations };
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ISO 8601 week of a civil date, e.g. `2026-W45`. */
export function isoWeekKey(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = Date.UTC(weekYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` shifted by whole days. */
export function addDaysToDateString(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
