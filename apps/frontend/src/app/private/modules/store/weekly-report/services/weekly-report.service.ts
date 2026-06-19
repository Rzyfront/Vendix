import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, tap, catchError } from 'rxjs';
import { shareReplay, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  WeeklyReportResponse,
  WeeklyReportSnapshot,
} from '../interfaces/weekly-report.interface';

/**
 * Servicio frontend para el "Wrapped" semanal de Vendix.
 *
 * - Expone el último reporte como signal (zoneless-friendly).
 * - Cachea por TTL corto en memoria; el snapshot persistido en backend
 *   es la fuente de verdad, así que no hace falta refetch agresivo.
 * - Permite marcar el reporte como visto.
 *
 * Patrón alineado con `DispatchNotesService` (Observable + map data).
 * Solo este servicio añade la capa de signals para los componentes
 * que ya no usan NgRx/Subscriptions.
 */
@Injectable({
  providedIn: 'root',
})
export class WeeklyReportService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 min

  // ─── Reactive state (Angular 20 signals) ─────────────────────────────────
  private readonly _latest = signal<WeeklyReportSnapshot | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _lastFetchedAt = signal<number>(0);

  readonly latestReport = this._latest.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** Computed: ¿hay un reporte sin ver? */
  readonly hasUnviewedReport = computed<boolean>(() => {
    const report = this._latest();
    return !!report && !report.viewed_at;
  });

  /** Computed: ¿hay reporte disponible para mostrar? */
  readonly hasReport = computed<boolean>(() => this._latest() !== null);

  // ─── Cached observable (para consumidores legacy) ────────────────────────
  private latestCache$: Observable<WeeklyReportSnapshot | null> | null = null;

  /**
   * Carga el último reporte del store autenticado.
   * Si el TTL no expiró, retorna el cache.
   */
  getLatest(force = false): Observable<WeeklyReportSnapshot | null> {
    const now = Date.now();
    if (
      !force &&
      this.latestCache$ &&
      now - this._lastFetchedAt() < this.CACHE_TTL
    ) {
      return this.latestCache$;
    }

    this._loading.set(true);
    this._error.set(null);

    const url = `${this.apiUrl}/store/weekly-report/latest`;
    const request$ = this.http.get<WeeklyReportResponse>(url).pipe(
      tap((response) => {
        this._latest.set(response?.data ?? null);
        this._lastFetchedAt.set(Date.now());
        this._loading.set(false);
      }),
      catchError((err) => {
        this._loading.set(false);
        this._error.set(
          err?.error?.message || 'No se pudo cargar el reporte semanal',
        );
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    const mapped$ = request$.pipe(
      map((r: WeeklyReportResponse | null) => r?.data ?? null),
    );
    this.latestCache$ = mapped$;
    return mapped$;
  }

  /**
   * Refresca el cache forzando una nueva petición.
   */
  refresh(): Observable<WeeklyReportSnapshot | null> {
    return this.getLatest(true);
  }

  /**
   * Marca el reporte como visto. Devuelve el snapshot actualizado.
   */
  markViewed(id: number): Observable<WeeklyReportSnapshot | null> {
    const url = `${this.apiUrl}/store/weekly-report/${id}/viewed`;
    return this.http.post<WeeklyReportResponse>(url, {}).pipe(
      tap((response) => {
        if (response?.data) {
          this._latest.set(response.data);
        }
      }),
      map((response: WeeklyReportResponse) => response?.data ?? null),
      catchError((err) => {
        this._error.set(
          err?.error?.message || 'No se pudo marcar el reporte como visto',
        );
        return throwError(() => err);
      }),
    );
  }

  /**
   * Limpia el estado en memoria (logout).
   */
  clearCache(): void {
    this._latest.set(null);
    this._error.set(null);
    this._lastFetchedAt.set(0);
    this.latestCache$ = null;
  }
}
