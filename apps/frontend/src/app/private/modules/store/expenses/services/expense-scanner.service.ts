import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, filter, map, switchMap, take, takeWhile, timeout } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/expense.interface';
import { ExpenseScanResponse } from '../interfaces/expense-scanner.interface';

/**
 * Estados del job de escaneo expuestos por el backend (espejo de
 * `ExpenseScanJobState` en el dominio store/expenses).
 */
export type ExpenseScanJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

/**
 * Forma de `data` del polling `GET store/expenses/scan/:jobId`.
 * `result` solo viene con `status === 'completed'`; `error` con `status === 'failed'`.
 */
export interface ExpenseScanJobStatus {
  status: ExpenseScanJobState;
  result?: ExpenseScanResponse;
  error?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ExpenseScannerService {
  private http = inject(HttpClient);

  /** Intervalo entre polls de estado del job (ms). */
  private readonly POLL_INTERVAL_MS = 1800;
  /**
   * Timeout de guarda para todo el ciclo enqueue → poll (ms). Debe SUPERAR el
   * presupuesto de reintentos del backend (`attempts: 3` + backoff exponencial
   * 2s/4s): con OCR lento (~15-20s por intento) el peor caso supera 60s, así que
   * un guard corto cortaría un job que sí terminaría. 120s cubre los 3 intentos
   * con holgura y es coherente con el staleness de 1-2 min del diseño.
   */
  private readonly SCAN_TIMEOUT_MS = 120_000;

  /**
   * Encola el escaneo asíncrono de la factura. El backend responde 202 con el
   * `job_id` dentro del envelope de `ResponseService` (`response.data.job_id`).
   */
  enqueueScan(file: File): Observable<string> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http
      .post<ApiResponse<{ job_id: string }>>(
        `${environment.apiUrl}/store/expenses/scan`,
        fd,
      )
      .pipe(
        map(response => {
          const jobId = response?.data?.job_id;
          if (!response?.success || !jobId) {
            throw new Error(
              response?.message || 'No se pudo encolar el escaneo de la factura',
            );
          }
          return jobId;
        }),
      );
  }

  /**
   * Consulta el estado del job. Lee `response.data` (envelope de ResponseService).
   */
  pollScanStatus(jobId: string): Observable<ExpenseScanJobStatus> {
    return this.http
      .get<ApiResponse<ExpenseScanJobStatus>>(
        `${environment.apiUrl}/store/expenses/scan/${jobId}`,
      )
      .pipe(map(response => response.data));
  }

  /**
   * Escanea una factura de gasto con IA de forma asíncrona: encola el job y
   * hace polling hasta que termina, emitiendo UNA sola vez el resultado final
   * (`ExpenseScanResponse` = `{ scan, matched_category }`, la misma forma que
   * antes devolvía el POST síncrono).
   *
   * - Emite el `result` cuando `status === 'completed'` y DETIENE el polling
   *   de inmediato (takeWhile inclusivo + take(1)) — así se evita la carrera de
   *   evicción del job (poll tardío tras completarse → 404).
   * - Lanza error cuando `status === 'failed'` (con el `error` del backend), en
   *   timeout de guarda, o ante un 404 tardío por evicción (tratado como error
   *   suave con mensaje claro, nunca como crash).
   */
  scanInvoiceAsync(file: File): Observable<ExpenseScanResponse> {
    return this.enqueueScan(file).pipe(
      switchMap(jobId =>
        timer(0, this.POLL_INTERVAL_MS).pipe(
          switchMap(() => this.pollScanStatus(jobId)),
          // Inclusivo: emite también el primer estado terminal y luego completa.
          takeWhile(
            status => status.status !== 'completed' && status.status !== 'failed',
            true,
          ),
          // Descarta los estados intermedios (waiting/active/delayed).
          filter(
            status => status.status === 'completed' || status.status === 'failed',
          ),
          map(status => {
            if (status.status === 'failed') {
              throw new Error(status.error || 'El escaneo de la factura falló');
            }
            if (!status.result) {
              throw new Error('El escaneo finalizó sin datos extraídos');
            }
            return status.result;
          }),
        ),
      ),
      // Guarda: si nunca termina, aborta con error en vez de pollear indefinidamente.
      timeout({
        first: this.SCAN_TIMEOUT_MS,
        with: () =>
          throwError(
            () =>
              new Error(
                'El escaneo de la factura tardó demasiado. Intenta nuevamente.',
              ),
          ),
      }),
      // El observable emite una sola vez; take(1) blinda y completa la cadena.
      take(1),
      catchError((err: unknown) => throwError(() => this.normalizeScanError(err))),
    );
  }

  /**
   * Normaliza cualquier fallo del ciclo de escaneo a un `Error` con mensaje
   * legible para el usuario. El 404 por evicción del job se trata como error
   * suave (el job ya no está en la cola), no como crash.
   */
  private normalizeScanError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return new Error(
          'El escaneo ya no está disponible. Vuelve a intentarlo.',
        );
      }
      const body = err.error as { message?: string } | null;
      return new Error(
        body?.message || err.message || 'Error al procesar la factura',
      );
    }
    if (err instanceof Error) return err;
    return new Error('Error al procesar la factura');
  }
}
