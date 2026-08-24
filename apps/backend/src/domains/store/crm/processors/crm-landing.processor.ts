import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { CrmGenerationService } from '../services/crm-generation.service';
import { CrmLandingJob } from '../interfaces/crm-landing-job.interface';

/**
 * Async worker for the CRM landing generator (`crm-landing` queue).
 *
 * Style calque of `ReceiptScanProcessor`: re-establishes the tenant
 * `RequestContext` from the job payload so the scoped reads inside
 * `CrmGenerationService.generateLanding` (landing row, settings, analytics)
 * resolve to the originating store. On failure it re-throws so BullMQ applies
 * the retry policy configured by the producer; the row is marked `failed`
 * with a readable message inside the service before re-throwing.
 */
@Processor('crm-landing')
export class CrmLandingProcessor extends WorkerHost {
  private readonly logger = new Logger(CrmLandingProcessor.name);

  constructor(private readonly crmGenerationService: CrmGenerationService) {
    super();
  }

  async process(job: Job<CrmLandingJob>): Promise<void> {
    const { store_id, context } = job.data;

    this.logger.log(
      `Processing crm-landing job ${job.id} (store_id=${store_id})`,
    );

    const requestId =
      context?.request_id && context.request_id.trim().length > 0
        ? context.request_id
        : `queue-${randomUUID()}`;

    try {
      await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id,
          organization_id: context?.organization_id,
          user_id: context?.user_id,
          request_id: requestId,
        },
        () => this.crmGenerationService.generateLanding(store_id),
      );
    } catch (error: any) {
      this.logger.error(`crm-landing job ${job.id} failed: ${error?.message}`);
      throw error;
    }
  }
}
