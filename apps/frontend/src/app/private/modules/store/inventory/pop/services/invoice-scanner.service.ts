import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  ConfirmScannedInvoiceDto,
} from '../interfaces/invoice-scanner.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class InvoiceScannerService {
  private readonly apiUrl = `${environment.apiUrl}/store/orders/purchase-orders`;

  /**
   * Tope de todo el ciclo encolar → poll de la revalidación (ms). Debe superar
   * el presupuesto de reintentos del backend (la IA relee el documento
   * completo). El poll en sí vive en `AiScanJobService` (QUI-1020).
   */
  static readonly REVALIDATE_TIMEOUT_MS = 180_000;
  /** Tope de todo el ciclo encolar → poll del escaneo (ms). La IA tarda hasta ~8 min. */
  static readonly SCAN_TIMEOUT_MS = 600_000;

  constructor(private http: HttpClient) {}

  /**
   * Upload an invoice image/PDF for OCR scanning.
   *
   * Fase 4: `orderType` selects the backend AI app profile.
   *   - `retail` (default) → `invoice_ocr`
   *   - `ingredient` → `invoice_ocr_ingredient` (also extracts
   *     presentation / pack_size / uom_hint)
   *
   * Mixed-line orders are out of scope; the caller picks one profile
   * per scan.
   *
   * @deprecated Usar scanInvoiceAndWait (el síncrono muere en 504 tras 60 s de proxy).
   */
  scanInvoice(
    file: File,
    orderType: 'retail' | 'ingredient' = 'retail',
  ): Observable<ApiResponse<InvoiceScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ApiResponse<InvoiceScanResult>>(
      `${this.apiUrl}/scan?orderType=${orderType}`,
      formData,
    );
  }

  /**
   * Match extracted line items against existing products
   */
  matchProducts(
    scanResult: InvoiceScanResult,
  ): Observable<ApiResponse<InvoiceMatchResult>> {
    return this.http.post<ApiResponse<InvoiceMatchResult>>(
      `${this.apiUrl}/scan/match`,
      scanResult,
    );
  }

  /**
   * Confirm scanned invoice and create a purchase order
   */
  confirmAndCreate(
    data: ConfirmScannedInvoiceDto,
    file?: File,
  ): Observable<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(data));
    if (file) {
      formData.append('file', file);
    }
    return this.http.post<ApiResponse<any>>(
      `${this.apiUrl}/scan/confirm`,
      formData,
    );
  }

  // ===== Colas de IA (QUI-1020): la espera la hace `AiScanJobService` =====

  /** Encola el escaneo async (202 con `job_id`). */
  scanEnqueueUrl(orderType: 'retail' | 'ingredient' = 'retail'): string {
    return `${this.apiUrl}/scan/async?orderType=${orderType}`;
  }

  /** Estado del job de escaneo (GET sin envelope). */
  scanStatusUrl(jobId: string): string {
    return `${this.apiUrl}/scan/async/${jobId}`;
  }

  /** QUI-855 paso 8b: encola la revalidación con IA (202 con `job_id`). */
  revalidateEnqueueUrl(): string {
    return `${this.apiUrl}/scan/revalidate`;
  }

  /** Estado del job de revalidación (GET sin envelope). */
  revalidateStatusUrl(jobId: string): string {
    return `${this.apiUrl}/scan/revalidate/${jobId}`;
  }

  /** FormData del escaneo: el archivo va en el campo `file`. */
  scanFormData(file: File): FormData {
    const formData = new FormData();
    formData.append('file', file);
    return formData;
  }
}
