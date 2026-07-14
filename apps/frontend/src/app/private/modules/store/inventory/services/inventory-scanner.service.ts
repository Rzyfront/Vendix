import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse, InventoryCountScanResponse } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class InventoryScannerService {
  private readonly base_url = `${environment.apiUrl}/store/inventory`;

  constructor(private http: HttpClient) {}

  /**
   * Upload a photo/PDF of a physical count sheet for AI-assisted OCR scanning.
   * The backend extracts counted items and matches them against products in
   * `location_id`, returning suggested adjustments the operator confirms in
   * the wizard modal (batchCreateAndComplete on InventoryService — Sección 7/8).
   */
  scanCount(
    file: File,
    locationId: number,
  ): Observable<ApiResponse<InventoryCountScanResponse>> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http
      .post<
        ApiResponse<InventoryCountScanResponse>
      >(`${this.base_url}/adjustments/scan?location_id=${locationId}`, fd)
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('InventoryScannerService Error:', error);
    let error_message = 'An error occurred';

    if (error.error?.message) {
      error_message = error.error.message;
    } else if (error.status === 400) {
      error_message = 'Invalid data provided';
    } else if (error.status === 401) {
      error_message = 'Unauthorized access';
    } else if (error.status === 403) {
      error_message = 'Insufficient permissions';
    } else if (error.status === 404) {
      error_message = 'Resource not found';
    } else if (error.status >= 500) {
      error_message = 'Server error. Please try again later';
    }

    return throwError(() => error_message);
  }
}
