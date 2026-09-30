import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DocumentReceptionSyncJob } from '../interfaces/document-reception-sync-job.interface';

const QUEUE_NAME = 'document-reception-sync';
const TERMINAL_STATES = new Set(['completed', 'failed']);

@Injectable()
export class DocumentReceptionSyncQueueService {
  constructor(
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue<DocumentReceptionSyncJob>,
  ) {}

  async enqueue(runId: number): Promise<{ run_id: number; job_id: string }> {
    if (!Number.isSafeInteger(runId) || runId <= 0) {
      throw new BadRequestException('run_id debe ser un entero positivo.');
    }

    const jobId = `dr-sync-${runId}`;
    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (!TERMINAL_STATES.has(state)) {
          // Preserve all nonterminal work, including paused/waiting-children states.
          return { run_id: runId, job_id: jobId };
        }
        await existing.remove();
      }

      const job = await this.queue.add('sync', { run_id: runId }, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      });
      return { run_id: runId, job_id: String(job.id ?? jobId) };
    } catch {
      // Never expose provider/job data or Redis errors to API callers.
      throw new ServiceUnavailableException('No se pudo programar la sincronización.');
    }
  }
}
