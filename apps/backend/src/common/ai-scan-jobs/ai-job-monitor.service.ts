import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PlatformIncidentService } from '@common/incidents/platform-incident.service';
import { PlatformOrgService } from '@common/services/platform-org.service';
import {
  lastRecordedProviderFailure,
  RecordedProviderFailure,
  runRecordingProviderFailures,
} from '../../ai-engine/provider-failure-recorder';
import {
  AiJobFailureClass,
  AiJobFailureCategory,
  AiUnavailableReason,
  classifyAiJobFailure,
  failureNeedsIncident,
} from './ai-job-failure.util';

/** Which AI process a job belongs to. Groups incidents and names them. */
export interface AiJobSource {
  /** BullMQ queue, e.g. `ai-scan`, `invoice-scan`. */
  queue: string;
  /** Kind of work, e.g. `rut`, `invoice_scan`. */
  kind: string;
  /** Spanish label for the ticket, e.g. "escaneo del RUT". */
  label: string;
}

/** Tenant facts of the job, read from its payload (each queue names them alike). */
export interface AiJobOwner {
  store_id?: number | null;
  organization_id?: number | null;
  user_id?: number | null;
  request_id?: string | null;
}

/** Real progress a handler reports (pages, rows, steps). */
export interface AiJobProgress {
  done: number;
  total: number;
  /** Short Spanish step label, e.g. "Leyendo páginas". */
  stage?: string;
  /** What `done/total` count, in Spanish plural ("filas", "páginas"); the web shows "120 de 800 filas". */
  unit?: string;
}

/**
 * Additive fields of every AI job status response (QUI-1020). Old clients
 * (mobile) ignore them; the web uses them to draw the bar, to compute the real
 * elapsed time after a reload and to tell the user who is to blame.
 */
export interface AiJobStatusMeta {
  progress: AiJobProgress | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Server clock: the client measures elapsed time against it, not its own. */
  server_time: string;
  attempts_made: number;
  max_attempts: number;
  /** No worker picked it up, or it has been running far longer than any AI call. */
  stalled: boolean;
  error_category?: AiJobFailureCategory;
  error_reason?: AiUnavailableReason;
}

/** Waiting this long without a worker means the queue is not being consumed. */
export const AI_JOB_WAITING_STALL_MS = 2 * 60_000;
/** Running this long is far beyond any provider deadline: the job hung. */
export const AI_JOB_ACTIVE_STALL_MS = 5 * 60_000;

const HOUR = 60 * 60;
const PROVIDER_NOTES_MAX = 500;

const REASON_LABELS: Record<AiUnavailableReason, string> = {
  credits: 'el proveedor de IA no tiene créditos o la cuota se agotó',
  rate_limited: 'el proveedor de IA rechaza por límite de uso (429)',
  not_configured: 'la aplicación de IA no está configurada o está inactiva',
  plan_quota: 'el plan de la tienda agotó su cuota de IA',
};

/**
 * Watches the AI job queues (`ai-scan` and the per-domain scan queues):
 * - `runAiWork` turns a provider refusal (no credits, persistent 429) into
 *   `AI_PROVIDER_003/004` instead of the handler's "could not read" code;
 * - `describe` adds timestamps, progress, stall and failure class to the poll;
 * - `onFailed` opens ONE incident (ticket + e-mail, deduplicated) when a job
 *   fails for good and it is not the document's fault;
 * - a stalled job found by `describe` opens one incident as well.
 * Never throws from reporting: an alert that fails must not break the poll.
 */
@Injectable()
export class AiJobMonitorService {
  private readonly logger = new Logger(AiJobMonitorService.name);
  /** Provider message per job, read once by `onFailed` in the same worker. */
  private readonly providerNotes = new Map<string, RecordedProviderFailure>();

  constructor(
    private readonly incidents: PlatformIncidentService,
    private readonly platformOrg: PlatformOrgService,
  ) {}

  /**
   * Runs the AI part of a job. When it throws after the provider refused for
   * billing or rate limit, the error becomes `AI_PROVIDER_003` (no credits,
   * 4xx: final) or `AI_PROVIDER_004` (429: retried, then reported). A document
   * error (4xx) or an AI code the handler already raised is kept as is.
   */
  async runAiWork<T>(
    job: Pick<Job, 'id'>,
    source: AiJobSource,
    work: () => Promise<T>,
  ): Promise<T> {
    return runRecordingProviderFailures(async () => {
      try {
        // A note left by an earlier attempt must not outlive it.
        this.providerNotes.delete(noteKey(source, job));
        const result = await work();
        this.providerNotes.delete(noteKey(source, job));
        return result;
      } catch (error) {
        const recorded = lastRecordedProviderFailure();
        if (!recorded) throw error;
        if (
          error instanceof VendixHttpException &&
          classifyAiJobFailure(error.errorCode).category !== 'technical'
        ) {
          throw error;
        }
        this.rememberProviderNote(source, job, recorded);
        throw new VendixHttpException(
          recorded.reason === 'credits'
            ? ErrorCodes.AI_PROVIDER_003
            : ErrorCodes.AI_PROVIDER_004,
        );
      }
    });
  }

  /**
   * Status metadata of a job in `state`. When the job is stalled it also opens
   * (once, deduplicated) the incident, without waiting for it. A waiting job
   * is stalled only when no worker is busy on the queue (otherwise it is just
   * a backlog); without `queue` (or if it cannot be asked) the time threshold
   * alone decides.
   */
  async describe(
    job: Job,
    state: string,
    source: AiJobSource,
    owner?: AiJobOwner | null,
    queue?: Pick<Queue, 'getActiveCount'>,
    now: number = Date.now(),
  ): Promise<AiJobStatusMeta> {
    const startedAt = job.processedOn ?? null;
    const finishedAt = job.finishedOn ?? null;
    const waiting = ['waiting', 'prioritized', 'waiting-children', 'delayed'];
    let stalledWaiting =
      waiting.includes(state) &&
      startedAt === null &&
      now - job.timestamp > AI_JOB_WAITING_STALL_MS;
    if (stalledWaiting && queue) {
      try {
        stalledWaiting = (await queue.getActiveCount()) === 0;
      } catch {
        // Keep the time-threshold verdict.
      }
    }
    // A job that keeps reporting progress is alive: the active threshold
    // counts from its last report (ai-ingest sheets can take several minutes).
    const lastProgressAt = progressReportedAt(job.progress);
    const activeSince =
      startedAt === null ? null : Math.max(startedAt, lastProgressAt ?? 0);
    const stalledActive =
      state === 'active' &&
      activeSince !== null &&
      now - activeSince > AI_JOB_ACTIVE_STALL_MS;

    const meta: AiJobStatusMeta = {
      progress: readProgress(job.progress),
      queued_at: toIso(job.timestamp),
      started_at: toIso(startedAt),
      finished_at: toIso(finishedAt),
      server_time: new Date(now).toISOString(),
      attempts_made: job.attemptsMade ?? 0,
      max_attempts: job.opts?.attempts ?? 1,
      stalled: stalledWaiting || stalledActive,
    };
    if (state === 'failed') {
      const failure = classifyAiJobFailure(job.failedReason);
      meta.error_category = failure.category;
      if (failure.reason) meta.error_reason = failure.reason;
    }
    if (meta.stalled) {
      void this.reportStall(job, stalledWaiting ? 'waiting' : 'active', source, owner);
    }
    return meta;
  }

  /**
   * Call from `@OnWorkerEvent('failed')`. Reports only the FINAL failure (BullMQ
   * sets `finishedOn` when no retry is left) and only when Vendix must act.
   */
  async onFailed(
    job: Job | undefined,
    source: AiJobSource,
    owner?: AiJobOwner | null,
  ): Promise<void> {
    if (!job) return;
    if (!job.finishedOn) return; // BullMQ will retry it
    const note = this.providerNotes.get(noteKey(source, job));
    this.providerNotes.delete(noteKey(source, job));
    const failure = classifyAiJobFailure(job.failedReason);
    if (!failureNeedsIncident(failure)) return;
    await this.report({
      job,
      source,
      owner,
      failure,
      note,
    });
  }

  private async reportStall(
    job: Job,
    phase: 'waiting' | 'active',
    source: AiJobSource,
    owner?: AiJobOwner | null,
  ): Promise<void> {
    const waiting = phase === 'waiting';
    await this.send(job, source, owner, {
      dedupeKey: waiting
        ? `ai-job:stalled:waiting:${source.queue}`
        : `ai-job:stalled:active:${source.queue}:${source.kind}`,
      dedupeTtlSeconds: HOUR,
      severity: 'critical',
      title: waiting
        ? `Cola de IA sin procesar: ${source.label}`
        : `Proceso de IA colgado: ${source.label}`,
      summary: waiting
        ? `Un trabajo de ${source.label} lleva más de ${AI_JOB_WAITING_STALL_MS / 60_000} min en cola sin que ningún worker lo tome. Revisa el worker de la cola ${source.queue}.`
        : `Un trabajo de ${source.label} lleva más de ${AI_JOB_ACTIVE_STALL_MS / 60_000} min en proceso sin terminar ni reportar avance.`,
      category: 'stalled',
    });
  }

  private async report(input: {
    job: Job;
    source: AiJobSource;
    owner?: AiJobOwner | null;
    failure: AiJobFailureClass;
    note?: RecordedProviderFailure;
  }): Promise<void> {
    const { job, source, owner, failure, note } = input;
    const code = (job.failedReason ?? '').trim() || null;
    if (failure.category === 'ai_unavailable' && failure.reason) {
      const reason = failure.reason;
      const platformWide = reason === 'credits' || reason === 'rate_limited';
      await this.send(job, source, owner, {
        dedupeKey: platformWide
          ? `ai-job:ai-unavailable:${reason}`
          : `ai-job:ai-unavailable:${reason}:${source.kind}:${code ?? 'unknown'}`,
        dedupeTtlSeconds: reason === 'rate_limited' ? 6 * HOUR : 12 * HOUR,
        severity: reason === 'rate_limited' ? 'warning' : 'critical',
        title:
          reason === 'credits'
            ? 'IA sin créditos o cuota agotada'
            : reason === 'rate_limited'
              ? 'IA rechazando por límite de uso (429 persistente)'
              : `IA no disponible: ${source.label}`,
        summary: `Un proceso de ${source.label} falló porque ${REASON_LABELS[reason]}. Los usuarios ven "servicio de IA no disponible".`,
        category: failure.category,
        reason,
        code,
        note,
      });
      return;
    }
    await this.send(job, source, owner, {
      dedupeKey: `ai-job:technical:${source.queue}:${source.kind}:${code ?? 'unknown'}`,
      dedupeTtlSeconds: 6 * HOUR,
      severity: 'warning',
      title: `Proceso de IA falló: ${source.label}`,
      summary: `Un proceso de ${source.label} falló por un problema técnico de Vendix, no por el documento.`,
      category: failure.category,
      code,
      note,
    });
  }

  private async send(
    job: Job,
    source: AiJobSource,
    owner: AiJobOwner | null | undefined,
    incident: {
      dedupeKey: string;
      dedupeTtlSeconds: number;
      severity: 'warning' | 'critical';
      title: string;
      summary: string;
      category: AiJobFailureCategory | 'stalled';
      reason?: AiUnavailableReason;
      code?: string | null;
      note?: RecordedProviderFailure;
    },
  ): Promise<void> {
    try {
      // The ticket lives in the platform organization (Superadmin sees it,
      // the tenant does not); the affected tenant goes in the details.
      const platformOrgId = await this.platformOrg
        .getPlatformOrganizationId()
        .catch(() => null);
      const organizationId = platformOrgId ?? owner?.organization_id ?? 0;
      await this.incidents.report({
        dedupeKey: incident.dedupeKey,
        dedupeTtlSeconds: incident.dedupeTtlSeconds,
        source: 'ai_job',
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        details: {
          Proceso: source.label,
          Cola: source.queue,
          Tipo: source.kind,
          Categoría: incident.category,
          Motivo: incident.reason ?? null,
          'Trabajo (id)': job.id ?? null,
          'Organización afectada (id)': owner?.organization_id ?? null,
          'Tienda afectada (id)': owner?.store_id ?? null,
          'Usuario (id)': owner?.user_id ?? null,
          Intentos: job.attemptsMade ?? null,
        },
        internalDetails: {
          'Motivo del fallo': job.failedReason ?? null,
          'App de IA': incident.note?.appKey ?? null,
          'Respuesta del proveedor': incident.note?.message ?? null,
        },
        tags: [
          'ai',
          source.queue,
          source.kind,
          incident.category,
          ...(incident.reason ? [incident.reason] : []),
        ],
        organizationId,
        storeId: platformOrgId === null ? (owner?.store_id ?? null) : null,
        affected: {
          organizationId: owner?.organization_id ?? null,
          storeId: owner?.store_id ?? null,
        },
        userId: null,
        errorCode: incident.code ?? null,
        correlationId: `${source.queue}:${job.id}${owner?.request_id ? ` / ${owner.request_id}` : ''}`,
      });
    } catch (error) {
      this.logger.error(
        `AI job incident ${incident.dedupeKey} not reported: ${(error as Error)?.message}`,
      );
    }
  }

  private rememberProviderNote(
    source: AiJobSource,
    job: Pick<Job, 'id'>,
    note: RecordedProviderFailure,
  ): void {
    if (this.providerNotes.size >= PROVIDER_NOTES_MAX) {
      const oldest = this.providerNotes.keys().next().value;
      if (oldest !== undefined) this.providerNotes.delete(oldest);
    }
    this.providerNotes.set(noteKey(source, job), note);
  }
}

function noteKey(source: AiJobSource, job: Pick<Job, 'id'>): string {
  return `${source.queue}:${job.id}`;
}

function toIso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? new Date(ms).toISOString()
    : null;
}

/** When the handler last reported progress (`at`, epoch ms), if it did. */
export function progressReportedAt(progress: unknown): number | null {
  if (!progress || typeof progress !== 'object') return null;
  const at = (progress as { at?: unknown }).at;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
}

/** `job.progress` is `number | object`; only `{done,total}` counts as real progress. */
export function readProgress(progress: unknown): AiJobProgress | null {
  if (!progress || typeof progress !== 'object') return null;
  const p = progress as Partial<AiJobProgress>;
  if (
    typeof p.done !== 'number' ||
    typeof p.total !== 'number' ||
    !Number.isFinite(p.done) ||
    !Number.isFinite(p.total) ||
    p.total <= 0
  ) {
    return null;
  }
  return {
    done: Math.max(0, Math.min(p.done, p.total)),
    total: p.total,
    ...(typeof p.stage === 'string' && p.stage ? { stage: p.stage } : {}),
    ...(typeof p.unit === 'string' && p.unit ? { unit: p.unit.slice(0, 20) } : {}),
  };
}
