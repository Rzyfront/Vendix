import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CloseDispatchRouteDto,
  CreateDispatchRouteDto,
  DispatchRoute,
  DispatchRouteQuery,
  DispatchRouteStats,
  PaginatedDispatchRoutesResponse,
  ReleaseStopDto,
  SettleStopDto,
  VoidDispatchRouteDto,
} from '../interfaces/planilla.interface';

let statsCache$: Observable<DispatchRouteStats> | null = null;
let statsCacheTime = 0;
const CACHE_TTL = 30_000;

@Injectable({ providedIn: 'root' })
export class PlanillasRutasService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  list(query: DispatchRouteQuery = {}): Observable<PaginatedDispatchRoutesResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    });
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes?${params.toString()}`)
      .pipe(
        map((r) => r.data as PaginatedDispatchRoutesResponse),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  getOne(id: number): Observable<DispatchRoute> {
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/${id}`)
      .pipe(
        map((r) => r.data as DispatchRoute),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  getStats(): Observable<DispatchRouteStats> {
    const now = Date.now();
    if (statsCache$ && now - statsCacheTime < CACHE_TTL) {
      return statsCache$;
    }
    statsCache$ = this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/stats`)
      .pipe(
        map((r) => r.data as DispatchRouteStats),
        shareReplay({ bufferSize: 1, refCount: false }),
        tap(() => (statsCacheTime = Date.now())),
      );
    return statsCache$;
  }

  invalidateStatsCache() {
    statsCache$ = null;
    statsCacheTime = 0;
  }

  create(dto: CreateDispatchRouteDto): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes`, dto)
      .pipe(
        map((r) => r.data as DispatchRoute),
        tap(() => this.invalidateStatsCache()),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  dispatch(id: number): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes/${id}/dispatch`, {})
      .pipe(
        map((r) => r.data as DispatchRoute),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  settleStop(id: number, stopId: number, dto: SettleStopDto): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${id}/stops/${stopId}/settle`,
        dto,
      )
      .pipe(
        map((r) => r.data),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  startStop(id: number, stopId: number): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${id}/stops/${stopId}/start`,
        {},
      )
      .pipe(
        map((r) => r.data),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  releaseStop(id: number, stopId: number, dto: ReleaseStopDto): Observable<any> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${id}/stops/${stopId}/release`,
        dto,
      )
      .pipe(
        map((r) => r.data),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  close(id: number, dto: CloseDispatchRouteDto): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes/${id}/close`, dto)
      .pipe(
        map((r) => r.data as DispatchRoute),
        tap(() => this.invalidateStatsCache()),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  void(id: number, dto: VoidDispatchRouteDto): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes/${id}/void`, dto)
      .pipe(
        map((r) => r.data as DispatchRoute),
        tap(() => this.invalidateStatsCache()),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  getPdfBlob(id: number): Observable<Blob> {
    return this.http
      .post(`${this.apiUrl}/store/dispatch-routes/${id}/pdf`, {}, {
        responseType: 'blob',
      })
      .pipe(
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  // Vehicles
  listVehicles(query: { search?: string; is_active?: boolean } = {}): Observable<{ data: any[]; pagination: any }> {
    const params = new URLSearchParams();
    if (query.search) params.append('search', query.search);
    if (query.is_active !== undefined) params.append('is_active', String(query.is_active));
    return this.http
      .get<any>(`${this.apiUrl}/store/vehicles?${params.toString()}`)
      .pipe(map((r) => r.data));
  }

  createVehicle(dto: any): Observable<any> {
    return this.http
      .post<any>(`${this.apiUrl}/store/vehicles`, dto)
      .pipe(map((r) => r.data));
  }

  // Dispatch notes (for wizard)
  listAvailableDispatchNotes(): Observable<{ data: any[]; pagination: any }> {
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-notes?limit=100&status=confirmed`)
      .pipe(map((r) => r.data));
  }

  private extractMessage(error: any): string {
    return (
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      'Error desconocido'
    );
  }
}
