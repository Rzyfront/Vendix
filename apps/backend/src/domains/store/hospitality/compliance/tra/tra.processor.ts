import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { LodgingTraService, TRA_QUEUE, TraJob } from './tra-submissions.service';

/**
 * Hospitality Suite (H4.1) — sends one TRA record per job. The service throws
 * only when the portal is down, so BullMQ backs off (5 attempts); after the
 * last one the row stays "Pendiente" with "Reintentar".
 */
@Processor(TRA_QUEUE)
export class LodgingTraProcessor extends WorkerHost {
  constructor(private readonly tra: LodgingTraService) {
    super();
  }

  async process(job: Job<TraJob>): Promise<string> {
    return this.tra.deliver(job.data.submission_id);
  }
}
