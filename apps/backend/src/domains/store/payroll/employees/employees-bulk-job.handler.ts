import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import type {
  BulkJobPageResult,
  BulkJobType,
  BulkUploadJobData,
  BulkUploadJobHandler,
} from '../../bulk-uploads/bulk-upload-job.types';
import {
  assertBulkSessionFile,
  toBulkJobPage,
} from '../../bulk-uploads/bulk-upload-job.util';
import { EmployeesBulkService } from './employees-bulk.service';

/**
 * QUI-1009 — handler de la carga masiva de empleados para el trabajo durable.
 * Idempotente por documento, por eso admite reintento automático por lote.
 */
@Injectable()
export class EmployeesBulkJobHandler implements BulkUploadJobHandler {
  readonly type: BulkJobType = 'employees';
  readonly autoRetry = true;

  constructor(
    private readonly bulk: EmployeesBulkService,
    private readonly s3: S3Service,
  ) {}

  /** Sesión vencida (no existe en S3) → error de datos; S3 caído → 503 técnico. */
  async assertSessionExists(sessionId: string): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    await assertBulkSessionFile(
      this.s3,
      `tmp/bulk-employees/${storeId}/${sessionId}.xlsx`,
    );
  }

  async runPage(
    data: BulkUploadJobData,
    offset: number,
    limit: number,
  ): Promise<BulkJobPageResult> {
    const result = await this.bulk.uploadFromSession(
      String(data.params.session_id),
      data.store_id,
      data.user,
      { offset, limit },
      { keepSessionFile: true },
    );
    return toBulkJobPage(result);
  }

  async cleanup(data: BulkUploadJobData): Promise<void> {
    await this.bulk.cancelSession(String(data.params.session_id), data.store_id);
  }
}
