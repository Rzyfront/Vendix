import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { RequestContextService } from '../context/request-context.service';
import { currentRequestUserId } from '../queue/job-origin';
import { PlatformIncidentService } from '../incidents/platform-incident.service';
import {
  PLATFORM_INCIDENT_REPORTED_EVENT,
  type PlatformIncidentReportedEvent,
} from '../incidents/platform-incident.types';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PlatformOrgService } from '../services/platform-org.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { describeHttpRoute, describeJob } from './platform-alert-catalog';
import { PlatformAlertContextService } from './platform-alert-context.service';
import {
  PLAN_LIMIT_LABEL,
  SOURCE_LABELS,
  fallbackContext,
  formatAlertMessage,
  formatDateTime,
  formatEscalationMessage,
  formatResolutionMessage,
  isPlanLimitAlert,
  severityOf,
} from './platform-alert-format';
import {
  PLAN_LIMIT_CODES,
  canEscalate,
  classifyPlanLimit,
  planLimitPeriod,
  readMonitorConfig,
  severityOfHttpFailure,
  stripApiPrefix,
  type MonitorConfig,
  type PlanLimitMatch,
} from './platform-alert-policy';
import {
  fingerprintOf,
  sanitizeAlertDetails,
  sanitizeAlertText,
  summarizeError,
} from './platform-alert-sanitize';
import { TelegramNotifierService } from './telegram-notifier.service';
import {
  ALERT_CONTEXT_KEY,
  type PlatformAlertContext,
  type PlatformAlertEvent,
  type PlatformAlertRecordResult,
  type PlatformAlertResolution,
  type PlatformAlertRow,
  type PlatformAlertSeverity,
  type ResolvedAlertContext,
} from './platform-alert.types';

/** `source` de los incidentes que abre el propio bot (su evento se ignora). */
export const API_MONITOR_INCIDENT_SOURCE = 'api_monitor';

const FLUSH_INTERVAL_MS = 5_000;
/** Huellas distintas que caben en el búfer entre dos vaciados. */
const MAX_BUFFERED_FINGERPRINTS = 200;
const MAX_AFFECTED_STORES = 50;
/** Una edición del mensaje de Telegram por alerta cada tanto (límites de Telegram). */
const TELEGRAM_EDIT_THROTTLE_SECONDS = 30;
const EDIT_THROTTLE_KEY_PREFIX = 'monitor:alert:edit:';
/**
 * Un «Límite de plan» se avisa por Telegram una vez por tienda y periodo
 * (QUI-1031): la llave vive más que el periodo más largo (un mes).
 */
const PLAN_LIMIT_NOTIFIED_KEY_PREFIX = 'monitor:plan-limit:notified:';
const PLAN_LIMIT_NOTIFIED_TTL_SECONDS = 40 * 24 * 60 * 60;
const SWEEP_BATCH = 100;
const PLAN_LIMIT_ERROR_TYPES = Object.keys(PLAN_LIMIT_CODES);

const SEVERITY_RANK: Record<PlatformAlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

const INCIDENT_SOURCE_LABELS: Record<string, string> = {
  bulk_upload_job: 'Carga masiva',
  ai_job: 'Proceso de IA',
};

/** Observaciones de una misma huella acumuladas entre dos vaciados. */
interface Observation {
  fingerprint: string;
  /** Última observación, ya saneada. */
  event: PlatformAlertEvent;
  /** Repeticiones nuevas (0 si todas eran `alreadyCounted`). */
  count: number;
  storeIds: Set<number>;
  lastAt: Date;
}

/**
 * Identidad del request para la alerta. El `PerformanceInterceptor` y el
 * filtro de excepciones corren fuera del `AsyncLocalStorage` que arma
 * `RequestContextInterceptor`, así que la leen del `req.user` y la pasan
 * explícita: sin esto el bot decía «Plataforma (sin tienda)» en errores que
 * eran de una tienda y se perdía el usuario que los ejecutó.
 */
export interface AlertRequestIdentity {
  organizationId?: number | null;
  storeId?: number | null;
  userId?: number | null;
  /** Valores resueltos de la ruta (ids), ya saneados por el llamador. */
  params?: Record<string, string> | null;
}

export interface HttpFailureInput extends AlertRequestIdentity {
  method: string;
  /** Ruta sin valores (`routeKeyOf`). */
  route: string;
  status: number;
  errorCode?: string | null;
  error?: unknown;
  requestId?: string | null;
}

export interface SlowRequestInput extends AlertRequestIdentity {
  method: string;
  route: string;
  durationMs: number;
  statusCode?: number;
  requestId?: string | null;
}

/**
 * Núcleo del bot de monitoreo (QUI-1010): registra cada falla en
 * `platform_alerts`, la agrupa por huella, avisa por Telegram y, si es grave,
 * abre UN ticket y manda UN correo por episodio con `PlatformIncidentService`
 * (QUI-1009).
 *
 * Las capturas (`capture*`) son síncronas y nunca lanzan: solo suman a un búfer
 * en memoria que se vacía cada 5 s, así una tormenta de 500 no se vuelve una
 * tormenta de escrituras. Un episodio = filas `open` de una huella; el índice
 * único parcial de la migración garantiza que haya una sola entre procesos.
 */
@Injectable()
export class PlatformAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformAlertService.name);
  readonly settings: MonitorConfig;
  private buffer = new Map<string, Observation>();
  private dropped = 0;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly incidents: PlatformIncidentService,
    private readonly platformOrg: PlatformOrgService,
    private readonly telegram: TelegramNotifierService,
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly alertContext: PlatformAlertContextService,
  ) {
    this.settings = readMonitorConfig(config);
  }

  onModuleInit(): void {
    if (!this.settings.enabled) {
      this.logger.warn('Bot de monitoreo apagado (MONITOR_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Lo capturado durante un vaciado en curso queda en el búfer nuevo: se
    // vacía hasta que no quede nada (los 5xx de un apagado son los que importan).
    do {
      await this.flush();
    } while (this.buffer.size > 0 || this.flushing);
  }

  // ---------------------------------------------------------------------------
  // Captura
  // ---------------------------------------------------------------------------

  /** Registra una falla en el búfer. Nunca lanza. */
  capture(event: PlatformAlertEvent): void {
    if (!this.settings.enabled) return;
    try {
      this.observe(event);
    } catch (error) {
      this.logger.warn(`Alerta no capturada: ${(error as Error)?.message}`);
    }
  }

  /** Respuesta 5xx (`AllExceptionsFilter`). */
  captureHttpFailure(input: HttpFailureInput): void {
    if (!this.settings.enabled || input.status < 500) return;
    try {
      this.captureHttpFailureUnsafe(input);
    } catch (error) {
      this.logger.warn(`5xx no capturado: ${(error as Error)?.message}`);
    }
  }

  private captureHttpFailureUnsafe(input: HttpFailureInput): void {
    const context = RequestContextService.asyncLocalStorage.getStore();
    const identity = this.requestIdentity(input, context);
    const { severity, area } = severityOfHttpFailure(input.route, input.status);
    const process = `${input.method.toUpperCase()} ${stripApiPrefix(input.route)}`;
    const described = describeHttpRoute(input.method, input.route);
    this.capture({
      source: 'http',
      process,
      errorType: input.errorCode || `HTTP_${input.status}`,
      severity,
      title: area
        ? `Error ${input.status} en ${area}: ${process}`
        : `Error ${input.status}: ${process}`,
      message: summarizeError(input.error),
      details: {
        'Código HTTP': input.status,
        Área: area,
        'Petición (id)': input.requestId,
        ...(identity.params ? { Parámetros: this.paramsLine(identity.params) } : {}),
      },
      organizationId: identity.organizationId,
      storeId: identity.storeId,
      context: {
        userId: identity.userId,
        module: described.module,
        action: described.action,
      },
    });
  }

  /** Respuesta por encima de `MONITOR_SLOW_REQUEST_MS` (`PerformanceInterceptor`). */
  captureSlowRequest(input: SlowRequestInput): void {
    if (!this.settings.enabled || input.durationMs < this.settings.slowRequestMs) {
      return;
    }
    try {
      this.captureSlowRequestUnsafe(input);
    } catch (error) {
      this.logger.warn(`Latencia no capturada: ${(error as Error)?.message}`);
    }
  }

  private captureSlowRequestUnsafe(input: SlowRequestInput): void {
    const { slowRequestMs, slowRequestIgnore } = this.settings;
    const path = stripApiPrefix(input.route);
    if (slowRequestIgnore.some((ignored) => path.includes(ignored))) return;
    const context = RequestContextService.asyncLocalStorage.getStore();
    const identity = this.requestIdentity(input, context);
    const process = `${input.method.toUpperCase()} ${path}`;
    const durationMs = Math.round(input.durationMs);
    const described = describeHttpRoute(input.method, input.route);
    this.capture({
      source: 'latency',
      process,
      errorType: 'slow_request',
      severity: 'info',
      title: `Respuesta lenta: ${process}`,
      message: `Tardó ${durationMs} ms (umbral ${slowRequestMs} ms).`,
      details: {
        'Duración (ms)': durationMs,
        'Umbral (ms)': slowRequestMs,
        'Código HTTP': input.statusCode,
        'Petición (id)': input.requestId,
        ...(identity.params ? { Parámetros: this.paramsLine(identity.params) } : {}),
      },
      organizationId: identity.organizationId,
      storeId: identity.storeId,
      context: {
        userId: identity.userId,
        module: described.module,
        action: described.action,
      },
    });
  }

  /** Quién y de qué tienda es la alerta: lo explícito del request manda sobre el ALS. */
  private requestIdentity(
    input: AlertRequestIdentity,
    context: ReturnType<typeof RequestContextService.asyncLocalStorage.getStore>,
  ): { organizationId: number | null; storeId: number | null; userId: number | null; params: Record<string, string> | null } {
    return {
      organizationId: input.organizationId ?? context?.organization_id ?? null,
      storeId: input.storeId ?? context?.store_id ?? null,
      userId: input.userId ?? currentRequestUserId() ?? null,
      params: input.params ?? null,
    };
  }

  /** `orderId=123, invoiceId=45` para que la alerta sea rastreable. */
  private paramsLine(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
  }

  /**
   * Incidentes de QUI-1009 (cargas masivas) y QUI-1020 (procesos de IA): ya
   * abrieron su ticket y su correo, el bot los registra y los manda a Telegram.
   */
  @OnEvent(PLATFORM_INCIDENT_REPORTED_EVENT)
  onIncidentReported(payload: PlatformIncidentReportedEvent): void {
    const input = payload?.input;
    if (!input || input.source === API_MONITOR_INCIDENT_SOURCE) return;
    const affected = input.affected ?? {
      organizationId: input.organizationId,
      storeId: input.storeId,
    };
    const process = input.details?.['Proceso'];
    const described = describeIncident(input.source, input.details, input.tags);
    this.capture({
      source: 'incident',
      process:
        typeof process === 'string' && process
          ? process
          : (INCIDENT_SOURCE_LABELS[input.source] ?? input.source),
      errorType: input.errorCode || input.source,
      severity: input.severity,
      title: input.title,
      message: input.summary,
      details: { Origen: input.source, ...input.details },
      organizationId: affected.organizationId ?? null,
      storeId: affected.storeId ?? null,
      context: {
        userId: input.userId ?? numberOrNull(input.details?.['Usuario (id)']),
        module: described?.module ?? null,
        action: described?.action ?? null,
      },
      groupKey: ['incident', input.source, input.errorCode ?? '', input.title].join('|'),
      incidentHandled: true,
      ticketNumber: payload.result?.ticketNumber ?? null,
    });
  }

  /** Vacía el búfer en la base. Un vaciado a la vez; nunca lanza. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.size === 0) return Promise.resolve();
    const batch = this.buffer;
    const dropped = this.dropped;
    this.buffer = new Map();
    this.dropped = 0;
    this.flushing = (async () => {
      if (dropped > 0) {
        this.logger.warn(
          `${dropped} fallas descartadas: más de ${MAX_BUFFERED_FINGERPRINTS} huellas distintas en ${FLUSH_INTERVAL_MS} ms`,
        );
      }
      for (const observation of batch.values()) {
        try {
          await this.persist(observation);
        } catch (error) {
          this.logger.error(
            `Alerta ${observation.event.process} no registrada: ${(error as Error)?.message}`,
          );
        }
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Registra una falla ya, sin pasar por el búfer (alerta de prueba). */
  async recordNow(event: PlatformAlertEvent): Promise<PlatformAlertRecordResult> {
    const observation = this.toObservation(event);
    return this.persist(observation);
  }

  /** Alerta de prueba desde Superadmin: recorre el mismo camino que una real. */
  async sendTestAlert(
    severity: 'warning' | 'critical',
    userId: number | null,
  ): Promise<PlatformAlertRecordResult> {
    const critical = severity === 'critical';
    return this.recordNow({
      source: 'test',
      process: 'Superadmin · alerta de prueba',
      errorType: critical ? 'test_alert_critical' : 'test_alert_warning',
      severity,
      title: critical ? 'Prueba de alerta grave' : 'Prueba de alerta leve',
      message: critical
        ? 'Disparada a mano para comprobar Telegram, el correo a soporte y el ticket en Superadmin.'
        : 'Disparada a mano para comprobar el aviso por Telegram.',
      details: { 'Disparada por (usuario id)': userId },
      context: {
        userId,
        module: 'Superadmin · Monitoreo',
        action: 'enviar una alerta de prueba',
        origin: 'http:superadmin/monitoreo/alerta-de-prueba',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Resolución
  // ---------------------------------------------------------------------------

  /**
   * Cierra el episodio. Solo la llamada que lo cierra avisa (S6): las graves
   * siempre, el resto cuando alguien la cierra a mano.
   */
  async resolve(
    alertId: number,
    resolution: PlatformAlertResolution,
    userId: number | null = null,
  ): Promise<PlatformAlertRow | null> {
    const { count } = await this.prisma.platform_alerts.updateMany({
      where: { id: alertId, status: 'open' },
      data: {
        status: 'resolved',
        resolved_at: new Date(),
        resolution,
        resolved_by_user_id: userId,
      },
    });
    const alert = await this.prisma.platform_alerts.findUnique({
      where: { id: alertId },
    });
    if (count !== 1 || !alert) return alert;
    if (alert.ticket_number && alert.source !== 'incident') {
      await this.syncTicketRepetitions(alert);
    }
    if (alert.severity === 'critical' || resolution === 'manual') {
      await this.telegram.send(
        formatResolutionMessage(alert, resolution, this.settings.envLabel),
        { replyToMessageId: alert.telegram_message_id },
      );
    }
    return alert;
  }

  /** Cierra el episodio abierto de una clave de agrupación, si lo hay. */
  async resolveGroup(
    groupKey: string,
    resolution: PlatformAlertResolution,
  ): Promise<void> {
    const open = await this.prisma.platform_alerts.findFirst({
      where: { fingerprint: fingerprintOf(groupKey), status: 'open' },
      select: { id: true },
    });
    if (open) await this.resolve(open.id, resolution);
  }

  /**
   * Cierra los episodios de condiciones (`job_stalled`, `queue_stalled`) que el
   * último barrido completo ya no vio.
   */
  async resolveMissingConditions(
    sources: string[],
    seenFingerprints: ReadonlySet<string>,
  ): Promise<void> {
    const open = await this.prisma.platform_alerts.findMany({
      where: { status: 'open', source: { in: sources } },
      select: { id: true, fingerprint: true },
      take: SWEEP_BATCH,
    });
    for (const alert of open) {
      if (!seenFingerprints.has(alert.fingerprint)) {
        await this.resolve(alert.id, 'recovered');
      }
    }
  }

  /**
   * Barrido periódico (worker): cierra lo que dejó de repetirse o cuyo ticket
   * se cerró, y pone al día el conteo de los mensajes de Telegram.
   */
  async sweepOpenAlerts(now = new Date()): Promise<void> {
    await this.flush();
    const cutoff = new Date(
      now.getTime() - this.settings.resolveAfterMinutes * 60_000,
    );
    const quiet = await this.prisma.platform_alerts.findMany({
      where: {
        status: 'open',
        last_seen_at: { lt: cutoff },
        error_type: { notIn: PLAN_LIMIT_ERROR_TYPES },
      },
      select: { id: true },
      orderBy: { last_seen_at: 'asc' },
      take: SWEEP_BATCH,
    });
    for (const { id } of quiet) await this.resolve(id, 'auto_quiet');

    // Un «Límite de plan» sigue abierto mientras dure su periodo (una alerta
    // por tienda y periodo) y se cierra cuando cambia el mes.
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const pastPeriods = await this.prisma.platform_alerts.findMany({
      where: {
        status: 'open',
        last_seen_at: { lt: monthStart },
        error_type: { in: PLAN_LIMIT_ERROR_TYPES },
      },
      select: { id: true },
      orderBy: { last_seen_at: 'asc' },
      take: SWEEP_BATCH,
    });
    for (const { id } of pastPeriods) await this.resolve(id, 'auto_quiet');

    const withTicket = await this.prisma.platform_alerts.findMany({
      where: { status: 'open', ticket_number: { not: null } },
      select: { id: true, ticket_number: true },
      take: SWEEP_BATCH,
    });
    if (withTicket.length > 0) {
      const closed = await this.prisma.support_tickets.findMany({
        where: {
          ticket_number: {
            in: withTicket.map((a) => a.ticket_number as string),
          },
          status: { in: ['RESOLVED', 'CLOSED'] },
        },
        select: { ticket_number: true },
      });
      const closedNumbers = new Set(closed.map((t) => t.ticket_number));
      for (const alert of withTicket) {
        if (closedNumbers.has(alert.ticket_number as string)) {
          await this.resolve(alert.id, 'ticket_closed');
        }
      }
    }

    const behind = await this.prisma.platform_alerts.findMany({
      where: { status: 'open', telegram_message_id: { not: null } },
      take: SWEEP_BATCH,
    });
    for (const alert of behind) {
      if (alert.occurrences > alert.notified_occurrences) {
        await this.syncTelegram(alert);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Interno
  // ---------------------------------------------------------------------------

  private toObservation(raw: PlatformAlertEvent): Observation {
    const planLimit =
      raw.source === 'test' ? null : classifyPlanLimit(raw.errorType, raw.message);
    const event = planLimit ? toPlanLimitEvent(raw, planLimit) : raw;
    const sanitized: PlatformAlertEvent = {
      ...event,
      process: sanitizeAlertText(event.process, 255) || 'desconocido',
      errorType: sanitizeAlertText(event.errorType, 120) || 'desconocido',
      title: sanitizeAlertText(event.title, 255) || 'Falla sin título',
      message: sanitizeAlertText(event.message, 500) || null,
      details: sanitizeAlertDetails(event.details),
      context: sanitizeContext(event.context),
    };
    const fingerprint = fingerprintOf(
      event.groupKey ??
        [sanitized.source, sanitized.process, sanitized.errorType].join('|'),
    );
    const storeIds = new Set<number>();
    if (sanitized.storeId) storeIds.add(sanitized.storeId);
    return {
      fingerprint,
      event: sanitized,
      count: event.alreadyCounted ? 0 : 1,
      storeIds,
      lastAt: event.occurredAt ?? new Date(),
    };
  }

  private observe(event: PlatformAlertEvent): void {
    const next = this.toObservation(event);
    const current = this.buffer.get(next.fingerprint);
    if (!current) {
      if (this.buffer.size >= MAX_BUFFERED_FINGERPRINTS) {
        this.dropped++;
        return;
      }
      this.buffer.set(next.fingerprint, next);
      return;
    }
    current.count += next.count;
    next.storeIds.forEach((id) => current.storeIds.add(id));
    current.event = {
      ...next.event,
      severity: maxSeverity(current.event.severity, next.event.severity),
      ticketNumber: current.event.ticketNumber ?? next.event.ticketNumber,
      organizationId: next.event.organizationId ?? current.event.organizationId,
      storeId: next.event.storeId ?? current.event.storeId,
    };
    current.lastAt = next.lastAt;
  }

  /** Inserta o suma al episodio abierto y dispara los avisos que tocan. */
  private async persist(
    observation: Observation,
  ): Promise<PlatformAlertRecordResult> {
    const { fingerprint, event, count, lastAt } = observation;
    const details: Prisma.InputJsonObject = {
      ...(event.details as Record<string, string | number | boolean>),
      ...(event.context && Object.keys(event.context).length > 0
        ? { [ALERT_CONTEXT_KEY]: event.context as Prisma.InputJsonObject }
        : {}),
    };
    let alert = await this.findOpen(fingerprint);
    let opened = false;
    let previousSeverity: PlatformAlertSeverity = event.severity;

    if (!alert) {
      try {
        alert = await this.prisma.platform_alerts.create({
          data: {
            fingerprint,
            source: event.source,
            process: event.process,
            error_type: event.errorType,
            severity: event.severity,
            status: 'open',
            title: event.title,
            message: event.message ?? null,
            ...(Object.keys(details).length > 0 ? { details } : {}),
            organization_id: event.organizationId ?? null,
            store_id: event.storeId ?? null,
            affected_store_ids: [...observation.storeIds].slice(0, MAX_AFFECTED_STORES),
            occurrences: Math.max(1, count),
            first_seen_at: lastAt,
            last_seen_at: lastAt,
            ticket_number: event.ticketNumber ?? null,
          },
        });
        opened = true;
      } catch (error) {
        // Otro proceso abrió el mismo episodio entre la lectura y el insert.
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        alert = await this.findOpen(fingerprint);
        if (!alert) throw error;
      }
    }

    if (!opened) {
      previousSeverity = severityOf(alert.severity);
      const stores = new Set([...alert.affected_store_ids, ...observation.storeIds]);
      alert = await this.prisma.platform_alerts.update({
        where: { id: alert.id },
        data: {
          ...(count > 0 ? { occurrences: { increment: count } } : {}),
          last_seen_at: lastAt > alert.last_seen_at ? lastAt : alert.last_seen_at,
          ...(count > 0
            ? {
                message: event.message ?? alert.message,
                ...(Object.keys(details).length > 0 ? { details } : {}),
              }
            : {}),
          severity: maxSeverity(previousSeverity, event.severity),
          affected_store_ids: [...stores].slice(0, MAX_AFFECTED_STORES),
          ...(alert.organization_id === null && event.organizationId
            ? { organization_id: event.organizationId }
            : {}),
          ...(alert.store_id === null && event.storeId
            ? { store_id: event.storeId }
            : {}),
          ...(alert.ticket_number === null && event.ticketNumber
            ? { ticket_number: event.ticketNumber }
            : {}),
        },
      });
    }

    alert = await this.afterPersist(alert, event, {
      opened,
      previousSeverity,
      counted: count > 0,
    });
    return { alert, opened };
  }

  private async afterPersist(
    initial: PlatformAlertRow,
    event: PlatformAlertEvent,
    state: { opened: boolean; previousSeverity: PlatformAlertSeverity; counted: boolean },
  ): Promise<PlatformAlertRow> {
    let alert = initial;
    const escalated = await this.escalateIfRepeated(alert);
    if (escalated) alert = escalated;

    const becameCritical =
      alert.severity === 'critical' &&
      (state.opened || !!escalated || state.previousSeverity !== 'critical');
    const updates: {
      ticket_number?: string;
      telegram_message_id?: string;
      notified_occurrences?: number;
    } = {};

    if (becameCritical && !event.incidentHandled && !alert.ticket_number) {
      const ticketNumber = await this.openIncident(alert);
      if (ticketNumber) {
        updates.ticket_number = ticketNumber;
        alert = { ...alert, ticket_number: ticketNumber };
      }
    } else if (
      state.counted &&
      !state.opened &&
      alert.ticket_number &&
      alert.source !== 'incident'
    ) {
      await this.syncTicketRepetitions(alert);
    }

    if (state.opened) {
      const messageId = (await this.shouldNotifyOpening(alert))
        ? await this.telegram.send(
            formatAlertMessage(alert, this.settings.envLabel, await this.contextOf(alert)),
          )
        : null;
      if (messageId) {
        updates.telegram_message_id = messageId;
        updates.notified_occurrences = alert.occurrences;
      }
    } else if (escalated) {
      await this.telegram.send(
        formatEscalationMessage(alert, this.settings.envLabel),
        { replyToMessageId: alert.telegram_message_id },
      );
      await this.syncTelegram(alert, true);
    } else if (state.counted) {
      await this.syncTelegram(alert);
    }

    if (Object.keys(updates).length === 0) return alert;
    return this.prisma.platform_alerts.update({
      where: { id: alert.id },
      data: updates,
    });
  }

  /** Leve que se repite `MONITOR_ESCALATE_AFTER` veces sube a grave (una sola vez). */
  private async escalateIfRepeated(
    alert: PlatformAlertRow,
  ): Promise<PlatformAlertRow | null> {
    if (
      alert.severity !== 'warning' ||
      !canEscalate(alert.source) ||
      alert.occurrences < this.settings.escalateAfter
    ) {
      return null;
    }
    const { count } = await this.prisma.platform_alerts.updateMany({
      where: { id: alert.id, status: 'open', severity: 'warning' },
      data: { severity: 'critical', escalated_at: new Date() },
    });
    if (count !== 1) return null;
    return this.prisma.platform_alerts.findUnique({ where: { id: alert.id } });
  }

  /** Ticket + correo a soporte de QUI-1009: uno por episodio. */
  private async openIncident(alert: PlatformAlertRow): Promise<string | null> {
    const platformOrgId = await this.platformOrg
      .getPlatformOrganizationId()
      .catch(() => null);
    const source = SOURCE_LABELS[alert.source] ?? alert.source;
    const context = await this.contextOf(alert);
    const result = await this.incidents.report({
      dedupeKey: `api-monitor:alert:${alert.id}`,
      source: API_MONITOR_INCIDENT_SOURCE,
      severity: 'critical',
      title: alert.title,
      summary: `${source} detectada por el bot de monitoreo (${this.settings.envLabel}).${alert.escalated_at ? ' Subió a grave por repetirse.' : ''}`,
      // Las mismas líneas que Telegram y Superadmin (S6), luego lo técnico.
      details: {
        ...Object.fromEntries(context.lines.map((line) => [line.label, line.value])),
        Proceso: alert.process,
        'Tipo de error': alert.error_type,
        Gravedad: 'Grave',
        'Primera vez': formatDateTime(alert.first_seen_at),
        Repeticiones: alert.occurrences,
        Mensaje: alert.message,
        Entorno: this.settings.envLabel,
        'Alerta (id)': alert.id,
        'Ver en Superadmin': context.superadminUrl,
      },
      tags: [alert.source],
      // Como QUI-1020: el ticket vive en la organización de plataforma
      // (Superadmin lo ve, la tienda no); el afectado va en los detalles.
      organizationId: platformOrgId ?? alert.organization_id ?? 0,
      storeId: platformOrgId === null ? alert.store_id : null,
      userId: null,
      errorCode: alert.error_type,
      correlationId: `alerta-${alert.id}`,
    });
    return result.ticketNumber;
  }

  /** «Repeticiones: N» del ticket que abrió el bot, al día. */
  private async syncTicketRepetitions(alert: PlatformAlertRow): Promise<void> {
    if (!alert.ticket_number) return;
    try {
      const ticket = await this.prisma.support_tickets.findUnique({
        where: { ticket_number: alert.ticket_number },
        select: { id: true, description: true },
      });
      if (!ticket?.description) return;
      const description = ticket.description.replace(
        /^Repeticiones: \d+$/m,
        `Repeticiones: ${alert.occurrences}`,
      );
      if (description === ticket.description) return;
      await this.prisma.support_tickets.update({
        where: { id: ticket.id },
        data: { description },
      });
    } catch (error) {
      this.logger.warn(
        `Ticket ${alert.ticket_number} sin conteo al día: ${(error as Error)?.message}`,
      );
    }
  }

  /** Reescribe el mensaje de Telegram con el conteo (una vez cada 30 s por alerta). */
  private async syncTelegram(
    alert: PlatformAlertRow,
    force = false,
  ): Promise<void> {
    if (!alert.telegram_message_id) return;
    if (!force && !(await this.takeEditSlot(alert.id))) return;
    const edited = await this.telegram.edit(
      alert.telegram_message_id,
      formatAlertMessage(alert, this.settings.envLabel, await this.contextOf(alert)),
    );
    if (!edited) return;
    await this.prisma.platform_alerts.updateMany({
      where: { id: alert.id, notified_occurrences: { lt: alert.occurrences } },
      data: { notified_occurrences: alert.occurrences },
    });
  }

  /** Nombres de la alerta; si el resolutor falla, la alerta sale con ids. */
  private async contextOf(alert: PlatformAlertRow): Promise<ResolvedAlertContext> {
    try {
      return await this.alertContext.resolve(alert);
    } catch (error) {
      this.logger.warn(`Alerta #${alert.id} sin nombres: ${(error as Error)?.message}`);
      return fallbackContext(alert);
    }
  }

  /**
   * Un «Límite de plan» abre un mensaje por tienda y periodo aunque el
   * episodio se cierre y se vuelva a abrir. Si Redis falla, se avisa.
   */
  private async shouldNotifyOpening(alert: PlatformAlertRow): Promise<boolean> {
    if (!isPlanLimitAlert(alert)) return true;
    try {
      const won = await this.redis.set(
        `${PLAN_LIMIT_NOTIFIED_KEY_PREFIX}${alert.fingerprint}`,
        String(alert.id),
        'EX',
        PLAN_LIMIT_NOTIFIED_TTL_SECONDS,
        'NX',
      );
      return won === 'OK';
    } catch {
      return true;
    }
  }

  private async takeEditSlot(alertId: number): Promise<boolean> {
    try {
      const won = await this.redis.set(
        `${EDIT_THROTTLE_KEY_PREFIX}${alertId}`,
        '1',
        'EX',
        TELEGRAM_EDIT_THROTTLE_SECONDS,
        'NX',
      );
      return won === 'OK';
    } catch {
      return false;
    }
  }

  private findOpen(fingerprint: string): Promise<PlatformAlertRow | null> {
    return this.prisma.platform_alerts.findFirst({
      where: { fingerprint, status: 'open' },
    });
  }
}

function numberOrNull(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Módulo y acción de los incidentes de cargas masivas y procesos de IA. */
function describeIncident(
  source: string,
  details: Record<string, unknown> | undefined,
  tags: readonly string[] | undefined,
): { module: string; action: string } | null {
  if (source === 'bulk_upload_job') {
    return describeJob('bulk-upload-jobs', 'run', { upload_type: tags?.[1] });
  }
  const queue = details?.['Cola'];
  if (typeof queue === 'string' && queue) {
    const kind = typeof details?.['Tipo'] === 'string' ? (details['Tipo'] as string) : '';
    return describeJob(queue, kind, { kind });
  }
  return null;
}

/** Contexto que se guarda: textos saneados, ids enteros y nada vacío. */
function sanitizeContext(
  context: PlatformAlertContext | undefined,
): PlatformAlertContext | undefined {
  if (!context) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'number') {
      if (Number.isInteger(value) && value > 0) out[key] = value;
      continue;
    }
    // El periodo son solo dígitos: el saneo lo taparía como un número largo.
    if (key === 'period') {
      if (/^\d{6}(\d{2})?$/.test(String(value))) out[key] = String(value);
      continue;
    }
    const text = sanitizeAlertText(String(value), 160);
    if (text) out[key] = text;
  }
  return out as PlatformAlertContext;
}

/**
 * QUI-1031 (S5): un límite del plan de la tienda no es un fallo técnico.
 * Informativa, sin ticket ni escalado, agrupada por tienda y periodo.
 */
function toPlanLimitEvent(
  event: PlatformAlertEvent,
  match: PlanLimitMatch,
): PlatformAlertEvent {
  const at = event.occurredAt ?? new Date();
  const aiFeature = event.context?.aiFeature ?? null;
  const period = planLimitPeriod(at, aiFeature);
  const scope = event.storeId
    ? `tienda:${event.storeId}`
    : event.organizationId
      ? `organizacion:${event.organizationId}`
      : 'plataforma';
  return {
    ...event,
    severity: 'info',
    errorType: match.code,
    title: `${PLAN_LIMIT_LABEL}: ${match.label}`,
    message: `${match.label.charAt(0).toUpperCase()}${match.label.slice(1)}. No es un fallo técnico: la tienda necesita más cupo o un plan mayor.`,
    details: {
      ...event.details,
      'Error original': event.message ?? null,
    },
    context: {
      ...event.context,
      category: 'plan_limit',
      planLimitCode: match.code,
      period,
    },
    groupKey: ['plan_limit', match.code, scope, period].join('|'),
  };
}

function maxSeverity(
  a: PlatformAlertSeverity,
  b: PlatformAlertSeverity,
): PlatformAlertSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}
