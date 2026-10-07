import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../core/services/ai-scan-job.service';
import { ApiResponse, InventoryCountScanResponse } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class InventoryScannerService {
  private readonly base_url = `${environment.apiUrl}/store/inventory`;
  private readonly aiScanJobs = inject(AiScanJobService);

  /**
   * Upload a photo/PDF of a physical count sheet for AI-assisted OCR scanning.
   * The backend extracts counted items and matches them against products in
   * `location_id`, returning suggested adjustments the operator confirms in
   * the wizard modal (batchCreateAndComplete on InventoryService — Sección 7/8).
   *
   * Encola en `adjustments/scan/async` y sondea el job; el `result` se adapta
   * a `{ success, data }`. Los errores se propagan sin envolver (Error o
   * HttpErrorResponse): el consumidor aplica `parseApiError`.
   */
  scanCount(
    file: File,
    locationId: number,
    opts?: AiScanJobOptions,
  ): Observable<ApiResponse<InventoryCountScanResponse>> {
    const fd = new FormData();
    fd.append('file', file);
    return this.aiScanJobs
      .enqueueAndWait<InventoryCountScanResponse>(
        `${this.base_url}/adjustments/scan/async?location_id=${locationId}`,
        fd,
        opts,
      )
      .pipe(map((result) => ({ success: true, data: result })));
  }
}
