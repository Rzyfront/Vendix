import type {
  PlatformAlertResolution,
  PlatformAlertRow,
  PlatformAlertSeverity,
} from './platform-alert.types';

/** Vocabulario del ticket QUI-1010. */
export const SEVERITY_LABELS: Record<PlatformAlertSeverity, string> = {
  info: 'Informativa',
  warning: 'Leve',
  critical: 'Grave',
};

const SEVERITY_ICONS: Record<PlatformAlertSeverity, string> = {
  info: '🔵',
  warning: '🟠',
  critical: '🔴',
};

export const SOURCE_LABELS: Record<string, string> = {
  http: 'Petición fallida',
  latency: 'Respuesta lenta',
  job: 'Trabajo en segundo plano fallido',
  job_stalled: 'Trabajo en segundo plano colgado',
  queue_stalled: 'Cola sin procesar',
  worker: 'Proceso de fondo sin latido',
  incident: 'Incidente reportado',
  test: 'Alerta de prueba',
};

export const RESOLUTION_LABELS: Record<PlatformAlertResolution, string> = {
  auto_quiet: 'dejó de repetirse',
  recovered: 'el proceso se recuperó',
  ticket_closed: 'su ticket se cerró',
  manual: 'marcada como resuelta en Superadmin',
};

const TIME_ZONE = 'America/Bogota';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function severityOf(value: string): PlatformAlertSeverity {
  return value === 'critical' || value === 'info' ? value : 'warning';
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** «Tienda 12 · Organización 3», «Plataforma» si no hay ninguna. */
export function tenantLabel(alert: Pick<
  PlatformAlertRow,
  'organization_id' | 'store_id' | 'affected_store_ids'
>): string {
  const parts: string[] = [];
  if (alert.store_id) parts.push(`Tienda ${alert.store_id}`);
  if (alert.organization_id) parts.push(`Organización ${alert.organization_id}`);
  const others = (alert.affected_store_ids ?? []).filter(
    (id) => id !== alert.store_id,
  );
  if (others.length > 0) {
    parts.push(`otras tiendas: ${others.slice(0, 10).join(', ')}${others.length > 10 ? '…' : ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Plataforma (sin tienda)';
}

function detailLines(details: unknown): string[] {
  if (!details || typeof details !== 'object') return [];
  return Object.entries(details as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`);
}

/**
 * Mensaje de Telegram de una alerta abierta. Se reescribe (edit) con el conteo
 * cada vez que la falla se repite, así el chat no se llena de copias.
 */
export function formatAlertMessage(
  alert: PlatformAlertRow,
  envLabel: string,
): string {
  const severity = severityOf(alert.severity);
  const lines = [
    `${SEVERITY_ICONS[severity]} <b>${SEVERITY_LABELS[severity].toUpperCase()}</b> · ${escapeHtml(SOURCE_LABELS[alert.source] ?? alert.source)} · ${escapeHtml(envLabel)}`,
    `<b>${escapeHtml(alert.title)}</b>`,
    '',
    `<b>Proceso:</b> <code>${escapeHtml(alert.process)}</code>`,
    `<b>Tipo de error:</b> <code>${escapeHtml(alert.error_type)}</code>`,
    `<b>Afecta a:</b> ${escapeHtml(tenantLabel(alert))}`,
    `<b>Primera vez:</b> ${formatDateTime(alert.first_seen_at)}`,
  ];
  if (alert.occurrences > 1) {
    lines.push(
      `<b>Veces:</b> ${alert.occurrences} (última: ${formatDateTime(alert.last_seen_at)})`,
    );
  }
  if (alert.escalated_at) {
    lines.push('<b>Subió a grave</b> por repetirse.');
  }
  if (alert.ticket_number) {
    lines.push(`<b>Ticket:</b> ${escapeHtml(alert.ticket_number)}`);
  }
  if (alert.message) {
    lines.push('', `<pre>${escapeHtml(alert.message)}</pre>`);
  }
  const extra = detailLines(alert.details);
  if (extra.length > 0) lines.push('', ...extra);
  lines.push('', `Alerta #${alert.id} · Superadmin → Monitoreo → Alertas`);
  return lines.join('\n');
}

/** Aviso de que una falla leve se volvió grave. */
export function formatEscalationMessage(
  alert: PlatformAlertRow,
  envLabel: string,
): string {
  return [
    `🔴 <b>SUBIÓ A GRAVE</b> · ${escapeHtml(envLabel)}`,
    `<b>${escapeHtml(alert.title)}</b>`,
    `Se repitió ${alert.occurrences} veces desde ${formatDateTime(alert.first_seen_at)}: la función puede estar sin servicio.`,
    alert.ticket_number
      ? `<b>Ticket:</b> ${escapeHtml(alert.ticket_number)}`
      : 'Se avisó a soporte por correo.',
    `Alerta #${alert.id}`,
  ].join('\n');
}

/** Aviso de resolución (S6). */
export function formatResolutionMessage(
  alert: PlatformAlertRow,
  resolution: PlatformAlertResolution,
  envLabel: string,
): string {
  const severity = severityOf(alert.severity);
  return [
    `✅ <b>RESUELTA</b> · ${escapeHtml(SEVERITY_LABELS[severity])} · ${escapeHtml(envLabel)}`,
    `<b>${escapeHtml(alert.title)}</b>`,
    `<b>Proceso:</b> <code>${escapeHtml(alert.process)}</code>`,
    `<b>Motivo:</b> ${escapeHtml(RESOLUTION_LABELS[resolution])}`,
    `<b>Veces:</b> ${alert.occurrences} · desde ${formatDateTime(alert.first_seen_at)} hasta ${formatDateTime(alert.last_seen_at)}`,
    ...(alert.ticket_number
      ? [`<b>Ticket:</b> ${escapeHtml(alert.ticket_number)} (revísalo en Superadmin → Soporte)`]
      : []),
    `Alerta #${alert.id}`,
  ].join('\n');
}
