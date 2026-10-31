import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CRM_OUTBOUND_QUEUE, CrmOutboundJob } from './crm-outbound.constants';

/**
 * Enqueues delivery of an outbound `crm_messages` row. The caller creates the
 * row in status `queued` first; the job only carries its id.
 *
 * The job id is derived from the message id, so enqueuing the same message
 * twice while its job is still kept by Redis is a no-op.
 */
@Injectable()
export class CrmOutboundQueue {
  constructor(
    @InjectQueue(CRM_OUTBOUND_QUEUE)
    private readonly queue: Queue<CrmOutboundJob>,
  ) {}

  async enqueue(messageId: number): Promise<void> {
    await this.queue.add(
      'send',
      { message_id: messageId },
      {
        jobId: `crm-outbound-${messageId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
  }
}
