import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { randomUUID } from 'crypto';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { mimeFromKey } from '../../domains/store/orders/purchase-orders/invoice-revalidate.processor';
import { AiScanHandlerRegistry } from './ai-scan-handler.registry';
import { AiScanFile, AiScanJob } from './interfaces/ai-scan-job.interface';

/**
 * Processor de la cola generica `ai-scan`. Despacha por `job.data.kind` al
 * handler registrado. El mecanismo VENDIX_PROCESS_ROLE (main.ts fuerza
 * autorun:false en api) aplica solo, sin cambios aqui.
 */
@Processor('ai-scan', { concurrency: 3 })
export class AiScanProcessor extends WorkerHost {
  private readonly logger = new Logger(AiScanProcessor.name);

  constructor(
    private readonly registry: AiScanHandlerRegistry,
    private readonly s3Service: S3Service,
  ) {
    super();
  }

  async process(job: Job<AiScanJob>): Promise<unknown> {
    const data = job.data;
    const handler = this.registry.get(data.kind);
    if (!handler) {
      this.logger.error(`[AiScan] job=${job.id} unknown kind=${data.kind}`);
      throw new UnrecoverableError('AI_SCAN_UNKNOWN_KIND');
    }

    const ctx = data.context;
    this.logger.log(
      `[AiScan] job=${job.id} kind=${data.kind} store=${ctx.store_id ?? '?'} org=${ctx.organization_id ?? '?'}`,
    );

    try {
      return await RequestContextService.run(
        {
          is_super_admin: !!ctx.is_super_admin,
          is_owner: false,
          store_id: ctx.store_id ?? undefined,
          organization_id: ctx.organization_id ?? undefined,
          user_id: ctx.user_id ?? undefined,
          request_id: ctx.request_id ?? `queue-${randomUUID()}`,
        },
        async () => {
          const files: AiScanFile[] = [];
          for (const key of data.file_keys ?? []) {
            let buffer: Buffer;
            try {
              buffer = await this.s3Service.downloadFile(key);
            } catch (err: any) {
              this.logger.error(
                `[AiScan] job=${job.id} S3 download failed: ${err?.message ?? err}`,
              );
              throw new Error(
                'No se pudo leer el documento guardado. Intenta de nuevo.',
              );
            }
            files.push({
              buffer,
              mimeType: mimeFromKey(key, buffer),
              originalName: key.split('/').pop() ?? key,
              size: buffer.length,
            });
          }
          return handler({
            files,
            params: data.params ?? {},
            context: ctx,
          });
        },
      );
    } catch (error: any) {
      this.logger.error(
        `[AiScan] job=${job.id} kind=${data.kind} failed: ${error?.message ?? error}`,
      );
      if (error instanceof VendixHttpException) {
        // `failedReason` llega al usuario: se propaga el CODIGO.
        if (error.getStatus() >= 400 && error.getStatus() < 500 && error.getStatus() !== 429) {
          throw new UnrecoverableError(error.errorCode);
        }
        throw new Error(error.errorCode); // reintentable
      }
      throw error;
    }
  }
}
