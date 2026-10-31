import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CRM_INBOUND_QUEUE, CrmInboundJob } from './crm-inbound.constants';

/**
 * Enqueues processing of a stored Meta webhook event. One job per event id,
 * so a duplicated enqueue of the same event is a no-op while Redis keeps it.
 */
@Injectable()
export class CrmInboundQueue {
  constructor(
    @InjectQueue(CRM_INBOUND_QUEUE)
    private readonly queue: Queue<CrmInboundJob>,
  ) {}

  async enqueue(eventId: number): Promise<void> {
    await this.queue.add(
      'process',
      { event_id: eventId },
      {
        jobId: `crm-inbound-${eventId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
  }
}
