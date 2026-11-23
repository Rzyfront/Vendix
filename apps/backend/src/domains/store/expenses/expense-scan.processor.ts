import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { RequestContextService } from '../../../common/context/request-context.service';
import { AiJobMonitorService } from '../../../common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '../../../common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '../../../common/ai-scan-jobs/ai-job-failure.util';
import { ExpenseScannerService } from './expense-scanner.service';
import { ExpenseScanResponse } from './dto/scan-expense.dto';
import { ExpenseScanJob } from './expense-scan-job.interface';
import { ErrorCodes } from '../../../common/errors';
import { S3Service } from '../../../common/services/s3.service';
import {
  discardQueuedDocument,
  loadQueuedDocument,
} from '../../../common/ai-ingest/documents/queued-document';

/** Model read/parse failures: non-deterministic, so BullMQ keeps retrying them. */
const EXPENSE_SCAN_RETRY_CODES = [
  ErrorCodes.INV_SCAN_AI_FAIL.code,
  ErrorCodes.INV_SCAN_PARSE_FAIL.code,
];

/**
 * Worker de la cola `expense-scan`. Ejecuta la parte pesada del escaneo de
 * factura de gasto (OCR + parse + matching) fuera del ciclo request/response.
 *
 * El `AsyncLocalStorage` del request HTTP NO llega al worker, por lo que hay que
 * restaurar el contexto multi-tenant con `RequestContextService.run(...)` a
 * partir de `job.data.context`. Sin esto, `matchCategory` no vería
 * `organization_id` y el matching de categorías quedaría sin scope.
 *
 * El valor retornado es `ExpenseScanResponse` sin cambios de forma y queda en
 * `job.returnvalue` para que el polling (`GET store/expenses/scan/:jobId`) lo
 * devuelva. Los fallos se propagan (throw) para que BullMQ aplique su política
 * de reintentos.
 */
@Processor('expense-scan')
export class ExpenseScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ExpenseScanProcessor.name);

  constructor(
    private readonly scannerService: ExpenseScannerService,
    private readonly monitor: AiJobMonitorService,
    private readonly s3Service: S3Service,
  ) {
    super();
  }

  async process(job: Job<ExpenseScanJob>): Promise<ExpenseScanResponse> {
    const { context } = job.data;

    this.logger.log(
      `Processing expense-scan job ${job.id} (store_id=${context.store_id ?? '-'}, organization_id=${context.organization_id ?? '-'})`,
    );

    try {
      return await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: context.store_id,
          organization_id: context.organization_id,
          user_id: context.user_id,
          request_id: context.request_id,
        },
        () =>
          this.monitor.runAiWork(job, LEGACY_AI_SOURCES.expenseScan, async () => {
            // ia-cargas F5a: new jobs carry the S3 key of the original file;
            // jobs queued before carry the data URI. Both are read by pages.
            const file = await loadQueuedDocument(this.s3Service, job.data);
            const result = await this.scannerService.scanFromFile(file, {
              // Real progress by pages. `at`: a job that keeps reporting is
              // alive, not stalled (QUI-1020).
              reportProgress: async (progress) => {
                try {
                  await job.updateProgress({ ...progress, at: Date.now() });
                } catch {
                  // Progress is best effort.
                }
              },
            });
            await discardQueuedDocument(this.s3Service, job.data);
            return result;
          }),
      );
    } catch (error: any) {
      this.logger.error(
        `Expense-scan job ${job.id} failed: ${error?.message}`,
      );
      // Re-lanzar para que BullMQ registre failedReason (el CODIGO de Vendix)
      // y aplique reintentos.
      const failure = toAiJobFailure(error, { retryCodes: EXPENSE_SCAN_RETRY_CODES });
      // Failed for good (document problem or last attempt): the S3 copy of
      // the upload is no longer needed.
      if (
        failure instanceof UnrecoverableError ||
        (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1)
      ) {
        await discardQueuedDocument(this.s3Service, job.data);
      }
      throw failure;
    }
  }

  /** QUI-1020: a job that fails for good alerts Vendix once (deduplicated). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ExpenseScanJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(
      job,
      LEGACY_AI_SOURCES.expenseScan,
      job.data?.context,
    );
  }
}
