import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import type {
  BulkJobPageResult,
  BulkJobType,
  BulkUploadJobData,
  BulkUploadJobHandler,
} from '../bulk-uploads/bulk-upload-job.types';
import {
  assertBulkSessionFile,
  toBulkJobPage,
} from '../bulk-uploads/bulk-upload-job.util';
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

  /** Sesión vencida (no existe en S3) → error de datos; S3 caído → 503 técnico. */
  async assertSessionExists(sessionId: string): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    await assertBulkSessionFile(
      this.s3,
      `tmp/bulk-products/${storeId}/${sessionId}.xlsx`,
    );
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
    const page = toBulkJobPage(result, 'create');
    return { ...page, rows: page.rows.map(withProductIdentity) };
  }

  async cleanup(data: BulkUploadJobData): Promise<void> {
    await this.bulk.cancelSession(String(data.params.session_id), data.store_id);
  }
}

/**
 * Las filas de éxito traen el producto anidado (`product`), que el trabajo no
 * guarda: se copian su nombre y SKU a la fila para la tabla de resultados.
 */
function withProductIdentity(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const product = row.product as { name?: unknown; sku?: unknown } | null;
  const name = typeof product?.name === 'string' ? product.name : undefined;
  const sku = typeof product?.sku === 'string' ? product.sku : undefined;
  return {
    ...row,
    product_name: row.product_name ?? name,
    sku: row.sku ?? sku,
  };
}
