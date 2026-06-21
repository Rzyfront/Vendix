import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

/**
 * Snapshot devuelto por el backend al generar el reporte semanal de una
 * tienda. Se tipa como `unknown` salvo el id porque la UI solo necesita
 * distinguir "se generó" (objeto) de "no se generó" (null); la forma
 * completa la posee el dominio store/weekly-report del backend.
 */
export interface WeeklyReportRunResult {
  id?: number;
  [key: string]: unknown;
}

/** Contadores devueltos por el batch run-all. */
export interface WeeklyReportBatchResult {
  generated: number;
  skipped: number;
}

/** Envoltura estándar `ResponseService.created`. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

/**
 * Servicio del super-admin para disparar manualmente la generación del
 * reporte semanal de una tienda o de todas las tiendas activas.
 *
 * IMPORTANTE: cada generación exitosa emite una notificación `weekly_report`
 * (SSE + push) al dueño de la tienda, por lo que el consumidor DEBE confirmar
 * con el usuario antes de invocar estos métodos.
 */
@Injectable({
  providedIn: 'root',
})
export class SuperAdminWeeklyReportService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  // Estado reactivo (signals, zoneless)
  readonly isRunningForStore = signal(false);
  readonly isRunningForAll = signal(false);
  readonly lastError = signal<string | null>(null);

  /**
   * Genera (idempotente) el reporte semanal de una tienda y emite la
   * notificación `weekly_report` al dueño. `data` es null si la tienda está
   * inactiva o no existe.
   */
  runForStore(
    storeId: number,
  ): Observable<ApiResponse<WeeklyReportRunResult | null>> {
    this.isRunningForStore.set(true);
    this.lastError.set(null);
    return this.http
      .post<ApiResponse<WeeklyReportRunResult | null>>(
        `${this.apiUrl}/superadmin/weekly-report/stores/${storeId}/run`,
        {},
      )
      .pipe(finalize(() => this.isRunningForStore.set(false)));
  }

  /**
   * Genera el reporte semanal para todas las tiendas activas. Devuelve los
   * contadores `generated` / `skipped`.
   */
  runForAll(): Observable<ApiResponse<WeeklyReportBatchResult>> {
    this.isRunningForAll.set(true);
    this.lastError.set(null);
    return this.http
      .post<ApiResponse<WeeklyReportBatchResult>>(
        `${this.apiUrl}/superadmin/weekly-report/run-all`,
        {},
      )
      .pipe(finalize(() => this.isRunningForAll.set(false)));
  }
}
