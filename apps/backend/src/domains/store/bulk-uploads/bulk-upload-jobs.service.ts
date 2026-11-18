import { withJobOrigin } from '../../../common/queue/job-origin';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PlatformIncidentService } from '@common/incidents/platform-incident.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { normalizeUploadFileName } from './bulk-file-fingerprint.util';
import { BulkUploadJobLockService } from './bulk-upload-job-lock.service';
import {
  BULK_JOB_AUTO_RETRY,
  BULK_JOB_BATCH_SIZE,
  BULK_JOB_DEADLINE_MS,
  BULK_JOB_RECONCILE_GRACE_MS,
  BULK_JOB_RETENTION_SECONDS,
  BULK_UPLOAD_JOBS_QUEUE,
  bulkErrorMessage,
  bulkJobId,
  bulkJobResultsKey,
  emptyCursor,
  isBulkJobType,
  type BulkJobError,
  type BulkJobType,
  type BulkJobUserSnapshot,
  type BulkUploadJobData,
  type BulkUploadJobResultRow,
  type BulkUploadJobView,
} from './bulk-upload-job.types';
import {
  BULK_JOB_TECHNICAL_MESSAGE,
  reportBulkJobIncident,
} from './bulk-upload-job-incident.util';

/** Ventana en que una fila `queued` sin job aún no se considera colgada. */
const ENQUEUE_GRACE_MS = 60_000;
const ACTIVE_STATUSES = ['queued', 'running'];
const isActiveStatus = (status: string) => ACTIVE_STATUSES.includes(status);

interface BulkLogRow {
  id: number;
  store_id: number;
  user_id: number | null;
  upload_type: string;
  file_name: string;
  file_hash: string;
  total_rows: number;
  successful_rows: number;
  created_rows: number | null;
  failed_rows: number;
  skipped_rows: number;
  status: string;
  result_reference: string | null;
  created_at: Date;
  updated_at: Date;
}

/** What the view needs from BullMQ (or from a reconcile that found no job). */
interface JobInfo {
  data?: Partial<BulkUploadJobData>;
  /** `true` only when the BullMQ job exists and is in the `failed` state. */
  resumable: boolean;
}

export interface EnqueueBulkJobInput {
  upload_type: BulkJobType;
  file_name: string;
  file_hash: string;
  /** Propios del tipo (sesión, ubicación, clave S3, …). */
  params: Record<string, unknown>;
  /** Solo si se conoce al encolar (clientes). */
  total_rows?: number;
  user: BulkJobUserSnapshot;
}

/**
 * Encola, consulta y reintenta los trabajos durables de carga masiva.
 *
 * Aislamiento: la fila de `bulk_upload_logs` se lee SIEMPRE con
 * `StorePrismaService` (inyecta `store_id`); una fila de otra tienda responde
 * el mismo 404 que un id inexistente. El job de BullMQ solo se consulta tras
 * haber encontrado la fila de la tienda.
 */
@Injectable()
export class BulkUploadJobsService {
  private readonly logger = new Logger(BulkUploadJobsService.name);

  constructor(
    @InjectQueue(BULK_UPLOAD_JOBS_QUEUE) private readonly queue: Queue,
    private readonly prisma: StorePrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly locks: BulkUploadJobLockService,
    private readonly incidents: PlatformIncidentService,
  ) {}

  async enqueue(input: EnqueueBulkJobInput): Promise<BulkUploadJobView> {
    const ctx = RequestContextService.getContext();
    const storeId = ctx?.store_id;
    if (storeId == null) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const total = Math.max(0, Math.floor(input.total_rows ?? 0));
    const row = (await this.prisma.bulk_upload_logs.create({
      data: {
        user_id: ctx?.user_id ?? null,
        upload_type: input.upload_type,
        file_name: normalizeUploadFileName(input.file_name),
        file_hash: input.file_hash,
        total_rows: total,
        status: 'queued',
      },
    })) as BulkLogRow;

    const lock = await this.acquireLock(storeId, input.upload_type, row.id);
    if (!lock.acquired) {
      await this.discardRow(row.id);
      throw new VendixHttpException(
        ErrorCodes.BULK_JOB_ALREADY_ACTIVE,
        undefined,
        { job_id: lock.holder },
      );
    }

    const data: BulkUploadJobData = {
      log_id: row.id,
      upload_type: input.upload_type,
      store_id: storeId,
      organization_id: ctx?.organization_id ?? undefined,
      user_id: ctx?.user_id ?? undefined,
      roles: ctx?.roles ?? [],
      permissions: ctx?.permissions ?? [],
      request_id: ctx?.request_id ?? `bulk-upload-${randomUUID()}`,
      user: input.user,
      file_name: row.file_name,
      file_hash: input.file_hash,
      params: input.params,
      cursor: emptyCursor(total),
      enqueued_at: new Date(Date.now()).toISOString(),
      started_at: null,
      finished_at: null,
      deadline_at: new Date(Date.now() + BULK_JOB_DEADLINE_MS).toISOString(),
      retry: null,
      error: null,
      incident_ticket_number: null,
    };
    try {
      await this.queue.add('run', withJobOrigin(data, `http:cargas-masivas/${input.upload_type}`), {
        jobId: bulkJobId(row.id),
        // Los reintentos son por lote, dentro del procesador.
        attempts: 1,
        removeOnComplete: { age: BULK_JOB_RETENTION_SECONDS },
        removeOnFail: { age: BULK_JOB_RETENTION_SECONDS },
      });
    } catch (error) {
      this.logger.error(
        `Bulk job ${row.id} could not be enqueued: ${bulkErrorMessage(error)}`,
      );
      await this.locks.release(storeId, input.upload_type, row.id);
      await this.discardRow(row.id);
      throw new VendixHttpException(ErrorCodes.BULK_JOB_ENQUEUE_FAILED);
    }
    return this.buildView(row, { data, resumable: false });
  }

  /** Tipo de la fila de la tienda (para exigir el permiso antes de leer el trabajo). */
  async getType(id: number): Promise<BulkJobType> {
    return (await this.findRow(id)).upload_type as BulkJobType;
  }

  async getView(id: number): Promise<BulkUploadJobView> {
    const row = await this.findRow(id);
    const { row: current, info } = await this.reconcile(row);
    return this.buildView(current, info);
  }

  async getActive(type: BulkJobType): Promise<BulkUploadJobView | null> {
    const row = (await this.prisma.bulk_upload_logs.findFirst({
      where: { upload_type: type, status: { in: ACTIVE_STATUSES } },
      orderBy: { created_at: 'desc' },
    })) as BulkLogRow | null;
    if (!row) return null;
    const { row: current, info } = await this.reconcile(row);
    if (!isActiveStatus(current.status)) return null;
    return this.buildView(current, info);
  }

  async getResults(id: number): Promise<{ rows: BulkUploadJobResultRow[] }> {
    const row = await this.findRow(id);
    const hash = await this.redis.hgetall(bulkJobResultsKey(row.id));
    const rows = Object.keys(hash ?? {})
      .map(Number)
      .sort((a, b) => a - b)
      .flatMap((offset) => {
        try {
          return JSON.parse(hash[String(offset)]) as BulkUploadJobResultRow[];
        } catch {
          return [];
        }
      });
    return { rows };
  }

  async retry(id: number): Promise<BulkUploadJobView> {
    const found = await this.findRow(id);
    const { row, info } = await this.reconcile(found);
    const job = await this.queue.getJob(bulkJobId(row.id));
    const data = job?.data as BulkUploadJobData | undefined;
    if (
      !job ||
      !data ||
      row.status !== 'failed' ||
      data.error?.kind !== 'technical' ||
      !info.resumable
    ) {
      throw new VendixHttpException(ErrorCodes.BULK_JOB_NOT_RETRYABLE);
    }

    const type = data.upload_type;
    const lock = await this.acquireLock(data.store_id, type, row.id);
    if (!lock.acquired) {
      throw new VendixHttpException(
        ErrorCodes.BULK_JOB_ALREADY_ACTIVE,
        undefined,
        { job_id: lock.holder },
      );
    }

    const next: BulkUploadJobData = {
      ...data,
      cursor: { ...data.cursor, in_flight_offset: null },
      error: null,
      retry: null,
      finished_at: null,
      deadline_at: new Date(Date.now() + BULK_JOB_DEADLINE_MS).toISOString(),
    };
    try {
      await job.updateData(next);
      await this.prisma.bulk_upload_logs.updateMany({
        where: { id: row.id },
        data: { status: 'queued' },
      });
      await job.retry('failed');
    } catch (error) {
      this.logger.error(
        `Bulk job ${row.id} could not be retried: ${bulkErrorMessage(error)}`,
      );
      await this.locks.release(data.store_id, type, row.id);
      await this.prisma.bulk_upload_logs.updateMany({
        where: { id: row.id },
        data: { status: 'failed' },
      });
      throw new VendixHttpException(ErrorCodes.BULK_JOB_ENQUEUE_FAILED);
    }
    return this.buildView(
      { ...row, status: 'queued' },
      { data: next, resumable: false },
    );
  }

  // ---------------------------------------------------------------- internals

  private async findRow(id: number): Promise<BulkLogRow> {
    const row = (await this.prisma.bulk_upload_logs.findFirst({
      where: { id },
    })) as BulkLogRow | null;
    if (!row || !isBulkJobType(row.upload_type)) {
      throw new VendixHttpException(ErrorCodes.BULK_JOB_NOT_FOUND);
    }
    return row;
  }

  private async discardRow(id: number): Promise<void> {
    try {
      await this.prisma.bulk_upload_logs.deleteMany({ where: { id } });
    } catch (error) {
      this.logger.warn(`Bulk job row ${id} not removed: ${bulkErrorMessage(error)}`);
    }
  }

  /**
   * Candado por tienda y tipo. Si lo tiene una fila terminal, inexistente o
   * colgada (reconciliada a fallo), se libera por compare-and-delete y se
   * reintenta una vez.
   */
  private async acquireLock(
    storeId: number,
    type: BulkJobType,
    logId: number,
  ): Promise<{ acquired: true } | { acquired: false; holder: number | null }> {
    let result = await this.locks.acquire(storeId, type, logId);
    if (result.acquired) return result;
    const holder = result.holder;
    if (holder !== null) {
      const holderRow = (await this.prisma.bulk_upload_logs.findFirst({
        where: { id: holder, upload_type: type },
      })) as BulkLogRow | null;
      const current = holderRow ? (await this.reconcile(holderRow)).row : null;
      if (current && isActiveStatus(current.status)) {
        return { acquired: false, holder };
      }
      await this.locks.release(storeId, type, holder);
    }
    result = await this.locks.acquire(storeId, type, logId);
    return result;
  }

  /**
   * Una fila `queued|running` sin trabajo en BullMQ, con el trabajo caído por
   * estancamiento o vencida hace más de 5 min se cierra como fallo técnico:
   * no quedan trabajos colgados.
   */
  private async reconcile(
    row: BulkLogRow,
  ): Promise<{ row: BulkLogRow; info: JobInfo }> {
    const job = await this.queue.getJob(bulkJobId(row.id));
    const state = job ? await job.getState() : null;
    const data = job?.data as BulkUploadJobData | undefined;
    const info: JobInfo = { data, resumable: state === 'failed' };
    if (!isActiveStatus(row.status)) return { row, info };

    // Recién encolada: el job de BullMQ se agrega justo después del candado.
    const justEnqueued =
      !job &&
      row.status === 'queued' &&
      Date.now() - new Date(row.created_at).getTime() < ENQUEUE_GRACE_MS;
    if (justEnqueued) return { row, info };

    let code: string | null = null;
    if (!job || state === 'failed') {
      code = ErrorCodes.BULK_JOB_INTERRUPTED.code;
    } else if (
      data?.deadline_at &&
      Date.now() > Date.parse(data.deadline_at) + BULK_JOB_RECONCILE_GRACE_MS
    ) {
      code = ErrorCodes.BULK_JOB_TIMEOUT.code;
    }
    if (!code) return { row, info };

    const error: BulkJobError = {
      kind: 'technical',
      code,
      message: BULK_JOB_TECHNICAL_MESSAGE,
    };
    const ticket = await reportBulkJobIncident(
      this.incidents,
      (data ?? this.syntheticData(row)) as BulkUploadJobData,
      {
        code,
        message:
          code === ErrorCodes.BULK_JOB_TIMEOUT.code
            ? ErrorCodes.BULK_JOB_TIMEOUT.devMessage
            : ErrorCodes.BULK_JOB_INTERRUPTED.devMessage,
      },
    );
    const finishedAt = new Date(Date.now()).toISOString();
    await this.prisma.bulk_upload_logs.updateMany({
      where: { id: row.id },
      data: {
        status: 'failed',
        ...(ticket ? { result_reference: ticket.slice(0, 120) } : {}),
      },
    });
    const patch: Partial<BulkUploadJobData> = {
      error,
      retry: null,
      incident_ticket_number: ticket,
      finished_at: finishedAt,
    };
    if (job && data) {
      try {
        await job.updateData({ ...data, ...patch });
      } catch (e) {
        this.logger.warn(
          `Bulk job ${row.id} data not updated on reconcile: ${bulkErrorMessage(e)}`,
        );
      }
    }
    try {
      await this.locks.release(row.store_id, row.upload_type as BulkJobType, row.id);
    } catch (e) {
      this.logger.warn(`Bulk job ${row.id} lock not released: ${bulkErrorMessage(e)}`);
    }
    return {
      row: {
        ...row,
        status: 'failed',
        result_reference: ticket ?? row.result_reference,
      },
      info: { data: { ...(data ?? {}), ...patch }, resumable: state === 'failed' },
    };
  }

  /** Datos mínimos para el incidente cuando el job de BullMQ ya no existe. */
  private syntheticData(row: BulkLogRow): Partial<BulkUploadJobData> {
    const ctx = RequestContextService.getContext();
    return {
      log_id: row.id,
      upload_type: row.upload_type as BulkJobType,
      store_id: row.store_id,
      organization_id: ctx?.organization_id,
      user_id: row.user_id ?? undefined,
      file_name: row.file_name,
      request_id: ctx?.request_id,
    };
  }

  private buildView(row: BulkLogRow, info: JobInfo): BulkUploadJobView {
    const type = row.upload_type as BulkJobType;
    const data = info.data;
    const processed = row.successful_rows + row.failed_rows + row.skipped_rows;
    const terminal = !isActiveStatus(row.status);
    const error = data?.error ?? null;
    return {
      id: row.id,
      upload_type: type,
      status: row.status as BulkUploadJobView['status'],
      file_name: row.file_name,
      user_id: row.user_id ?? null,
      total_rows: row.total_rows,
      processed_rows: processed,
      successful_rows: row.successful_rows,
      failed_rows: row.failed_rows,
      skipped_rows: row.skipped_rows,
      created_rows: row.created_rows ?? null,
      batch_current:
        data?.cursor?.batch ?? Math.ceil(processed / BULK_JOB_BATCH_SIZE),
      batch_total:
        row.total_rows > 0 ? Math.ceil(row.total_rows / BULK_JOB_BATCH_SIZE) : null,
      retry: data?.retry ?? null,
      error,
      incident_ticket_number:
        data?.incident_ticket_number ?? row.result_reference ?? null,
      can_retry:
        row.status === 'failed' && error?.kind === 'technical' && info.resumable,
      auto_retry: BULK_JOB_AUTO_RETRY[type],
      created_at: new Date(row.created_at).toISOString(),
      started_at: data?.started_at ?? null,
      finished_at:
        data?.finished_at ??
        (terminal ? new Date(row.updated_at).toISOString() : null),
      deadline_at: data?.deadline_at ?? null,
    };
  }
}
