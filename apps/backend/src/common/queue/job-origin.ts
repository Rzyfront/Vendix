import { RequestContextService } from '../context/request-context.service';

/**
 * QUI-1031 — quién y desde dónde se encoló un trabajo de BullMQ.
 *
 * Todo productor pasa su `data` por `withJobOrigin` (o suma `jobOrigin`) para
 * que el bot de monitoreo diga en la alerta qué usuario lo disparó y desde
 * qué pantalla, evento o tarea programada, sin buscar en la base.
 *
 * `source` es `<tipo>:<detalle>`:
 * - `http`: una petición de un usuario (`http:compras/escanear-factura`).
 * - `event`: un evento interno (`event:product.updated`).
 * - `cron`: una tarea programada (`cron:embedding-sync`).
 * - `webhook`: un aviso de un tercero (`webhook:meta-whatsapp`).
 * - `job`: otro trabajo en segundo plano (`job:billing-warning`).
 * - `system`: arranque, despliegue o mantenimiento (`system:tool-catalog`).
 */
export type JobOriginKind =
  | 'http'
  | 'event'
  | 'cron'
  | 'webhook'
  | 'job'
  | 'system';

export type JobOriginSource = `${JobOriginKind}:${string}`;

export interface JobOrigin {
  /** Usuario de la petición que lo encoló; `null` si no hubo uno (cron, webhook…). */
  triggered_by_user_id: number | null;
  source: JobOriginSource;
}

export const JOB_ORIGIN_KIND_LABELS: Record<JobOriginKind, string> = {
  http: 'Pantalla o API',
  event: 'Evento',
  cron: 'Tarea programada',
  webhook: 'Webhook',
  job: 'Otro trabajo',
  system: 'Sistema',
};

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Usuario de la petición en curso. Lee SOLO el AsyncLocalStorage: el estático
 * `currentContext` de `RequestContextService.getContext()` es «el último
 * contexto que alguien miró» y atribuiría el trabajo a otro usuario.
 */
export function currentRequestUserId(): number | null {
  return positiveId(RequestContextService.asyncLocalStorage.getStore()?.user_id);
}

/**
 * Origen de un trabajo. Sin `userId` toma el usuario de la petición en curso;
 * con `userId` (también `null`) usa ese, para quien encola fuera de la
 * petición pero sabe quién lo pidió (p. ej. un reintento manual).
 */
export function jobOrigin(
  source: JobOriginSource,
  userId?: number | null,
): JobOrigin {
  return {
    triggered_by_user_id:
      userId === undefined ? currentRequestUserId() : positiveId(userId),
    source,
  };
}

/** `data` del trabajo con su origen. */
export function withJobOrigin<T extends object>(
  data: T,
  source: JobOriginSource,
  userId?: number | null,
): T & JobOrigin {
  return { ...data, ...jobOrigin(source, userId) };
}

/**
 * Lee el origen del `data` de un trabajo para la alerta. Los trabajos encolados
 * antes de QUI-1031 no traen `triggered_by_user_id`: se cae a los campos que
 * cada cola ya usaba (`user_id`, `userId`, `context.user_id`, `actor_id`).
 */
export function readJobOrigin(data: unknown): {
  userId: number | null;
  source: string | null;
} {
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const context =
    record.context && typeof record.context === 'object'
      ? (record.context as Record<string, unknown>)
      : {};
  const userId =
    positiveId(record.triggered_by_user_id) ??
    positiveId(record.user_id) ??
    positiveId(record.userId) ??
    positiveId(context.user_id) ??
    positiveId(context.actor_id) ??
    positiveId(record.actor_id);
  const source =
    typeof record.source === 'string' && /^[a-z]+:\S/.test(record.source)
      ? record.source.slice(0, 120)
      : null;
  return { userId, source };
}

/** «Evento product.updated», «Tarea programada embedding-sync». */
export function describeJobSource(source: string | null | undefined): string | null {
  if (!source) return null;
  const separator = source.indexOf(':');
  if (separator <= 0) return source;
  const kind = source.slice(0, separator) as JobOriginKind;
  const detail = source.slice(separator + 1).trim();
  const label = JOB_ORIGIN_KIND_LABELS[kind];
  if (!label) return source;
  return detail ? `${label} ${detail}` : label;
}
