import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import type {
  BulkJobPageResult,
  BulkJobType,
  BulkUploadJobData,
  BulkUploadJobHandler,
} from '../bulk-uploads/bulk-upload-job.types';
import { toBulkJobPage } from '../bulk-uploads/bulk-upload-job.util';
import { ProductsBulkService } from './products-bulk.service';

/**
 * QUI-1009 — handler de la carga masiva de productos para el trabajo durable.
 * Idempotente por fila (SKU), por eso admite reintento automático por lote.
 * El archivo de S3 se conserva hasta que el trabajo termina (`keepSessionFile`).
 */
@Injectable()
export class ProductsBulkJobHandler implements BulkUploadJobHandler {
  readonly type: BulkJobType = 'products';
  readonly autoRetry = true;

  constructor(
    private readonly bulk: ProductsBulkService,
    private readonly s3: S3Service,
  ) {}

  /** 400 con el código existente si la sesión de análisis ya venció. */
  async assertSessionExists(sessionId: string): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    const key = `tmp/bulk-products/${storeId}/${sessionId}.xlsx`;
    if (!(await this.s3.objectExists(key))) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }
  }

  async runPage(
    data: BulkUploadJobData,
    offset: number,
    limit: number,
  ): Promise<BulkJobPageResult> {
    const result = await this.bulk.uploadProductsFromSession(
      String(data.params.session_id),
      data.store_id,
      data.user,
      { offset, limit },
      {
        initialLoadAck: data.params.initial_load_ack === true,
        keepSessionFile: true,
      },
    );
    return toBulkJobPage(result, 'create');
  }

  async cleanup(data: BulkUploadJobData): Promise<void> {
    await this.bulk.cancelSession(String(data.params.session_id), data.store_id);
  }
}
