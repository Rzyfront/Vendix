import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { InvoiceScannerService } from './invoice-scanner.service';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AiJobMonitorService } from '@common/ai-scan-jobs/ai-job-monitor.service';
import { LEGACY_AI_SOURCES } from '@common/ai-scan-jobs/ai-scan-sources';
import { toAiJobFailure } from '@common/ai-scan-jobs/ai-job-failure.util';
import {
  InvoiceRevalidateJob,
  InvoiceRevalidateResult,
} from './interfaces/invoice-revalidate-job.interface';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** MIME por bytes mágicos; null si ninguno casa. */
export function mimeFromBytes(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

export function mimeFromKey(key: string, buffer?: Buffer): string {
  const sniffed = buffer ? mimeFromBytes(buffer) : null;
  if (sniffed) return sniffed;
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? 'image/jpeg';
}

/**
 * QUI-855 paso 8a - processor async de la cola `invoice-revalidate`.
 *
 * Calque de `payment-receipt-scan.processor.ts`:
 *  - restaura `RequestContextService.run` (tenant desde job.data) para que
 *    `aiEngine.run` (gate de suscripcion, cuota, logs) y los settings queden
 *    scopeados a la tienda;
 *  - descarga el documento de S3 por su KEY y delega en
 *    `InvoiceScannerService.revalidateInvoice`;
 *  - errores DETERMINISTAS (respuesta ilegible / incompleta) => UnrecoverableError
 *    (sin reintentos); un fallo de la IA/S3 se relanza para que BullMQ reintente.
 *  El CODIGO del error viaja a `failedReason` (el frontend lo traduce).
 */
@Processor('invoice-revalidate')
export class InvoiceRevalidateProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceRevalidateProcessor.name);

  constructor(
    private readonly invoiceScanner: InvoiceScannerService,
    private readonly s3Service: S3Service,
    private readonly monitor: AiJobMonitorService,
  ) {
    super();
  }

  async process(
    job: Job<InvoiceRevalidateJob>,
  ): Promise<InvoiceRevalidateResult> {
    const data = job.data;
    const requestId = data.request_id ?? `queue-${randomUUID()}`;

    this.logger.log(
      `[InvoiceRevalidate] job=${job.id} starting (store=${data.store_id ?? '?'}, org=${data.organization_id ?? '?'})`,
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
              `[InvoiceRevalidate] job=${job.id} S3 download failed: ${err?.message ?? err}`,
            );
            throw new Error(
              'No se pudo leer el documento original guardado. Intenta de nuevo.',
            );
          }
          return this.monitor.runAiWork(
            job,
            LEGACY_AI_SOURCES.invoiceRevalidate,
            () =>
              this.invoiceScanner.revalidateInvoice({
                fileBuffer: buffer,
                mimeType: mimeFromKey(data.scan_attachment_key, buffer),
                consolidated: data.consolidated,
                note: data.note,
                orderType: data.order_type,
              }),
          );
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[InvoiceRevalidate] job=${job.id} failed: ${error?.message ?? error}`,
      );
      // `failedReason` carries the Vendix error CODE (QUI-1020).
      throw toAiJobFailure(error);
    }
  }

  /** QUI-1020: a final, non-document failure alerts Vendix once. */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<InvoiceRevalidateJob> | undefined): Promise<void> {
    if (!job) return;
    await this.monitor.onFailed(
      job,
      LEGACY_AI_SOURCES.invoiceRevalidate,
      job.data,
    );
  }
}
