import { Injectable } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import type {
  BulkJobPageResult,
  BulkJobType,
  BulkUploadJobData,
  BulkUploadJobHandler,
} from '../../bulk-uploads/bulk-upload-job.types';
import { toBulkJobPage } from '../../bulk-uploads/bulk-upload-job.util';
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

  async assertSessionExists(sessionId: string): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    const key = `tmp/bulk-employees/${storeId}/${sessionId}.xlsx`;
    if (!(await this.s3.objectExists(key))) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }
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
