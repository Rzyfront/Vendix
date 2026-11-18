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
    if (opts?.resumeKey) rememberScanLocation(opts.resumeKey, locationId);
    return this.aiScanJobs
      .enqueueAndWait<InventoryCountScanResponse>(
        `${this.base_url}/adjustments/scan/async?location_id=${locationId}`,
        fd,
        opts,
      )
      .pipe(map((result) => ({ success: true, data: result })));
  }

  /**
   * Re-attaches to a count scan started before a reload (QUI-1020). The
   * location chosen at launch is remembered with the job because the review
   * step needs it to confirm; `null` when there is nothing to resume.
   */
  resumeScan(
    resumeKey: string,
    opts?: Parameters<AiScanJobService['resume']>[1],
  ): {
    locationId: number;
    result$: Observable<ApiResponse<InventoryCountScanResponse>>;
  } | null {
    const locationId = readScanLocation(resumeKey);
    if (!locationId) return null;
    const result$ = this.aiScanJobs.resume<InventoryCountScanResponse>(
      resumeKey,
      opts,
    );
    if (!result$) return null;
    return {
      locationId,
      result$: result$.pipe(map((result) => ({ success: true, data: result }))),
    };
  }
}

const LOCATION_KEY_PREFIX = 'vendix:inventory-count-scan-location:';

function rememberScanLocation(resumeKey: string, locationId: number): void {
  try {
    localStorage.setItem(LOCATION_KEY_PREFIX + resumeKey, String(locationId));
  } catch {
    // Without storage there is no resume, but the scan still works.
  }
}

function readScanLocation(resumeKey: string): number | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY_PREFIX + resumeKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}
