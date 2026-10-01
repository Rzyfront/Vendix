import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReceivedDocumentScanJob, ReceivedDocumentScanResult } from '../interfaces/received-document-scan-job.interface';
import { ReceivedDocumentScanQueueService } from './received-document-scan-queue.service';

@Processor('received-document-scan', { concurrency: 1 })
export class ReceivedDocumentScanProcessor extends WorkerHost {
  constructor(private readonly scanQueue: ReceivedDocumentScanQueueService) {
    super();
  }

  process(job: Job<ReceivedDocumentScanJob>): Promise<ReceivedDocumentScanResult> {
    return this.scanQueue.process(job.data);
  }
}
