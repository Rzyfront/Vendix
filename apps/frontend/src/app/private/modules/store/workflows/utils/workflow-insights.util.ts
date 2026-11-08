import {
  WorkflowAiPurpose,
  WorkflowSummary,
} from '../interfaces/workflow-insights.interfaces';

/** Spanish label of each AI use measured by the gateway. */
export const AI_PURPOSE_LABELS: Readonly<Record<WorkflowAiPurpose, string>> = {
  ai_step: 'Pasos de IA',
  ai_step_test: 'Pruebas de pasos de IA',
  document_read: 'Lectura de documentos',
  insights_summary: 'Resúmenes semanales',
};

const NUMBER_FORMAT = new Intl.NumberFormat('es-CO');
const DAY_FORMAT = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_FORMAT = new Intl.DateTimeFormat('es-CO', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const TIME_FORMAT = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Whole number in es-CO format (`1.234.567`). */
export function formatTokens(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/** UTC-safe date for a calendar string `YYYY-MM-DD` (no off-by-one day). */
function calendarDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

/** `2026-11-07` -> `7 de noviembre`. */
export function formatDay(day: string): string {
  return DAY_FORMAT.format(calendarDate(day));
}

/** `del 8 de octubre al 7 de noviembre` for a summary period. */
export function formatPeriod(from: string, to: string): string {
  return `del ${formatDay(from)} al ${formatDay(to)}`;
}

/** Instant (ISO) as `7 de noviembre de 2026`, in the browser's day. */
export function formatGeneratedDate(iso: string): string {
  const date = new Date(iso);
  return DAY_YEAR_FORMAT.format(
    new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())),
  );
}

/** Instant (ISO) as `HH:MM` (24 h). */
export function formatClock(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

export interface MonthOption {
  value: string;
  label: string;
}

/** The last `count` months, newest first, as `YYYY-MM` plus a Spanish label. */
export function lastMonths(count: number, now: Date = new Date()): MonthOption[] {
  const options: MonthOption[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    options.push({
      value: `${date.getUTCFullYear()}-${month}`,
      label: MONTH_FORMAT.format(date),
    });
  }
  return options;
}

/**
 * Paragraph of one flow in the latest ready summary (matched by definition
 * id), with the summary it came from; `null` when there is none.
 */
export function flowParagraph(
  summaries: readonly WorkflowSummary[],
  definitionId: number,
): { text: string; summary: WorkflowSummary } | null {
  const latest = summaries.find((s) => s.status === 'ready' && s.content);
  if (!latest?.content) return null;
  const flow = latest.content.flows.find((f) => f.definition_id === definitionId);
  return flow ? { text: flow.text, summary: latest } : null;
}
