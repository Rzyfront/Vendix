import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CRM_INBOUND_QUEUE, CrmInboundJob } from './crm-inbound.constants';
import { MetaWhatsappInboundService } from './meta-whatsapp-inbound.service';

/** Statuses whose outbound row has no wamid yet get this many retries. */
const STATUS_RETRY_ATTEMPTS = 2;

/**
 * Worker for stored Meta webhook events. Concurrency 1 keeps events of the
 * same conversation in arrival order (unread counts, status sequence); the
 * service is idempotent, so BullMQ retries are safe.
 */
@Processor(CRM_INBOUND_QUEUE, { concurrency: 1 })
export class CrmInboundProcessor extends WorkerHost {
  private readonly logger = new Logger(CrmInboundProcessor.name);

  constructor(private readonly inbound: MetaWhatsappInboundService) {
    super();
  }

  async process(job: Job<CrmInboundJob>): Promise<void> {
    const eventId = job.data.event_id;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    try {
      const outcome = await this.inbound.processEvent(eventId, {
        isLastAttempt,
        allowStatusRetry: job.attemptsMade < STATUS_RETRY_ATTEMPTS,
      });
      if (outcome.status === 'retry') {
        throw new Error(
          `crm-inbound ${eventId}: ${outcome.statuses_missing} status(es) not matched yet, retry`,
        );
      }
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      if (isLastAttempt) {
        this.logger.error(`crm-inbound event ${eventId} failed: ${message}`);
        await this.inbound.markFailed(eventId, message);
      }
      throw error;
    }
  }
}
