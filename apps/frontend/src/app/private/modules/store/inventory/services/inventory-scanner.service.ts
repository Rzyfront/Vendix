import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
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

  // Un solo traductor de errores para toda la app: `extractApiErrorMessage`
  // resuelve el `error_code` tipado contra ERROR_MESSAGES y sólo cae a los
  // genéricos por status si no hay código. La versión previa mostraba el
  // `message` del backend —el mensaje de DESARROLLO, en inglés— directo al
  // usuario, que es justo lo que parse-api-error prohíbe.
  private handleError(error: any): Observable<never> {
      console.error('InventoryScannerService Error:', error);
      return throwError(() => extractApiErrorMessage(error));
  }
}
