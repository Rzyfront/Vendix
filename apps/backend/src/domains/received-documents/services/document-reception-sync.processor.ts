import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DocumentReceptionSyncJob } from '../interfaces/document-reception-sync-job.interface';
import {
  DocumentReceptionSyncProcessResult,
  DocumentReceptionSyncService,
} from './document-reception-sync.service';

@Processor('document-reception-sync', { concurrency: 1 })
export class DocumentReceptionSyncProcessor extends WorkerHost {
  constructor(private readonly sync: DocumentReceptionSyncService) {
    super();
  }

  async process(job: Job<DocumentReceptionSyncJob>): Promise<DocumentReceptionSyncProcessResult> {
    const runId = job?.data?.run_id;
    if (!Number.isSafeInteger(runId) || (runId as number) <= 0) {
      throw new Error('Invalid document reception sync job.');
    }

    // Lease conflicts intentionally propagate so BullMQ retries/reports failure;
    // they must never be mistaken for successful completion.
    const result = await this.sync.process(runId as number);
    if (result.status === 'failed' || result.status === 'partial') {
      throw new Error('Document reception sync run incomplete.');
    }
    return result;
  }
}
