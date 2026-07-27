import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { InvoiceScannerService } from './invoice-scanner.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  PaymentReceiptScanJob,
  PaymentReceiptScanResult,
} from './payment-receipt-scan-job.interface';

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

  constructor(private readonly invoiceScanner: InvoiceScannerService) {
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
        () => this.invoiceScanner.scanPaymentFromImage(dataUri, mimeType),
      );
      return result;
    } catch (error: any) {
      this.logger.error(
        `[PaymentReceiptScan] job=${job.id} failed: ${error?.message ?? error}`,
      );
      throw error; // let BullMQ retry
    }
  }
}
