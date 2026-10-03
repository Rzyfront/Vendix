import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, throwError, timer } from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  finalize,
  map,
  retry,
  switchMap,
  take,
  takeUntil,
  takeWhile,
  timeout,
} from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  ConfirmScannedInvoiceDto,
  InvoiceRevalidateJobStatus,
  InvoiceScanJobStatus,
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

  /** Intervalo entre polls del job de escaneo (ms). */
  static readonly SCAN_POLL_INTERVAL_MS = 2500;
  /** Tope de todo el ciclo encolar → poll del escaneo (ms). La IA tarda hasta ~8 min. */
  static readonly SCAN_TIMEOUT_MS = 600_000;
  /** Tras este tiempo sin estado terminal se avisa al usuario (ms). */
  static readonly SCAN_STALL_NOTICE_MS = 60_000;

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
          // exhaustMap: si un GET sigue en vuelo cuando llega el siguiente tick,
          // el tick se descarta (switchMap cancelaba el GET lento y podía no
          // completar nunca con red lenta). Un fallo transitorio se reintenta
          // 2 veces (1 s); un 404 (job evictado) es definitivo y no se reintenta.
          exhaustMap(() =>
            this.getRevalidateStatus(jobId).pipe(
              retry({
                count: 2,
                delay: (err: unknown) =>
                  err instanceof HttpErrorResponse && err.status === 404
                    ? throwError(() => err)
                    : timer(1000),
              }),
            ),
          ),
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

  /** Encola el escaneo async. 202 con `job_id` dentro del envelope. */
  enqueueScan(
    file: File,
    orderType: 'retail' | 'ingredient' = 'retail',
  ): Observable<string> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ApiResponse<{ job_id: string }>>(
        `${this.apiUrl}/scan/async?orderType=${orderType}`,
        formData,
      )
      .pipe(
        map((response) => {
          const jobId = response?.data?.job_id;
          if (!response?.success || !jobId) {
            throw new Error(
              response?.message || 'No se pudo encolar el escaneo',
            );
          }
          return jobId;
        }),
      );
  }

  /** Estado del job de escaneo. OJO: este GET NO viene envuelto. */
  getScanStatus(jobId: string): Observable<InvoiceScanJobStatus> {
    return this.http.get<InvoiceScanJobStatus>(
      `${this.apiUrl}/scan/async/${jobId}`,
    );
  }

  /**
   * Encola y hace polling hasta completed/failed; emite UNA vez el resultado.
   * `onStall` se invoca una sola vez si pasan SCAN_STALL_NOTICE_MS sin estado
   * terminal.
   */
  scanInvoiceAndWait(
    file: File,
    orderType: 'retail' | 'ingredient' = 'retail',
    opts?: { onStall?: () => void },
  ): Observable<InvoiceScanResult> {
    return this.enqueueScan(file, orderType).pipe(
      switchMap((jobId) => {
        const done$ = new Subject<void>();
        if (opts?.onStall) {
          const onStall = opts.onStall;
          timer(InvoiceScannerService.SCAN_STALL_NOTICE_MS)
            .pipe(takeUntil(done$))
            .subscribe(() => onStall());
        }
        return timer(0, InvoiceScannerService.SCAN_POLL_INTERVAL_MS).pipe(
          exhaustMap(() =>
            this.getScanStatus(jobId).pipe(
              retry({
                count: 2,
                delay: (err: unknown) =>
                  err instanceof HttpErrorResponse && err.status === 404
                    ? throwError(() => err)
                    : timer(1000),
              }),
            ),
          ),
          takeWhile(
            (s) => s.status !== 'completed' && s.status !== 'failed',
            true,
          ),
          filter((s) => s.status === 'completed' || s.status === 'failed'),
          map((s) => {
            if (s.status === 'failed') {
              throw new Error(s.error || 'El escaneo falló');
            }
            if (!s.result) {
              throw new Error('El escaneo finalizó sin resultado');
            }
            return s.result;
          }),
          finalize(() => done$.next()),
        );
      }),
      timeout({
        first: InvoiceScannerService.SCAN_TIMEOUT_MS,
        with: () =>
          throwError(
            () =>
              new Error('El escaneo tardó demasiado. Intenta nuevamente.'),
          ),
      }),
      take(1),
      catchError((err: unknown) =>
        throwError(() => this.normalizeScanError(err)),
      ),
    );
  }

  private normalizeScanError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return new Error(
          'El escaneo ya no está disponible. Vuelve a intentarlo.',
        );
      }
      const body = err.error as { message?: string } | null;
      return new Error(
        body?.message || err.message || 'Error al escanear la factura',
      );
    }
    if (err instanceof Error) return err;
    return new Error('Error al escanear la factura');
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
