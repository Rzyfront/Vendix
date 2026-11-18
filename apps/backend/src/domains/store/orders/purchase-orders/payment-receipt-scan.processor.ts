import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { InvoiceScannerService } from './invoice-scanner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
import {
  PaymentReceiptScanJob,
  PaymentReceiptScanResult,
} from './payment-receipt-scan-job.interface';
import { ErrorCodes } from '@common/errors';

/** Model read/parse failures: non-deterministic, so BullMQ keeps retrying them. */
const PAYMENT_SCAN_RETRY_CODES = [
  ErrorCodes.INV_SCAN_AI_FAIL.code,
  ErrorCodes.INV_SCAN_PARSE_FAIL.code,
];

/**
 * Track B2 — async processor for the payment-receipt OCR scan queue.
 *
 * Calque of `receipt-scan.processor.ts` / `expense-scan.processor.ts`
 * (skill `vendix-ai-queue` v2.2):
 *  - Restores `RequestContextService.run(context, ...)` so the underlying
 *    aiEngine call stays tenant-scoped (organization/store/user from job.data).
 *  - Returns the UNCHANGED `PaymentReceiptScanResult` in `job.returnvalue`,
 *    which the controller surfaces via `GET /:id/payments/scan/:jobId`.
 *  - On error, RE-THROW so BullMQ applies its retry policy (attempts: 3,
 *    exponential backoff 2s — set in the controller's `queue.add`).
 */
@Processor('payment-receipt-scan')
export class PaymentReceiptScanProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReceiptScanProcessor.name);

  constructor(
    private readonly invoiceScanner: InvoiceScannerService,
    private readonly monitor: AiJobMonitorService,
  ) {
    super();
  }

  async process(job: Job<PaymentReceiptScanJob>): Promise<PaymentReceiptScanResult> {
    const { dataUri, mimeType, context } = job.data;
    const requestId = context.request_id ?? `queue-${randomUUID()}`;

    this.logger.log(
      `[PaymentReceiptScan] job=${job.id} starting (store=${context.store_id ?? '?'}, org=${context.organization_id ?? '?'})`,
    );

    try {
      const result = await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: context.store_id,
          organization_id: context.organization_id,
          user_id: context.user_id,
          request_id: requestId,
        },
        () =>
          this.monitor.runAiWork(job, LEGACY_AI_SOURCES.paymentReceiptScan, () =>
            this.invoiceScanner.scanPaymentFromImage(dataUri, mimeType),
          ),
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        `[PaymentReceiptScan] job=${job.id} failed: ${error?.message ?? error}`,
      );
      // Vendix errors keep their CODE as `failedReason`; model read/parse
      // failures stay retryable, the rest of the 4xx are final.
      throw toAiJobFailure(error, { retryCodes: PAYMENT_SCAN_RETRY_CODES });
    }
  }

  /** QUI-1020: a final, non-document failure alerts Vendix once. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<PaymentReceiptScanJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(
      job,
      LEGACY_AI_SOURCES.paymentReceiptScan,
      job.data?.context,
    );
  }
}
