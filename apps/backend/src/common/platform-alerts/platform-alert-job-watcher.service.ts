import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { formatDateTime } from './platform-alert-format';
import { QUEUES_WITH_OWN_INCIDENTS, severityOfQueue } from './platform-alert-policy';
import {
  fingerprintOf,
  summarizeError,
  tenantIdsOf,
} from './platform-alert-sanitize';
import { PlatformAlertService } from './platform-alert.service';

export const WORKER_HEARTBEAT_KEY = 'monitor:worker:heartbeat';
export const WORKER_GROUP_KEY = 'worker|heartbeat';
const SWEEP_LOCK_KEY = 'monitor:sweep:lock';
const FAILED_WATERMARK_PREFIX = 'monitor:jobs:failed-watermark:';
const STALLED_SEEN_PREFIX = 'monitor:jobs:stalled-seen:';
const WAITING_CANDIDATE_PREFIX = 'monitor:queue:waiting-candidate:';
const DAY_SECONDS = 24 * 60 * 60;
/** Jobs fallidos que se leen por cola y barrido (los más recientes). */
const FAILED_PAGE = 50;
const ACTIVE_PAGE = 100;
const WATCHDOG_INTERVAL_MS = 60_000;

/**
 * Vigila el trabajo en segundo plano (S1 de QUI-1010).
 *
 * Barrido por minuto (`@Cron`, solo en los procesos `worker` y `all`) sobre
 * las colas BullMQ registradas en este proceso, salvo las que ya avisan por
 * `PlatformIncidentService` (IA y cargas masivas):
 * - jobs fallidos de forma final (sin más reintentos) desde el último barrido;
 * - jobs activos que no terminan en `MONITOR_JOB_ACTIVE_STALL_MINUTES`;
 * - colas con trabajo esperando y nadie que lo tome por más de
 *   `MONITOR_JOB_WAITING_STALL_MINUTES` (confirmado en dos barridos seguidos).
 *
 * El mismo barrido deja un latido en Redis. La API sola (`VENDIX_PROCESS_ROLE=api`,
 * donde los `@Cron` se desmontan) revisa ese latido con un temporizador propio
 * y alerta si el worker se calla.
 */
@Injectable()
export class PlatformAlertJobWatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformAlertJobWatcherService.name);
  private watchdog: NodeJS.Timeout | null = null;
  private bootedAt = Date.now();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly alerts: PlatformAlertService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.alerts.settings.enabled || !isApiOnlyProcess()) return;
    this.bootedAt = Date.now();
    // Temporizador propio, NO `@Interval`: `unmountScheduledJobs` (main.ts)
    // borra los del SchedulerRegistry en el rol `api`.
    this.watchdog = setInterval(
      () => void this.checkWorkerHeartbeat(),
      WATCHDOG_INTERVAL_MS,
    );
    this.watchdog.unref();
  }

  onModuleDestroy(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'platform-alerts-sweep' })
  async sweep(): Promise<void> {
    if (!this.alerts.settings.enabled) return;
    await this.beat();
    if (!(await this.takeSweepLock())) return;
    try {
      await this.sweepQueues();
    } catch (error) {
      this.logger.error(`Barrido de colas falló: ${(error as Error)?.message}`);
    }
    try {
      await this.alerts.sweepOpenAlerts();
    } catch (error) {
      this.logger.error(`Barrido de alertas falló: ${(error as Error)?.message}`);
    }
  }

  /** API sola: alerta grave si el worker no da latido; se cierra al volver. */
  async checkWorkerHeartbeat(now = Date.now()): Promise<void> {
    try {
      const raw = await this.redis.get(WORKER_HEARTBEAT_KEY);
      const last = Number(raw);
      const hasBeat = raw !== null && Number.isFinite(last) && last > 0;
      const maxMinutes = this.alerts.settings.workerHeartbeatMaxMinutes;
      const ageMs = now - (hasBeat ? last : this.bootedAt);
      if (ageMs <= maxMinutes * 60_000) {
        if (hasBeat) await this.alerts.resolveGroup(WORKER_GROUP_KEY, 'recovered');
        return;
      }
      this.alerts.capture({
        source: 'worker',
        process: 'Proceso worker (colas BullMQ y tareas programadas)',
        errorType: 'worker_heartbeat_missing',
        severity: 'critical',
        title: 'El proceso de fondo dejó de dar señales',
        message: hasBeat
          ? `Último latido hace ${Math.round(ageMs / 60_000)} min: cobros, correos, reintentos DIAN y demás trabajos en segundo plano pueden estar detenidos.`
          : 'No hay latido del worker desde que arrancó la API: los trabajos en segundo plano pueden estar detenidos.',
        details: {
          'Último latido': hasBeat ? formatDateTime(new Date(last)) : 'ninguno',
          'Máximo sin latido (min)': maxMinutes,
        },
        groupKey: WORKER_GROUP_KEY,
        alreadyCounted: true,
      });
    } catch (error) {
      this.logger.warn(`Latido del worker no revisado: ${(error as Error)?.message}`);
    }
  }

  /** Colas a vigilar: las registradas en este proceso, menos las que ya avisan solas. */
  discoverQueues(): Queue[] {
    const byName = new Map<string, Queue>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (instance instanceof Queue && !QUEUES_WITH_OWN_INCIDENTS.has(instance.name)) {
        byName.set(instance.name, instance);
      }
    }
    return [...byName.values()];
  }

  async sweepQueues(now = Date.now()): Promise<void> {
    const seen = new Set<string>();
    let complete = true;
    for (const queue of this.discoverQueues()) {
      try {
        await this.inspectQueue(queue, seen, now);
      } catch (error) {
        complete = false;
        this.logger.warn(
          `Cola ${queue.name} no revisada: ${(error as Error)?.message}`,
        );
      }
    }
    // Solo con un barrido completo se puede afirmar que una condición se fue.
    if (complete) {
      await this.alerts.resolveMissingConditions(
        ['job_stalled', 'queue_stalled'],
        seen,
      );
    }
  }

  private async inspectQueue(
    queue: Queue,
    seen: Set<string>,
    now: number,
  ): Promise<void> {
    await this.reportFailedJobs(queue);
    await this.reportStalledJobs(queue, seen, now);
    await this.reportStalledQueue(queue, seen, now);
  }

  /** Fallidos de forma final desde la marca del barrido anterior. */
  private async reportFailedJobs(queue: Queue): Promise<void> {
    const markKey = `${FAILED_WATERMARK_PREFIX}${queue.name}`;
    const rawMark = await this.redis.get(markKey);
    const failed = (await queue.getFailed(0, FAILED_PAGE - 1)).filter(Boolean);
    const newest = failed.reduce(
      (max, job) => Math.max(max, job.finishedOn ?? 0),
      0,
    );
    if (rawMark === null) {
      // Primera vez: no se reportan los fallidos viejos (evita la avalancha al desplegar).
      await this.redis.set(markKey, String(newest || Date.now()), 'EX', 30 * DAY_SECONDS);
      return;
    }
    const mark = Number(rawMark) || 0;
    const severity = severityOfQueue(queue.name);
    for (const job of failed) {
      if ((job.finishedOn ?? 0) <= mark) continue;
      const tenant = tenantIdsOf(job.data);
      this.alerts.capture({
        source: 'job',
        process: `cola ${queue.name} · ${job.name}`,
        errorType: 'job_failed',
        severity,
        title: `Trabajo fallido en la cola ${queue.name}`,
        message: summarizeError(new Error(job.failedReason || 'sin motivo')),
        details: {
          Cola: queue.name,
          Trabajo: job.name,
          'Trabajo (id)': job.id,
          Intentos: job.attemptsMade,
        },
        organizationId: tenant.organizationId,
        storeId: tenant.storeId,
        occurredAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      });
    }
    if (newest > mark) {
      await this.redis.set(markKey, String(newest), 'EX', 30 * DAY_SECONDS);
    }
  }

  /** Activos que no terminan. Cada job cuenta una vez; los barridos siguientes solo lo mantienen abierto. */
  private async reportStalledJobs(
    queue: Queue,
    seen: Set<string>,
    now: number,
  ): Promise<void> {
    const limitMs = this.alerts.settings.jobActiveStallMinutes * 60_000;
    const active = (await queue.getActive(0, ACTIVE_PAGE - 1)).filter(Boolean);
    for (const job of active) {
      if (!job.processedOn || now - job.processedOn <= limitMs) continue;
      const groupKey = ['job_stalled', queue.name, job.name].join('|');
      seen.add(fingerprintOf(groupKey));
      const first = await this.redis.set(
        `${STALLED_SEEN_PREFIX}${queue.name}:${job.id}`,
        '1',
        'EX',
        DAY_SECONDS,
        'NX',
      );
      const tenant = tenantIdsOf(job.data);
      this.alerts.capture({
        source: 'job_stalled',
        process: `cola ${queue.name} · ${job.name}`,
        errorType: 'job_stalled',
        severity: severityOfQueue(queue.name),
        title: `Trabajo colgado en la cola ${queue.name}`,
        message: `Lleva ${Math.round((now - job.processedOn) / 60_000)} min en proceso sin terminar.`,
        details: {
          Cola: queue.name,
          Trabajo: job.name,
          'Trabajo (id)': job.id,
          'Empezó': formatDateTime(new Date(job.processedOn)),
        },
        organizationId: tenant.organizationId,
        storeId: tenant.storeId,
        groupKey,
        alreadyCounted: first !== 'OK',
      });
    }
  }

  /**
   * Trabajo esperando y ninguno activo. Se confirma en dos barridos con el
   * mismo job más antiguo, para no alertar por el instante en que un
   * reintento vuelve a la cola.
   */
  private async reportStalledQueue(
    queue: Queue,
    seen: Set<string>,
    now: number,
  ): Promise<void> {
    const candidateKey = `${WAITING_CANDIDATE_PREFIX}${queue.name}`;
    const counts = await queue.getJobCounts('wait', 'prioritized', 'active');
    const waiting = (counts.wait ?? 0) + (counts.prioritized ?? 0);
    if (waiting === 0 || (counts.active ?? 0) > 0) {
      await this.redis.del(candidateKey);
      return;
    }
    const [oldest] = (await queue.getJobs(['wait', 'prioritized'], 0, 0, true)).filter(Boolean);
    const readyAt = oldest ? oldest.timestamp + (oldest.delay ?? 0) : now;
    const limitMs = this.alerts.settings.jobWaitingStallMinutes * 60_000;
    if (!oldest || now - readyAt <= limitMs) {
      await this.redis.del(candidateKey);
      return;
    }
    const previous = await this.redis.get(candidateKey);
    await this.redis.set(candidateKey, String(oldest.id), 'EX', 5 * 60);
    if (previous !== String(oldest.id)) return;

    const groupKey = ['queue_stalled', queue.name].join('|');
    seen.add(fingerprintOf(groupKey));
    const paused = await queue.isPaused();
    this.alerts.capture({
      source: 'queue_stalled',
      process: `cola ${queue.name}`,
      errorType: paused ? 'queue_paused' : 'queue_without_worker',
      severity: 'critical',
      title: `La cola ${queue.name} no está procesando`,
      message: `${waiting} trabajos esperando; el más antiguo lleva ${Math.round((now - readyAt) / 60_000)} min. ${paused ? 'La cola está en pausa.' : 'Ningún worker los está tomando.'}`,
      details: { Cola: queue.name, Esperando: waiting, 'En pausa': paused },
      groupKey,
      alreadyCounted: true,
    });
  }

  private async beat(): Promise<void> {
    try {
      await this.redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), 'EX', DAY_SECONDS);
    } catch (error) {
      this.logger.warn(`Latido no registrado: ${(error as Error)?.message}`);
    }
  }

  /** Un barrido a la vez entre procesos (`all` + `worker` durante un despliegue). */
  private async takeSweepLock(): Promise<boolean> {
    try {
      const won = await this.redis.set(SWEEP_LOCK_KEY, String(process.pid), 'EX', 55, 'NX');
      return won === 'OK';
    } catch {
      return false;
    }
  }
}

/** Misma lectura que `resolveVendixProcessRole` (app.module.ts): solo `api` exacto. */
function isApiOnlyProcess(): boolean {
  return (process.env.VENDIX_PROCESS_ROLE ?? '').trim().toLowerCase() === 'api';
}
