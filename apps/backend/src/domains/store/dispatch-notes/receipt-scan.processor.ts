import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { DispatchNotesService } from './dispatch-notes.service';
import { ScanReceiptResult } from './dto/scan-receipt.dto';
import { ReceiptScanJob } from './receipt-scan-job.interface';

/**
 * Async worker for the purchase-receipt OCR scanner (`receipt-scan` queue).
 *
 * Style calque of `AIGenerationProcessor`: `@Processor` + `WorkerHost.process`,
 * re-establishing the tenant `RequestContext` from the job payload so the
 * catalog matching inside `DispatchNotesService.scanReceiptFromImage` resolves
 * to the originating store (StorePrismaService reads store_id from
 * AsyncLocalStorage — it is NOT naturally present in a BullMQ worker).
 *
 * On failure it re-throws so BullMQ applies its retry policy (attempts +
 * exponential backoff configured by the producer, `enqueueReceiptScan`); the
 * `failedReason` is surfaced to the polling client via `getReceiptScanJobStatus`.
 * The successful return value (an unchanged `ScanReceiptResult`) lands in
 * `job.returnvalue`.
 */
@Processor('receipt-scan')
export class ReceiptScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ReceiptScanProcessor.name);

  constructor(private readonly dispatchNotesService: DispatchNotesService) {
    super();
  }

  async process(job: Job<ReceiptScanJob>): Promise<ScanReceiptResult> {
    const { dataUri, mimeType, context } = job.data;

    this.logger.log(
      `Processing receipt-scan job ${job.id} (store_id=${context?.store_id})`,
    );

    // request_id keeps any downstream replay/dedup logic stable across BullMQ
    // retries (same job → same id). Fall back to a fresh uuid defensively.
    const requestId =
      context?.request_id && context.request_id.trim().length > 0
        ? context.request_id
        : `queue-${randomUUID()}`;

    try {
      return await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: context?.store_id,
          organization_id: context?.organization_id,
          user_id: context?.user_id,
          request_id: requestId,
        },
        () => this.dispatchNotesService.scanReceiptFromImage(dataUri, mimeType),
      );
    } catch (error: any) {
      this.logger.error(
        `Receipt-scan job ${job.id} failed: ${error?.message}`,
      );
      // Re-throw so BullMQ marks the job failed / retries per the enqueue policy.
      throw error;
    }
  }
}
