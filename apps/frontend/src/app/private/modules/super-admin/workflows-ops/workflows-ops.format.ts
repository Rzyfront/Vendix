/** "45 s", "12 min", "2 h 5 min": the unit a person reads a queue delay in. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Latency with one decimal below a minute ("1,5 s"), otherwise as a duration. */
export function formatLatency(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) {
    return `${(Math.round(seconds * 10) / 10).toLocaleString('es-CO')} s`;
  }
  return formatDuration(seconds);
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${Math.round(rate * 100)} %`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export const RULE_LABELS: Record<string, string> = {
  dispatcher_stalled: 'Despachador detenido',
  backlog_lag: 'Atraso en la cola',
  dead_letters: 'Tareas fallidas',
  webhook_failures: 'Fallos de webhooks',
  latency_p95: 'Latencia alta (p95)',
};

export const SEVERITY_LABELS: Record<string, string> = {
  warning: 'Advertencia',
  critical: 'Crítica',
};
