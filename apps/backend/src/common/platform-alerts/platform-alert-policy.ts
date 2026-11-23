import { LEGACY_AI_SOURCES } from '../ai-scan-jobs/ai-scan-sources';
import { findErrorCodeEntry } from '../errors/error-codes';
import { BULK_UPLOAD_JOBS_QUEUE } from '../../domains/store/bulk-uploads/bulk-upload-job.types';
import type {
  PlatformAlertSeverity,
  PlatformAlertSource,
} from './platform-alert.types';

/**
 * POLÍTICA DE GRAVEDAD DEL BOT DE MONITOREO (QUI-1010).
 *
 * El ticket define grave como lo que «afecta ventas, pagos, facturación DIAN,
 * cargas masivas o deja una función sin servicio», y deja abierto «definir con
 * el equipo qué errores se consideran graves». Este archivo es el ÚNICO lugar
 * donde se decide: ajustarlo no exige tocar el resto del bot.
 *
 * - Grave: 5xx en rutas de esas áreas, 503 (base o servicio saturado), jobs de
 *   colas de esas áreas, colas sin procesar y worker sin latido.
 * - Leve: el resto de 5xx y de jobs fallidos o colgados. Si la misma falla leve
 *   se repite `escalateAfter` veces en un episodio, sube a grave («deja una
 *   función sin servicio»).
 * - Informativa: latencia por encima del umbral.
 */

/** Rutas (sin el prefijo global `/api`) cuya falla es grave, con su área. */
export const CRITICAL_ROUTE_AREAS: ReadonlyArray<{
  pattern: RegExp;
  area: string;
}> = [
  {
    area: 'cargas masivas',
    pattern: /(^|\/)(bulk|bulk-uploads|bulk-edit|bulk-images|bulk-scan)(\/|$)/,
  },
  {
    area: 'facturación DIAN',
    pattern:
      /^\/((store|organization)\/(invoicing|invoice-data-requests)|super-admin\/fiscal\/invoicing|superadmin\/subscriptions\/fiscal|public\/received-documents)(\/|$)|(^|\/)dian(\/|$)/,
  },
  {
    area: 'pagos',
    pattern:
      /^\/((store|organization)\/(payments|subscriptions|payment-links|payment-requests)|ecommerce\/payment-requests|superadmin\/subscriptions|(platform|store)\/webhooks)(\/|$)/,
  },
  {
    area: 'ventas',
    pattern:
      /^\/((store|organization)\/(orders|pos|cash-registers|layaway|scheduled-orders)|ecommerce\/(checkout|cart|orders|scheduled-orders))(\/|$)/,
  },
];

/** Colas cuyo job fallido o colgado es grave (por nombre de cola). */
export const CRITICAL_QUEUE_PATTERN =
  /payment|billing|subscription|dian|invoice|document-reception|accounting|commission|bulk/i;

/**
 * Colas que NO barre el bot porque ya avisan por `PlatformIncidentService`
 * (sus incidentes llegan al bot por evento): la cola genérica de IA, las colas
 * de escaneo con IA de cada dominio (QUI-1020) y las cargas masivas (QUI-1009).
 * Barrerlas otra vez contaría la misma falla dos veces.
 */
export const QUEUES_WITH_OWN_INCIDENTS: ReadonlySet<string> = new Set([
  'ai-scan',
  ...Object.values(LEGACY_AI_SOURCES).map((source) => source.queue),
  BULK_UPLOAD_JOBS_QUEUE,
]);

/** Orígenes cuya falla leve puede subir a grave al repetirse. */
const ESCALATING_SOURCES: ReadonlySet<PlatformAlertSource> = new Set([
  'http',
  'job',
  'job_stalled',
]);

export function canEscalate(source: string): boolean {
  return ESCALATING_SOURCES.has(source as PlatformAlertSource);
}

/** Quita el prefijo global (`/api`) para comparar con la política. */
export function stripApiPrefix(path: string): string {
  const prefix = `/${(process.env.API_PREFIX || 'api').replace(/^\/+|\/+$/g, '')}`;
  if (path === prefix) return '/';
  return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
}

/** Área crítica de una ruta normalizada, o `null`. */
export function criticalAreaOfRoute(route: string): string | null {
  const path = stripApiPrefix(route);
  return CRITICAL_ROUTE_AREAS.find((r) => r.pattern.test(path))?.area ?? null;
}

/** Gravedad de una respuesta 5xx. */
export function severityOfHttpFailure(
  route: string,
  status: number,
): { severity: PlatformAlertSeverity; area: string | null } {
  if (status === 503) {
    return { severity: 'critical', area: 'servicio no disponible' };
  }
  const area = criticalAreaOfRoute(route);
  return { severity: area ? 'critical' : 'warning', area };
}

export function severityOfQueue(queue: string): PlatformAlertSeverity {
  return CRITICAL_QUEUE_PATTERN.test(queue) ? 'critical' : 'warning';
}

/**
 * LÍMITES DE PLAN (QUI-1031). Que una tienda agote el cupo de IA o use algo que
 * su plan no incluye es un límite de negocio, no un fallo de Vendix: la alerta
 * es informativa («Límite de plan»), sin ticket ni correo, nunca sube a grave
 * y se avisa una vez por tienda, código y periodo.
 */
export const PLAN_LIMIT_CODES: Readonly<Record<string, string>> = {
  SUBSCRIPTION_004: 'la tienda no tiene una suscripción activa para usar IA',
  SUBSCRIPTION_005: 'la función no está incluida en el plan de la tienda',
  SUBSCRIPTION_006: 'la tienda agotó el cupo de IA de su plan en el periodo',
  SUBSCRIPTION_008: 'la suscripción está suspendida por saldo pendiente',
  SUBSCRIPTION_009: 'la suscripción está bloqueada por facturación',
  SUBSCRIPTION_011: 'el plan de la tienda fue retirado',
  WORKFLOW_PLAN_LIMIT_REACHED: 'la tienda llegó al límite de Flujos de su plan',
  PLAN_MODULE_NOT_INCLUDED: 'el módulo no está incluido en el plan de la tienda',
};

export interface PlanLimitMatch {
  code: string;
  label: string;
}

/**
 * Reconoce un límite de plan por su código (tipo de error o dentro del
 * mensaje) o por el mensaje del código: BullMQ guarda en `failedReason` el
 * MENSAJE de la excepción («AI quota exceeded for this billing period»), no
 * el código.
 */
export function classifyPlanLimit(
  errorType: string | null | undefined,
  message: string | null | undefined,
): PlanLimitMatch | null {
  const type = (errorType ?? '').trim();
  const text = message ?? '';
  for (const [code, label] of Object.entries(PLAN_LIMIT_CODES)) {
    if (type === code || new RegExp(`\\b${code}\\b`).test(text)) {
      return { code, label };
    }
    const devMessage = findErrorCodeEntry(code)?.devMessage;
    if (devMessage && (type === devMessage || text.includes(devMessage))) {
      return { code, label };
    }
  }
  return null;
}

/** Cupos de IA que se reinician cada día; el resto es mensual. */
const DAILY_AI_FEATURES: ReadonlySet<string> = new Set(['streaming_chat']);

/**
 * Periodo del límite en UTC, la misma llave que el contador de cupo
 * (`YYYYMM`, o `YYYYMMDD` para un cupo diario).
 */
export function planLimitPeriod(at: Date, aiFeature?: string | null): string {
  const iso = at.toISOString();
  const month = `${iso.slice(0, 4)}${iso.slice(5, 7)}`;
  return aiFeature && DAILY_AI_FEATURES.has(aiFeature)
    ? `${month}${iso.slice(8, 10)}`
    : month;
}

/** Configuración del bot (variables `MONITOR_*`). */
export interface MonitorConfig {
  enabled: boolean;
  envLabel: string;
  slowRequestMs: number;
  slowRequestIgnore: string[];
  resolveAfterMinutes: number;
  escalateAfter: number;
  jobActiveStallMinutes: number;
  jobWaitingStallMinutes: number;
  workerHeartbeatMaxMinutes: number;
  telegramMaxPerMinute: number;
}

type ConfigReader = { get<T = string>(key: string): T | undefined };

/** Entero positivo o el valor por defecto (0, negativos y basura → defecto). */
export function positiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function readMonitorConfig(config: ConfigReader): MonitorConfig {
  const enabledRaw = String(config.get('MONITOR_ENABLED') ?? '')
    .trim()
    .toLowerCase();
  return {
    enabled: !['false', '0', 'no', 'off'].includes(enabledRaw),
    envLabel:
      String(config.get('MONITOR_ENV_LABEL') ?? '').trim() ||
      String(config.get('NODE_ENV') ?? '').trim() ||
      'sin entorno',
    slowRequestMs: positiveInt(config.get('MONITOR_SLOW_REQUEST_MS'), 10_000),
    slowRequestIgnore: String(config.get('MONITOR_SLOW_REQUEST_IGNORE') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
    resolveAfterMinutes: positiveInt(
      config.get('MONITOR_RESOLVE_AFTER_MINUTES'),
      30,
    ),
    escalateAfter: positiveInt(config.get('MONITOR_ESCALATE_AFTER'), 20),
    jobActiveStallMinutes: positiveInt(
      config.get('MONITOR_JOB_ACTIVE_STALL_MINUTES'),
      15,
    ),
    jobWaitingStallMinutes: positiveInt(
      config.get('MONITOR_JOB_WAITING_STALL_MINUTES'),
      5,
    ),
    workerHeartbeatMaxMinutes: positiveInt(
      config.get('MONITOR_WORKER_HEARTBEAT_MAX_MINUTES'),
      3,
    ),
    telegramMaxPerMinute: positiveInt(
      config.get('MONITOR_TELEGRAM_MAX_PER_MINUTE'),
      20,
    ),
  };
}
