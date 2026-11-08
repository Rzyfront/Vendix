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

/** Spanish name of each kind of background task of the outbox (`workflow_outbox.kind`). */
export const OUTBOX_KIND_LABELS: Record<string, string> = {
  advance: 'Avance de etapa',
  notify: 'Aviso',
  webhook: 'Webhook saliente',
  business_event: 'Evento de negocio',
  start_instance: 'Inicio de solicitud',
  action: 'Acción',
  ai_step: 'Paso de IA',
  gate_start: 'Inicio de aprobación',
  gate_resolved: 'Aprobación resuelta',
  subflow_start: 'Inicio de subflujo',
  subflow_closed: 'Cierre de subflujo',
};

/** The Spanish name of an outbox kind; an unknown kind shows as it came. */
export function outboxKindLabel(kind: string | null | undefined): string {
  if (!kind) return '—';
  return OUTBOX_KIND_LABELS[kind] ?? kind;
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
