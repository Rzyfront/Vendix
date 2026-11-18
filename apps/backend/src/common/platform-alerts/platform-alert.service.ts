import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type Redis from 'ioredis';
import { RequestContextService } from '../context/request-context.service';
import { PlatformIncidentService } from '../incidents/platform-incident.service';
import {
  PLATFORM_INCIDENT_REPORTED_EVENT,
  type PlatformIncidentReportedEvent,
} from '../incidents/platform-incident.types';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PlatformOrgService } from '../services/platform-org.service';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  SOURCE_LABELS,
  formatAlertMessage,
  formatDateTime,
  formatEscalationMessage,
  formatResolutionMessage,
  severityOf,
  tenantLabel,
} from './platform-alert-format';
import {
  canEscalate,
  readMonitorConfig,
  severityOfHttpFailure,
  stripApiPrefix,
  type MonitorConfig,
} from './platform-alert-policy';
import {
  fingerprintOf,
  sanitizeAlertDetails,
  sanitizeAlertText,
  summarizeError,
} from './platform-alert-sanitize';
import { TelegramNotifierService } from './telegram-notifier.service';
import type {
  PlatformAlertEvent,
  PlatformAlertRecordResult,
  PlatformAlertResolution,
  PlatformAlertRow,
  PlatformAlertSeverity,
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
const SWEEP_BATCH = 100;

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

export interface HttpFailureInput {
  method: string;
  /** Ruta sin valores (`routeKeyOf`). */
  route: string;
  status: number;
  errorCode?: string | null;
  error?: unknown;
  requestId?: string | null;
}

export interface SlowRequestInput {
  method: string;
  route: string;
  durationMs: number;
  statusCode?: number;
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
    const { severity, area } = severityOfHttpFailure(input.route, input.status);
    const process = `${input.method.toUpperCase()} ${stripApiPrefix(input.route)}`;
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
      },
      organizationId: context?.organization_id ?? null,
      storeId: context?.store_id ?? null,
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
    const process = `${input.method.toUpperCase()} ${path}`;
    const durationMs = Math.round(input.durationMs);
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
      },
      organizationId: context?.organization_id ?? null,
      storeId: context?.store_id ?? null,
    });
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
      where: { status: 'open', last_seen_at: { lt: cutoff } },
      select: { id: true },
      orderBy: { last_seen_at: 'asc' },
      take: SWEEP_BATCH,
    });
    for (const { id } of quiet) await this.resolve(id, 'auto_quiet');

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

  private toObservation(event: PlatformAlertEvent): Observation {
    const sanitized: PlatformAlertEvent = {
      ...event,
      process: sanitizeAlertText(event.process, 255) || 'desconocido',
      errorType: sanitizeAlertText(event.errorType, 120) || 'desconocido',
      title: sanitizeAlertText(event.title, 255) || 'Falla sin título',
      message: sanitizeAlertText(event.message, 500) || null,
      details: sanitizeAlertDetails(event.details),
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
    const details = event.details as Record<string, string | number | boolean>;
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
      const messageId = await this.telegram.send(
        formatAlertMessage(alert, this.settings.envLabel),
      );
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
    const result = await this.incidents.report({
      dedupeKey: `api-monitor:alert:${alert.id}`,
      source: API_MONITOR_INCIDENT_SOURCE,
      severity: 'critical',
      title: alert.title,
      summary: `${source} detectada por el bot de monitoreo (${this.settings.envLabel}).${alert.escalated_at ? ' Subió a grave por repetirse.' : ''}`,
      details: {
        Proceso: alert.process,
        'Tipo de error': alert.error_type,
        Gravedad: 'Grave',
        'Afecta a': tenantLabel(alert),
        'Organización afectada (id)': alert.organization_id,
        'Tienda afectada (id)': alert.store_id,
        'Primera vez': formatDateTime(alert.first_seen_at),
        Repeticiones: alert.occurrences,
        Mensaje: alert.message,
        Entorno: this.settings.envLabel,
        'Alerta (id)': alert.id,
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
      formatAlertMessage(alert, this.settings.envLabel),
    );
    if (!edited) return;
    await this.prisma.platform_alerts.updateMany({
      where: { id: alert.id, notified_occurrences: { lt: alert.occurrences } },
      data: { notified_occurrences: alert.occurrences },
    });
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

function maxSeverity(
  a: PlatformAlertSeverity,
  b: PlatformAlertSeverity,
): PlatformAlertSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}
