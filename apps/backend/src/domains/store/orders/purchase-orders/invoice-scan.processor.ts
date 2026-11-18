import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { InvoiceScannerService } from './invoice-scanner.service';
import { mimeFromKey } from './invoice-revalidate.processor';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
import { InvoiceScanJob } from './interfaces/invoice-scan-job.interface';
import { InvoiceScanResult } from './dto/scan-invoice.dto';

/**
 * Processor async de la cola `invoice-scan` (escaneo IA de facturas de compra).
 *
 * Calque de `invoice-revalidate.processor.ts`:
 *  - restaura `RequestContextService.run` (tenant desde job.data);
 *  - descarga el documento de S3 por su KEY y delega en
 *    `InvoiceScannerService.scanInvoiceFromBuffer`;
 *  - errores DETERMINISTAS (respuesta ilegible / incompleta) => UnrecoverableError
 *    (sin reintentos); un fallo de la IA/S3 se relanza para que BullMQ reintente.
 */
@Processor('invoice-scan', { concurrency: 3 })
export class InvoiceScanProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceScanProcessor.name);

  constructor(
    private readonly invoiceScanner: InvoiceScannerService,
    private readonly s3Service: S3Service,
    private readonly monitor: AiJobMonitorService,
  ) {
    super();
  }

  async process(job: Job<InvoiceScanJob>): Promise<InvoiceScanResult> {
    const data = job.data;
    const requestId = data.request_id ?? `queue-${randomUUID()}`;

    this.logger.log(
      `[InvoiceScan] job=${job.id} starting (store=${data.store_id ?? '?'}, org=${data.organization_id ?? '?'})`,
    );

    try {
      return await RequestContextService.run(
        {
          is_super_admin: false,
          is_owner: false,
          store_id: data.store_id,
          organization_id: data.organization_id,
          user_id: data.user_id,
          request_id: requestId,
        },
        async () => {
          let buffer: Buffer;
          try {
            buffer = await this.s3Service.downloadFile(data.scan_attachment_key);
          } catch (err: any) {
            this.logger.error(
              `[InvoiceScan] job=${job.id} S3 download failed: ${err?.message ?? err}`,
            );
            throw new Error(
              'No se pudo leer el documento guardado. Intenta de nuevo.',
            );
          }
          return this.monitor.runAiWork(job, LEGACY_AI_SOURCES.invoiceScan, () =>
            this.invoiceScanner.scanInvoiceFromBuffer(
              buffer,
              mimeFromKey(data.scan_attachment_key, buffer),
              data.order_type,
              data.scan_attachment,
            ),
          );
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[InvoiceScan] job=${job.id} failed: ${error?.message ?? error}`,
      );
      // `failedReason` reaches the user: the Vendix error CODE is propagated
      // (the frontend maps it with `ERROR_MESSAGES`). A 4xx (unreadable or
      // incomplete response) is final; anything else is retried.
      throw toAiJobFailure(error);
    }
  }

  /** QUI-1020: a final, non-document failure alerts Vendix once. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<InvoiceScanJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(job, LEGACY_AI_SOURCES.invoiceScan, job.data);
  }
}
