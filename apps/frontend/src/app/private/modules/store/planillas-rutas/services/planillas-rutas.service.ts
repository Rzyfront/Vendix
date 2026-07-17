import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  CloseDispatchRouteDto,
  ConfirmRouteSheetDto,
  ConfirmRouteSheetResult,
  CreateDispatchRouteDto,
  CreateStopDto,
  DispatchRoute,
  DispatchRouteQuery,
  DispatchRouteStats,
  DispatchRouteStop,
  MapStopsResponse,
  PaginatedDispatchRoutesResponse,
  PaginatedMonitorResponse,
  ReleaseStopDto,
  ReorderStopEntry,
  RouteSheetMatchResult,
  RouteSheetScanResult,
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

  /**
   * Fetches the shipping mini-P&L monitor slice (recaudo, freight revenue,
   * transport cost, freight margin and settlement status per route). Same
   * unwrap pattern as the other reads — `ResponseService` wraps the body as
   * `{ success, message, data: { data, pagination } }`, so we `map(r => r.data)`.
   * `GET /store/dispatch-routes/monitor` accepts only `page` / `limit`.
   */
  getMonitor(
    query: { page?: number; limit?: number } = {},
  ): Observable<PaginatedMonitorResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        params.append(k, String(v));
      }
    });
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/monitor?${params.toString()}`)
      .pipe(
        map((r) => r.data as PaginatedMonitorResponse),
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

  /**
   * Fetches the map payload for a route: origin + geolocated pending stops +
   * the pending stops that could not be located. Same unwrap pattern as the
   * other reads (`ResponseService` wraps the body as `{ success, message, data }`).
   * `GET /store/dispatch-routes/:id/map-stops`.
   */
  getMapStops(routeId: number): Observable<MapStopsResponse> {
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/${routeId}/map-stops`)
      .pipe(
        map((r) => r.data as MapStopsResponse),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  /**
   * Persists a new stop visiting order.
   * `PATCH /store/dispatch-routes/:id/stops/reorder` with body `{ order }`
   * where each entry is `{ stopId, sequence }` (sequence >= 1). Returns the
   * refreshed route. Backend errors: 404 (foreign route), 409
   * `DSP_ROUTE_NOT_EDITABLE_001` (status ∉ {draft,dispatched}), 400 (duplicate
   * or foreign stopId/sequence).
   */
  reorderStops(routeId: number, order: ReorderStopEntry[]): Observable<DispatchRoute> {
    return this.http
      .patch<any>(`${this.apiUrl}/store/dispatch-routes/${routeId}/stops/reorder`, { order })
      .pipe(
        map((r) => r.data as DispatchRoute),
        tap(() => this.invalidateStatsCache()),
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

  /**
   * Append stops (dispatch notes) to an existing route.
   * `POST /store/dispatch-routes/:id/stops`.
   * Used by the "Generar Remisión" wizard when assigning a freshly-created
   * dispatch note to an already-existing route. The backend de-duplicates and
   * appends to the tail of the stop sequence.
   */
  addStops(routeId: number, dto: { stops: CreateStopDto[] }): Observable<DispatchRouteStop[]> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes/${routeId}/stops`, dto)
      .pipe(
        map((r) => r.data as DispatchRouteStop[]),
        tap(() => this.invalidateStatsCache()),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  /**
   * Lightweight route list for the "Ruta existente" selector in the wizard.
   * Only routes that can still receive new stops are useful, i.e. `draft` and
   * `dispatched`. Pass a comma-separated `status` (default `'draft,dispatched'`).
   * Returns the flat array of routes (unwrapped pagination).
   */
  listRoutes(query: { status?: string } = {}): Observable<DispatchRoute[]> {
    const status = query.status ?? 'draft,dispatched';
    const params = new URLSearchParams();
    params.append('status', status);
    params.append('limit', '100');
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes?${params.toString()}`)
      .pipe(
        map((r) => {
          const payload = r.data as PaginatedDispatchRoutesResponse | DispatchRoute[];
          return Array.isArray(payload) ? payload : (payload?.data ?? []);
        }),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  dispatch(id: number): Observable<DispatchRoute> {
    return this.http
      .post<any>(`${this.apiUrl}/store/dispatch-routes/${id}/dispatch`, {})
      .pipe(
        map((r) => r.data as DispatchRoute),
        tap(() => this.invalidateStatsCache()),
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

  /**
   * Download the route-sheet PDF as a Blob.
   * `POST /store/dispatch-routes/:id/pdf` (the backend streams an
   * `application/pdf` buffer; we read it as a blob for download/preview).
   */
  downloadPdf(routeId: number): Observable<Blob> {
    return this.http
      .post(`${this.apiUrl}/store/dispatch-routes/${routeId}/pdf`, {}, {
        responseType: 'blob',
      })
      .pipe(
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  // ===== Route-sheet AI scanner =====

  /**
   * Upload a scanned route sheet (image/PDF) for AI extraction.
   * `POST /store/dispatch-routes/:id/scan` (multipart `file`).
   */
  scanSheet(routeId: number, file: File): Observable<RouteSheetScanResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${routeId}/scan`,
        formData,
      )
      .pipe(
        map((r) => r.data as RouteSheetScanResult),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  /**
   * Match the extracted rows against the route's real stops.
   * `POST /store/dispatch-routes/:id/scan/match` (JSON body: the scan result).
   * Returns a proposal — nothing is persisted.
   */
  matchStops(
    routeId: number,
    scan: RouteSheetScanResult,
  ): Observable<RouteSheetMatchResult> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${routeId}/scan/match`,
        scan,
      )
      .pipe(
        map((r) => r.data as RouteSheetMatchResult),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  /**
   * Confirm the human-reviewed decisions and settle the route from the scan.
   * `POST /store/dispatch-routes/:id/scan/confirm` (multipart `file` + the
   * confirm DTO). The nested `stops` array and `scan_result` are sent as
   * JSON-string fields so they survive multipart transport. Returns the
   * settlement summary; callers should reload the route afterwards.
   */
  confirmScan(
    routeId: number,
    file: File,
    dto: ConfirmRouteSheetDto,
  ): Observable<ConfirmRouteSheetResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('stops', JSON.stringify(dto.stops));
    if (dto.scan_result) {
      formData.append('scan_result', JSON.stringify(dto.scan_result));
    }
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${routeId}/scan/confirm`,
        formData,
      )
      .pipe(
        map((r) => r.data as ConfirmRouteSheetResult),
        tap(() => this.invalidateStatsCache()),
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
  /**
   * Lists dispatch notes that the operator can still pick when creating a
   * planilla. Uses the backend `GET /store/dispatch-routes/available-notes`
   * endpoint, which already filters out notes that are locked by an active
   * (non-draft, non-released) stop. The legacy
   * `/dispatch-notes?status=confirmed` query returns ALL confirmed notes
   * and triggered 500 errors when the wizard tried to assign locked ones.
   */
  listAvailableDispatchNotes(search?: string): Observable<{ data: any[]; pagination: any }> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const qs = params.toString();
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/available-notes${qs ? '?' + qs : ''}`)
      .pipe(
        map((r) => ({
          data: r.data ?? [],
          pagination: { total: (r.data ?? []).length, page: 1, limit: (r.data ?? []).length || 1, totalPages: 1 },
        })),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
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
