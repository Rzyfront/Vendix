import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import {
  catchError,
  filter,
  map,
  switchMap,
  take,
  takeWhile,
  timeout,
} from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  ConfirmScannedInvoiceDto,
  InvoiceRevalidateJobStatus,
  InvoiceRevalidateRequest,
  InvoiceRevalidateResult,
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

  /** Intervalo entre polls del job de revalidación (ms). */
  static readonly REVALIDATE_POLL_INTERVAL_MS = 2000;
  /**
   * Tope de todo el ciclo encolar → poll (ms). Debe superar el presupuesto de
   * reintentos del backend (la IA relee el documento completo).
   */
  static readonly REVALIDATE_TIMEOUT_MS = 180_000;

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

  /**
   * QUI-855 paso 8b — encola la revalidación con IA. 202 con el `job_id`
   * dentro del envelope de ResponseService (`response.data.job_id`).
   */
  revalidate(body: InvoiceRevalidateRequest): Observable<string> {
    return this.http
      .post<ApiResponse<{ job_id: string }>>(`${this.apiUrl}/scan/revalidate`, body)
      .pipe(
        map((response) => {
          const jobId = response?.data?.job_id;
          if (!response?.success || !jobId) {
            throw new Error(
              response?.message || 'No se pudo encolar la revalidación',
            );
          }
          return jobId;
        }),
      );
  }

  /** Estado del job. OJO: este GET NO viene envuelto (`{ status, result?, error? }`). */
  getRevalidateStatus(jobId: string): Observable<InvoiceRevalidateJobStatus> {
    return this.http.get<InvoiceRevalidateJobStatus>(
      `${this.apiUrl}/scan/revalidate/${jobId}`,
    );
  }

  /**
   * Encola y hace polling hasta completed/failed; emite UNA vez el resultado.
   * Error en español si el job falla, si se agota el tiempo o si el job ya no
   * existe (404 por evicción).
   */
  revalidateAndWait(
    body: InvoiceRevalidateRequest,
  ): Observable<InvoiceRevalidateResult> {
    return this.revalidate(body).pipe(
      switchMap((jobId) =>
        timer(0, InvoiceScannerService.REVALIDATE_POLL_INTERVAL_MS).pipe(
          switchMap(() => this.getRevalidateStatus(jobId)),
          takeWhile(
            (s) => s.status !== 'completed' && s.status !== 'failed',
            true,
          ),
          filter((s) => s.status === 'completed' || s.status === 'failed'),
          map((s) => {
            if (s.status === 'failed') {
              throw new Error(s.error || 'La revalidación falló');
            }
            if (!s.result) {
              throw new Error('La revalidación finalizó sin resultado');
            }
            return s.result;
          }),
        ),
      ),
      timeout({
        first: InvoiceScannerService.REVALIDATE_TIMEOUT_MS,
        with: () =>
          throwError(
            () =>
              new Error(
                'La revalidación tardó demasiado. Intenta nuevamente.',
              ),
          ),
      }),
      take(1),
      catchError((err: unknown) =>
        throwError(() => this.normalizeRevalidateError(err)),
      ),
    );
  }

  private normalizeRevalidateError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return new Error(
          'La revalidación ya no está disponible. Vuelve a intentarlo.',
        );
      }
      const body = err.error as { message?: string } | null;
      return new Error(
        body?.message || err.message || 'Error al revalidar la factura',
      );
    }
    if (err instanceof Error) return err;
    return new Error('Error al revalidar la factura');
  }
}
