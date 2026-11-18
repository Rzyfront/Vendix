import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
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

  constructor(
    private readonly crmGenerationService: CrmGenerationService,
    private readonly monitor: AiJobMonitorService,
  ) {
    super();
  }

  async process(job: Job<CrmLandingJob>): Promise<{ ready: true }> {
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
        () =>
          this.monitor.runAiWork(job, LEGACY_AI_SOURCES.crmLanding, () =>
            this.crmGenerationService.generateLanding(store_id),
          ),
      );
      // The shared AI job client needs a non-empty result to finish.
      return { ready: true };
    } catch (error: any) {
      this.logger.error(`crm-landing job ${job.id} failed: ${error?.message}`);
      // `failedReason` reaches the user: propagate the CODE.
      throw toAiJobFailure(error);
    }
  }

  /** QUI-1020: a job that fails for good alerts Vendix once (deduplicated). */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<CrmLandingJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(
      job,
      LEGACY_AI_SOURCES.crmLanding,
      job.data?.context,
    );
  }
}
