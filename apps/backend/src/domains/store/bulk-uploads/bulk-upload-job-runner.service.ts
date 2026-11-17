import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PlatformIncidentService } from '@common/incidents/platform-incident.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { BulkUploadHandlerRegistry } from './bulk-upload-handler.registry';
import { BulkUploadJobLockService } from './bulk-upload-job-lock.service';
import {
  BULK_JOB_MAX_RETRIES,
  BULK_JOB_RETENTION_SECONDS,
  BULK_JOB_RETRY_DELAYS_MS,
  BULK_JOB_BATCH_SIZE,
  bulkErrorCode,
  bulkErrorMessage,
  bulkJobResultsKey,
  classifyBulkError,
  type BulkJobCursor,
  type BulkJobError,
  type BulkJobHandle,
  type BulkJobOutcome,
  type BulkJobPageResult,
  type BulkUploadJobData,
  type BulkUploadJobHandler,
} from './bulk-upload-job.types';
import {
  BULK_JOB_TECHNICAL_MESSAGE,
  reportBulkJobIncident,
} from './bulk-upload-job-incident.util';
import {
  resolveBulkUploadStatus,
  type BulkUploadStatus,
} from './bulk-upload-log.types';

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Detalles de fila que la pantalla lee como objeto (columna, valor, sugerencia).
 * Se guardan planos, solo con sus campos primitivos.
 */
const FLAT_DETAIL_KEYS = new Set(['row_error']);

const isPrimitive = (value: unknown) =>
  value === null || typeof value !== 'object';

/**
 * Quita los objetos anidados pesados (`product`, `customer`, …) de una fila de
 * resultado. Esos objetos pueden traer datos internos: solo sobreviven los
 * detalles de `FLAT_DETAIL_KEYS`, aplanados.
 */
export function stripNestedResultRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    if (isPrimitive(value)) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      if (value.every(isPrimitive)) out[key] = value;
    } else if (FLAT_DETAIL_KEYS.has(key)) {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([, v]) =>
          isPrimitive(v),
        ),
      );
    }
  }
  return out;
}

/**
 * Toda la lógica del bucle por lotes de un trabajo durable. El procesador
 * BullMQ solo restaura el contexto del tenant y delega aquí.
 *
 * Invariantes:
 *  - El cursor de `job.data` es el único punto de confirmación de cada lote.
 *  - Los conteos de `bulk_upload_logs` son absolutos desde el cursor (nunca
 *    `increment`): re-ejecutar un lote no los duplica.
 *  - Un lote re-ejecutado sobrescribe su campo del hash de resultados.
 */
@Injectable()
export class BulkUploadJobRunnerService {
  private readonly logger = new Logger(BulkUploadJobRunnerService.name);

  /** Sustituibles en los specs. */
  sleep: (ms: number) => Promise<void> = defaultSleep;
  now: () => number = () => Date.now();

  constructor(
    private readonly registry: BulkUploadHandlerRegistry,
    private readonly prisma: StorePrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly locks: BulkUploadJobLockService,
    private readonly incidents: PlatformIncidentService,
  ) {}

  async run(job: BulkJobHandle): Promise<BulkJobOutcome> {
    const handler = this.registry.get(job.data.upload_type);
    if (!handler) {
      return this.failTechnical(
        job,
        undefined,
        new Error(`No handler for bulk upload type ${job.data.upload_type}`),
        ErrorCodes.BULK_JOB_NO_HANDLER.code,
      );
    }

    await this.patch(job, {
      started_at: job.data.started_at ?? new Date(this.now()).toISOString(),
      finished_at: null,
      retry: null,
      error: null,
    });
    await this.writeLog(job.data, 'running');

    if (!handler.autoRetry && job.data.cursor.in_flight_offset != null) {
      // Un lote pudo aplicarse a medias: no se re-ejecuta solo.
      return this.failTechnical(
        job,
        handler,
        new VendixHttpException(ErrorCodes.BULK_JOB_INTERRUPTED),
      );
    }

    while (!this.isFinished(job.data.cursor)) {
      if (this.now() > Date.parse(job.data.deadline_at)) {
        return this.failTechnical(
          job,
          handler,
          new VendixHttpException(ErrorCodes.BULK_JOB_TIMEOUT),
        );
      }
      const offset = job.data.cursor.offset;
      if (!handler.autoRetry) {
        await this.patch(job, {
          cursor: { ...job.data.cursor, in_flight_offset: offset },
        });
      }
      let page: BulkJobPageResult;
      try {
        page = await this.runBatch(job, handler, offset);
      } catch (error) {
        return classifyBulkError(error) === 'data'
          ? this.failData(job, handler, error)
          : this.failTechnical(job, handler, error);
      }
      if (page.done) break;
    }

    return this.finish(job, handler);
  }

  /** `true` cuando el cursor ya cubre el archivo (el total se conoce tras la 1.ª página). */
  private isFinished(cursor: BulkJobCursor): boolean {
    return cursor.total > 0 && cursor.offset >= cursor.total;
  }

  /**
   * Un lote = procesar + confirmar. Fallo técnico en tipo idempotente: espera
   * 2 s → 4 s → 8 s y repite (máx. 3 reintentos). Error de datos: sin reintento.
   */
  private async runBatch(
    job: BulkJobHandle,
    handler: BulkUploadJobHandler,
    offset: number,
  ): Promise<BulkJobPageResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        const page = await handler.runPage(job.data, offset, BULK_JOB_BATCH_SIZE);
        await this.commitBatch(job, offset, page);
        return page;
      } catch (error) {
        const retryable =
          handler.autoRetry &&
          classifyBulkError(error) === 'technical' &&
          attempt < BULK_JOB_MAX_RETRIES;
        if (!retryable) throw error;
        const delay = BULK_JOB_RETRY_DELAYS_MS[attempt];
        this.logger.warn(
          `[BulkJob ${job.data.log_id}] batch ${offset} failed (attempt ${attempt + 1}/${BULK_JOB_MAX_RETRIES}): ${bulkErrorMessage(error)}`,
        );
        await this.patch(job, {
          retry: {
            attempt: attempt + 1,
            max_attempts: BULK_JOB_MAX_RETRIES,
            next_retry_at: new Date(this.now() + delay).toISOString(),
            message: BULK_JOB_TECHNICAL_MESSAGE,
          },
        });
        await this.sleep(delay);
      }
    }
  }

  /** Resultados → fila del historial (absoluta) → cursor (punto de confirmación). */
  private async commitBatch(
    job: BulkJobHandle,
    offset: number,
    page: BulkJobPageResult,
  ): Promise<void> {
    const key = bulkJobResultsKey(job.data.log_id);
    await this.redis.hset(
      key,
      String(offset),
      JSON.stringify((page.rows ?? []).map(stripNestedResultRow)),
    );
    await this.redis.expire(key, BULK_JOB_RETENTION_SECONDS);

    const prev = job.data.cursor;
    const cursor: BulkJobCursor = {
      offset: offset + BULK_JOB_BATCH_SIZE,
      batch: prev.batch + 1,
      successful: prev.successful + (page.successful ?? 0),
      failed: prev.failed + (page.failed ?? 0),
      skipped: prev.skipped + (page.skipped ?? 0),
      created:
        page.created == null ? prev.created : (prev.created ?? 0) + page.created,
      total: page.total > 0 ? page.total : prev.total,
      in_flight_offset: null,
    };
    await this.writeLog({ ...job.data, cursor }, 'running');
    await this.patch(job, { cursor, retry: null });
  }

  private async finish(
    job: BulkJobHandle,
    handler: BulkUploadJobHandler,
  ): Promise<BulkJobOutcome> {
    const { cursor } = job.data;
    const status = resolveBulkUploadStatus({
      successful_rows: cursor.successful,
      failed_rows: cursor.failed,
    });
    try {
      await this.writeLog(job.data, status);
      await this.patch(job, {
        finished_at: new Date(this.now()).toISOString(),
        retry: null,
        error: null,
      });
      await this.safely('cleanup', () => handler.cleanup(job.data));
    } finally {
      await this.safely('release lock', () => this.release(job.data));
    }
    return 'completed';
  }

  private async failData(
    job: BulkJobHandle,
    handler: BulkUploadJobHandler,
    error: unknown,
  ): Promise<BulkJobOutcome> {
    const failure: BulkJobError = {
      kind: 'data',
      code: bulkErrorCode(error),
      message: bulkErrorMessage(error),
    };
    this.logger.warn(
      `[BulkJob ${job.data.log_id}] failed (data): ${failure.code ?? ''} ${failure.message}`,
    );
    try {
      await this.patch(job, {
        error: failure,
        retry: null,
        finished_at: new Date(this.now()).toISOString(),
      });
      await this.writeLog(job.data, 'failed');
      await this.safely('cleanup', () => handler.cleanup(job.data));
    } finally {
      await this.safely('release lock', () => this.release(job.data));
    }
    return 'failed_data';
  }

  private async failTechnical(
    job: BulkJobHandle,
    handler: BulkUploadJobHandler | undefined,
    error: unknown,
    codeOverride?: string,
  ): Promise<BulkJobOutcome> {
    void handler; // temp files are kept for the manual retry
    const code = codeOverride ?? bulkErrorCode(error);
    this.logger.error(
      `[BulkJob ${job.data.log_id}] failed (technical): ${bulkErrorMessage(error)}`,
      (error as Error)?.stack,
    );
    const ticket = await reportBulkJobIncident(this.incidents, job.data, {
      code,
      message: bulkErrorMessage(error),
      stack: (error as Error)?.stack,
    });
    // Si falla la base o Redis, el error sube (el trabajo queda `failed` en
    // BullMQ y la lectura lo reconcilia), pero el lock se libera siempre: no
    // debe bloquear la siguiente carga de la tienda hasta que venza.
    try {
      await this.patch(job, {
        error: { kind: 'technical', code, message: BULK_JOB_TECHNICAL_MESSAGE },
        retry: null,
        incident_ticket_number: ticket,
        finished_at: new Date(this.now()).toISOString(),
      });
      await this.writeLog(job.data, 'failed', ticket);
    } finally {
      await this.safely('release lock', () => this.release(job.data));
    }
    return 'failed_technical';
  }

  private release(data: BulkUploadJobData): Promise<void> {
    return this.locks.release(data.store_id, data.upload_type, data.log_id);
  }

  private async patch(
    job: BulkJobHandle,
    patch: Partial<BulkUploadJobData>,
  ): Promise<void> {
    await job.updateData({ ...job.data, ...patch });
  }

  /** Conteos absolutos desde el cursor. */
  private async writeLog(
    data: BulkUploadJobData,
    status: BulkUploadStatus,
    resultReference?: string | null,
  ): Promise<void> {
    const c = data.cursor;
    await this.prisma.bulk_upload_logs.updateMany({
      where: { id: data.log_id },
      data: {
        status,
        total_rows: Math.max(c.total, c.successful + c.failed + c.skipped),
        successful_rows: c.successful,
        created_rows: c.created,
        failed_rows: c.failed,
        skipped_rows: c.skipped,
        ...(resultReference ? { result_reference: resultReference.slice(0, 120) } : {}),
      },
    });
  }

  private async safely(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`Bulk job ${label} failed: ${bulkErrorMessage(error)}`);
    }
  }
}
