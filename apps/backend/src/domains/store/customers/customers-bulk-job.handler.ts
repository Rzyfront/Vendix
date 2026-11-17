import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service, isS3NotFoundError } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  BULK_JOB_BATCH_SIZE,
  type BulkJobPageResult,
  type BulkJobType,
  type BulkUploadJobData,
  type BulkUploadJobHandler,
} from '../bulk-uploads/bulk-upload-job.types';
import { toBulkJobPage } from '../bulk-uploads/bulk-upload-job.util';
import { CustomersBulkService } from './customers-bulk.service';
import type { BulkCustomerItemDto } from './dto/bulk-customer.dto';

/** Archivos descargados que se conservan en memoria (una entrada por trabajo en curso). */
const CACHE_MAX_ENTRIES = 4;

/**
 * QUI-1009 — handler de la carga masiva de clientes. NO se reintenta solo
 * (`autoRetry = false`): un lote a medias pudo crear clientes. Las filas viajan
 * al encolar y se guardan en S3 `tmp/bulk-customers/{store_id}/{uuid}.json`; el
 * trabajo descarga el archivo una vez y procesa de a 100.
 */
@Injectable()
export class CustomersBulkJobHandler implements BulkUploadJobHandler {
  readonly type: BulkJobType = 'customers';
  readonly autoRetry = false;

  private readonly cache = new Map<string, BulkCustomerItemDto[]>();

  constructor(
    private readonly bulk: CustomersBulkService,
    private readonly s3: S3Service,
  ) {}

  /** Guarda las filas y devuelve la clave de S3 del trabajo. */
  async stageRows(rows: BulkCustomerItemDto[]): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    const key = `tmp/bulk-customers/${storeId}/${randomUUID()}.json`;
    await this.s3.uploadFile(
      Buffer.from(JSON.stringify(rows)),
      key,
      'application/json',
    );
    return key;
  }

  async discardStaged(key: string): Promise<void> {
    try {
      await this.s3.deleteFile(key);
    } catch {
      // El archivo temporal puede no existir.
    }
  }

  async runPage(
    data: BulkUploadJobData,
    offset: number,
    limit: number,
  ): Promise<BulkJobPageResult> {
    const key = String(data.params.s3_key);
    const rows = await this.loadRows(key);
    const slice = rows.slice(offset, offset + limit);
    const result = await this.bulk.uploadCustomers({ customers: slice });
    return {
      ...toBulkJobPage(result),
      total: rows.length,
      done: offset + (limit || BULK_JOB_BATCH_SIZE) >= rows.length,
    };
  }

  async cleanup(data: BulkUploadJobData): Promise<void> {
    const key = String(data.params.s3_key);
    this.cache.delete(key);
    await this.discardStaged(key);
  }

  /** Una descarga por ejecución del trabajo; archivo ausente = dato vencido (400), fallo de S3 = técnico. */
  private async loadRows(key: string): Promise<BulkCustomerItemDto[]> {
    const cached = this.cache.get(key);
    if (cached) return cached;
    let buffer: Buffer;
    try {
      buffer = await this.s3.downloadFile(key);
    } catch (error) {
      // Solo «no existe» es dato vencido; cualquier otro fallo de S3 es técnico.
      if (isS3NotFoundError(error)) {
        throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
      }
      throw error;
    }
    const rows: BulkCustomerItemDto[] = JSON.parse(buffer.toString('utf-8'));
    this.cache.set(key, rows);
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value as string);
    }
    return rows;
  }
}
