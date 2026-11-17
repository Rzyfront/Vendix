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
import { InventoryAdjustmentsBulkService } from './inventory-adjustments-bulk.service';
import type { BulkAdjustmentUploadDto } from './dto/bulk-adjustment-upload.dto';

/**
 * QUI-1009 — handler de los ajustes masivos de inventario. Re-ejecutar una
 * página es seguro: `processRows` recibe el `session_id` y devuelve los
 * recibos ya confirmados. El servicio nunca borra el archivo al terminar y lee
 * tienda y usuario del contexto (el procesador los restaura).
 */
@Injectable()
export class InventoryAdjustmentsBulkJobHandler implements BulkUploadJobHandler {
  readonly type: BulkJobType = 'inventory_adjustments';
  readonly autoRetry = true;

  constructor(
    private readonly bulk: InventoryAdjustmentsBulkService,
    private readonly s3: S3Service,
  ) {}

  async assertSessionExists(sessionId: string): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    const key = `tmp/bulk-adjustments/${storeId}/${sessionId}.xlsx`;
    if (!(await this.s3.objectExists(key))) {
      throw new VendixHttpException(ErrorCodes.BULK_PROD_SESSION_EXPIRED);
    }
  }

  async runPage(
    data: BulkUploadJobData,
    offset: number,
    limit: number,
  ): Promise<BulkJobPageResult> {
    const p = data.params;
    const result = await this.bulk.uploadFromSession(
      String(p.session_id),
      {
        location_id: Number(p.location_id),
        adjustment_type: p.adjustment_type as string | undefined,
        description: p.description as string | undefined,
        initial_load_ack: p.initial_load_ack === true,
      } as BulkAdjustmentUploadDto & { initial_load_ack?: boolean },
      { offset, limit },
    );
    return toBulkJobPage(result, 'created');
  }

  async cleanup(data: BulkUploadJobData): Promise<void> {
    await this.bulk.cancelSession(String(data.params.session_id));
  }
}
