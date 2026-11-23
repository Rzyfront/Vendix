import type { AlertEntityType } from './platform-alert-catalog';

/**
 * QUI-1010 — bot de monitoreo de la API.
 *
 * Gravedades (vocabulario del ticket):
 * - `info`: informativa (latencia anormal). Solo Telegram.
 * - `warning`: leve. Solo Telegram.
 * - `critical`: grave. Telegram + correo a soporte + ticket en Superadmin.
 */
export type PlatformAlertSeverity = 'info' | 'warning' | 'critical';

export const PLATFORM_ALERT_SEVERITIES: readonly PlatformAlertSeverity[] = [
  'info',
  'warning',
  'critical',
];

/**
 * Quién vio la falla:
 * - `http`: respuesta 5xx de la API (`AllExceptionsFilter`).
 * - `latency`: respuesta por encima del umbral (`PerformanceInterceptor`).
 * - `job`: job de BullMQ que falló de forma final (barrido del worker).
 * - `job_stalled`: job activo que no termina.
 * - `queue_stalled`: cola con trabajo esperando y nadie que lo procese.
 * - `worker`: el worker dejó de dar latido.
 * - `incident`: incidente de QUI-1009 / QUI-1020 (`PlatformIncidentService`).
 * - `test`: alerta de prueba disparada desde Superadmin.
 */
export type PlatformAlertSource =
  | 'http'
  | 'latency'
  | 'job'
  | 'job_stalled'
  | 'queue_stalled'
  | 'worker'
  | 'incident'
  | 'test';

export type PlatformAlertStatus = 'open' | 'resolved';

/**
 * Cómo se cerró un episodio:
 * - `auto_quiet`: dejó de repetirse durante `MONITOR_RESOLVE_AFTER_MINUTES`.
 * - `recovered`: la condición observada desapareció (worker con latido, cola
 *   que vuelve a procesar, job que dejó de estar colgado).
 * - `ticket_closed`: soporte resolvió o cerró su ticket.
 * - `manual`: alguien la marcó resuelta en Superadmin.
 */
export type PlatformAlertResolution =
  | 'auto_quiet'
  | 'recovered'
  | 'ticket_closed'
  | 'manual';

export type PlatformAlertDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * QUI-1031 — contexto legible de la falla. Se guarda en `details._context`
 * (sin migración) y SOLO con ids, módulo, acción y origen: los nombres de
 * tienda, organización, usuario y registro se resuelven al mostrar la alerta
 * (`PlatformAlertContextService`), porque el saneo taparía los correos y un
 * nombre guardado envejece.
 */
export interface PlatformAlertContext {
  /** Usuario que disparó la petición o encoló el trabajo. */
  userId?: number | null;
  /** Módulo de Vendix («Productos»). */
  module?: string | null;
  /** Lo que se estaba haciendo («indexar el producto para la búsqueda con IA»). */
  action?: string | null;
  /** Origen del trabajo, `<tipo>:<detalle>` (`event:product.updated`). */
  origin?: string | null;
  entityType?: AlertEntityType | null;
  entityId?: number | null;
  /** `plan_limit`: la tienda llegó a un límite de su plan; no es fallo técnico. */
  category?: 'plan_limit' | null;
  planLimitCode?: string | null;
  /** Funcionalidad de IA cuyo cupo se agotó (`rag_embeddings`…). */
  aiFeature?: string | null;
  /** Periodo del cupo (`YYYYMM` o `YYYYMMDD`, UTC). */
  period?: string | null;
}

/** Clave de `details` donde vive el contexto (no se muestra como detalle). */
export const ALERT_CONTEXT_KEY = '_context';

/** Una falla observada. Se sanea antes de guardarse o enviarse. */
export interface PlatformAlertEvent {
  source: PlatformAlertSource;
  /** Proceso afectado, p. ej. `POST /store/orders/:id/payments` o `cola email-notifications · send`. */
  process: string;
  /** Tipo de error: código Vendix, `HTTP_500`, `slow_request`, `job_failed`… */
  errorType: string;
  severity: PlatformAlertSeverity;
  title: string;
  /** Muestra legible del error. Nunca cuerpos de petición ni cabeceras. */
  message?: string | null;
  details?: PlatformAlertDetails;
  organizationId?: number | null;
  storeId?: number | null;
  context?: PlatformAlertContext;
  /**
   * Clave de agrupación cuando no basta origen + proceso + tipo. La misma
   * clave suma ocurrencias a la alerta abierta en vez de abrir otra.
   */
  groupKey?: string;
  /** Otro reportero (QUI-1009/1020) ya abrió ticket y correo: el bot no los repite. */
  incidentHandled?: boolean;
  /** Ticket que ya abrió ese otro reportero. */
  ticketNumber?: string | null;
  /**
   * La misma condición observada otra vez (un job que sigue colgado en el
   * siguiente barrido): mantiene abierto el episodio sin sumar una repetición.
   */
  alreadyCounted?: boolean;
  occurredAt?: Date;
}

/** Fila de `platform_alerts` que necesita el servicio. */
export interface PlatformAlertRow {
  id: number;
  fingerprint: string;
  source: string;
  process: string;
  error_type: string;
  severity: string;
  status: string;
  title: string;
  message: string | null;
  details: unknown;
  organization_id: number | null;
  store_id: number | null;
  affected_store_ids: number[];
  occurrences: number;
  notified_occurrences: number;
  first_seen_at: Date;
  last_seen_at: Date;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolution: string | null;
  resolved_by_user_id: number | null;
  ticket_number: string | null;
  telegram_message_id: string | null;
}

/** Resultado de registrar una falla de inmediato (alerta de prueba). */
export interface PlatformAlertRecordResult {
  alert: PlatformAlertRow;
  /** `true` si esta llamada abrió el episodio. */
  opened: boolean;
}

/** Una línea legible de la alerta: igual en Telegram, correo y Superadmin. */
export interface AlertContextLine {
  label: string;
  value: string;
  href?: string | null;
}

export interface ResolvedAlertContext {
  lines: AlertContextLine[];
  /** «Vendix Granizzo (testbalmes, id 105)», o «Plataforma (sin tienda)». */
  scopeLabel: string;
  /** Detalle de la alerta en Superadmin, si hay `FRONTEND_URL`. */
  superadminUrl: string | null;
}
