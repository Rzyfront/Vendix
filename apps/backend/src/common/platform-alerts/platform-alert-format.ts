import { describeJobSource } from '../queue/job-origin';
import { ENTITY_LABELS, type AlertEntityType } from './platform-alert-catalog';
import {
  ALERT_CONTEXT_KEY,
  type AlertContextLine,
  type PlatformAlertContext,
  type PlatformAlertResolution,
  type PlatformAlertRow,
  type PlatformAlertSeverity,
  type ResolvedAlertContext,
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

/** Encabezado de una alerta «Límite de plan» (QUI-1031). */
export const PLAN_LIMIT_LABEL = 'Límite de plan';

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

// ---------------------------------------------------------------------------
// Contexto legible (QUI-1031)
// ---------------------------------------------------------------------------

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function shortText(value: unknown, max = 160): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

/** Contexto guardado en `details._context`, validado campo por campo. */
export function readStoredContext(details: unknown): PlatformAlertContext {
  const raw =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>)[ALERT_CONTEXT_KEY]
      : null;
  if (!raw || typeof raw !== 'object') return {};
  const c = raw as Record<string, unknown>;
  const entityType =
    typeof c.entityType === 'string' && c.entityType in ENTITY_LABELS
      ? (c.entityType as AlertEntityType)
      : null;
  return {
    userId: positiveId(c.userId),
    module: shortText(c.module),
    action: shortText(c.action),
    origin: shortText(c.origin, 120),
    entityType,
    entityId: entityType ? positiveId(c.entityId) : null,
    category: c.category === 'plan_limit' ? 'plan_limit' : null,
    planLimitCode: shortText(c.planLimitCode, 60),
    aiFeature: shortText(c.aiFeature, 60),
    period: shortText(c.period, 8),
  };
}

/** `details` para mostrar: sin la clave interna del contexto. */
export function displayDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== 'object') return {};
  const { [ALERT_CONTEXT_KEY]: _context, ...rest } = details as Record<string, unknown>;
  return rest;
}

export function isPlanLimitAlert(alert: Pick<PlatformAlertRow, 'details'>): boolean {
  return readStoredContext(alert.details).category === 'plan_limit';
}

/** «Límite de plan», «Trabajo en segundo plano fallido»… */
export function alertKindLabel(
  alert: Pick<PlatformAlertRow, 'source' | 'details'>,
): string {
  return isPlanLimitAlert(alert)
    ? PLAN_LIMIT_LABEL
    : (SOURCE_LABELS[alert.source] ?? alert.source);
}

export interface StoreName {
  name: string;
  slug: string | null;
}

export interface UserName {
  name: string | null;
  email: string | null;
}

/**
 * Nombres ya resueltos. Lo que falte (búsqueda caída, registro borrado) se
 * muestra con su id: la alerta nunca se pierde por un nombre.
 */
export interface AlertNames {
  stores?: ReadonlyMap<number, StoreName | null>;
  organizations?: ReadonlyMap<number, string | null>;
  users?: ReadonlyMap<number, UserName | null>;
  /** Nombre del registro afectado («Kit de freno NKD»). */
  entityName?: string | null;
  /** Plan de la tienda («Pro»). */
  plan?: string | null;
  /** Cupo consumido («1.000 de 1.000 · …»). */
  quota?: string | null;
}

/** «Vendix Granizzo (testbalmes, id 105)», o «id 105» sin nombre. */
export function storeLabel(id: number, store?: StoreName | null): string {
  if (!store?.name) return `id ${id}`;
  return `${store.name} (${store.slug ? `${store.slug}, ` : ''}id ${id})`;
}

export function organizationLabel(id: number, name?: string | null): string {
  return name ? `${name} (id ${id})` : `id ${id}`;
}

export function userLabel(id: number, user?: UserName | null): string {
  const parts = [user?.name, user?.email].filter(
    (part): part is string => !!part,
  );
  return parts.length > 0 ? `${parts.join(' · ')} (id ${id})` : `id ${id}`;
}

type ContextAlert = Pick<
  PlatformAlertRow,
  'organization_id' | 'store_id' | 'affected_store_ids' | 'details'
>;

/** Tienda o, si no hay, organización; «Plataforma (sin tienda)» si ninguna. */
export function scopeLabelOf(alert: ContextAlert, names: AlertNames = {}): string {
  if (alert.store_id) return storeLabel(alert.store_id, names.stores?.get(alert.store_id));
  if (alert.organization_id) {
    return organizationLabel(
      alert.organization_id,
      names.organizations?.get(alert.organization_id),
    );
  }
  return 'Plataforma (sin tienda)';
}

/**
 * Las líneas legibles de una alerta, en el mismo orden para Telegram, el
 * correo/ticket de soporte y el detalle de Superadmin (S6).
 */
export function contextLines(
  alert: ContextAlert,
  names: AlertNames = {},
): AlertContextLine[] {
  const context = readStoredContext(alert.details);
  const lines: AlertContextLine[] = [];
  if (alert.store_id) {
    lines.push({
      label: 'Tienda',
      value: storeLabel(alert.store_id, names.stores?.get(alert.store_id)),
      href: `/super-admin/stores/${alert.store_id}`,
    });
  }
  if (alert.organization_id) {
    lines.push({
      label: 'Organización',
      value: organizationLabel(alert.organization_id, names.organizations?.get(alert.organization_id)),
      href: `/super-admin/organizations/${alert.organization_id}`,
    });
  }
  if (!alert.store_id && !alert.organization_id) {
    lines.push({ label: 'Afecta a', value: 'Plataforma (sin tienda)' });
  }
  const others = (alert.affected_store_ids ?? []).filter((id) => id !== alert.store_id);
  if (others.length > 0) {
    const shown = others.slice(0, 10).map((id) => storeLabel(id, names.stores?.get(id)));
    lines.push({
      label: 'Otras tiendas',
      value: `${shown.join(', ')}${others.length > 10 ? ` y ${others.length - 10} más` : ''}`,
    });
  }
  if (context.userId) {
    lines.push({ label: 'Usuario', value: userLabel(context.userId, names.users?.get(context.userId)) });
  }
  if (context.module) lines.push({ label: 'Módulo', value: context.module });
  if (context.action) lines.push({ label: 'Acción', value: context.action });
  if (context.entityType && context.entityId) {
    const label = ENTITY_LABELS[context.entityType];
    lines.push({
      label: 'Registro',
      value: names.entityName
        ? `${label} «${names.entityName}» (id ${context.entityId})`
        : `${label} (id ${context.entityId})`,
    });
  }
  const origin = describeJobSource(context.origin);
  if (origin) lines.push({ label: 'Origen', value: origin });
  if (context.category === 'plan_limit') {
    lines.push({ label: 'Plan', value: names.plan ?? 'no disponible' });
    if (names.quota) lines.push({ label: 'Cupo', value: names.quota });
  }
  return lines;
}

/** Contexto solo con ids, cuando no hay resolutor o falló del todo. */
export function fallbackContext(alert: ContextAlert): ResolvedAlertContext {
  return {
    lines: contextLines(alert),
    scopeLabel: scopeLabelOf(alert),
    superadminUrl: null,
  };
}

function detailLines(details: unknown): string[] {
  return Object.entries(displayDetails(details))
    .slice(0, 8)
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(value)}`);
}

/** Pie con enlace al detalle en Superadmin cuando hay `FRONTEND_URL`. */
function footer(alertId: number, superadminUrl: string | null): string {
  return superadminUrl
    ? `<a href="${escapeHtml(superadminUrl)}">Alerta #${alertId}</a> · Superadmin → Monitoreo → Alertas`
    : `Alerta #${alertId} · Superadmin → Monitoreo → Alertas`;
}

/**
 * Mensaje de Telegram de una alerta abierta. Se reescribe (edit) con el conteo
 * cada vez que la falla se repite, así el chat no se llena de copias. Sin
 * `context` resuelto sale igual, con ids (QUI-1031, criterio 4).
 */
export function formatAlertMessage(
  alert: PlatformAlertRow,
  envLabel: string,
  context: ResolvedAlertContext = fallbackContext(alert),
): string {
  const severity = severityOf(alert.severity);
  const planLimit = isPlanLimitAlert(alert);
  const header = planLimit
    ? `${SEVERITY_ICONS.info} <b>${PLAN_LIMIT_LABEL.toUpperCase()}</b> · ${SEVERITY_LABELS.info} · ${escapeHtml(envLabel)}`
    : `${SEVERITY_ICONS[severity]} <b>${SEVERITY_LABELS[severity].toUpperCase()}</b> · ${escapeHtml(alertKindLabel(alert))} · ${escapeHtml(envLabel)}`;
  const lines = [
    header,
    `<b>${escapeHtml(alert.title)}</b>`,
    '',
    ...context.lines.map(
      (line) => `<b>${escapeHtml(line.label)}:</b> ${escapeHtml(line.value)}`,
    ),
    `<b>Proceso:</b> <code>${escapeHtml(alert.process)}</code>`,
    `<b>Tipo de error:</b> <code>${escapeHtml(alert.error_type)}</code>`,
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
  lines.push('', footer(alert.id, context.superadminUrl));
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
