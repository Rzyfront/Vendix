import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { BulkUploadJobRunnerService } from './bulk-upload-job-runner.service';
import {
  BULK_UPLOAD_JOBS_QUEUE,
  type BulkJobHandle,
  type BulkJobOutcome,
  type BulkUploadJobData,
} from './bulk-upload-job.types';

/**
 * Procesador fino de la cola `bulk-upload-jobs`: restaura el contexto del
 * tenant que encoló (snapshot de `job.data`, nunca del payload del cliente) y
 * delega todo el bucle en `BulkUploadJobRunnerService`.
 *
 * Un fallo técnico termina el job de BullMQ como `failed` (UnrecoverableError)
 * para que el reintento manual pueda hacer `job.retry()` conservando el
 * cursor. `VENDIX_PROCESS_ROLE=api` deja este worker inerte (DormantWorker).
 */
@Processor(BULK_UPLOAD_JOBS_QUEUE, {
  concurrency: 2,
  lockDuration: 120_000,
  maxStalledCount: 3,
})
export class BulkUploadJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkUploadJobsProcessor.name);

  constructor(private readonly runner: BulkUploadJobRunnerService) {
    super();
  }

  async process(job: Job<BulkUploadJobData>): Promise<{ outcome: BulkJobOutcome }> {
    const data = job.data;
    return RequestContextService.runIsolated(
      {
        is_super_admin: data.roles?.includes('super_admin') ?? false,
        is_owner: data.roles?.includes('owner') ?? false,
        store_id: data.store_id,
        organization_id: data.organization_id,
        user_id: data.user_id,
        roles: data.roles,
        permissions: data.permissions,
        request_id: data.request_id ?? `queue-${randomUUID()}`,
      },
      async () => {
        this.logger.log(
          `[BulkJob ${data.log_id}] ${data.upload_type} store=${data.store_id} offset=${data.cursor?.offset ?? 0}`,
        );
        const outcome = await this.runner.run(job as unknown as BulkJobHandle);
        if (outcome === 'failed_technical') {
          throw new UnrecoverableError(
            job.data.error?.code ?? 'BULK_JOB_TECHNICAL_FAILURE',
          );
        }
        return { outcome };
      },
    );
  }
}
