import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  AiJobMonitorService,
  AiJobOwner,
} from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
import { ReceivedDocumentScanJob, ReceivedDocumentScanResult } from '../interfaces/received-document-scan-job.interface';
import { ReceivedDocumentScanQueueService } from './received-document-scan-queue.service';

/** Maps the job's tenant snapshot to the owner the AI monitor reports. */
export function receivedDocumentScanOwner(
  job: Pick<Job<ReceivedDocumentScanJob>, 'data'>,
): AiJobOwner | undefined {
  const context = job.data?.context;
  if (!context) return undefined;
  return {
    store_id: context.store_id,
    organization_id: context.organization_id,
    user_id: context.actor_id,
    request_id: context.request_id,
  };
}

@Processor('received-document-scan', { concurrency: 1 })
export class ReceivedDocumentScanProcessor extends WorkerHost {
  constructor(
    private readonly scanQueue: ReceivedDocumentScanQueueService,
    private readonly monitor: AiJobMonitorService,
  ) {
    super();
  }

  async process(job: Job<ReceivedDocumentScanJob>): Promise<ReceivedDocumentScanResult> {
    try {
      return await this.monitor.runAiWork(job, LEGACY_AI_SOURCES.receivedDocumentScan, () =>
        this.scanQueue.process(job.data),
      );
    } catch (error) {
      // `failedReason` carries the Vendix error CODE (QUI-1020).
      throw toAiJobFailure(error);
    }
  }

  /** QUI-1020: a job that fails for good alerts Vendix once (deduplicated). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ReceivedDocumentScanJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(job, LEGACY_AI_SOURCES.receivedDocumentScan, receivedDocumentScanOwner(job));
  }
}
