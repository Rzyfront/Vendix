import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  CreateReservationRequest,
  LodgingReservation,
  Rack,
  ReservationListQuery,
  ReservationListResult,
  ReservationQuote,
  ReservationQuoteRequest,
  ReservationStats,
} from '../interfaces/reservation.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: { total: number; page: number; totalPages: number };
}

/** Hospitality Suite (H1.1/H1.2) — `/store/hospitality/reservations` client. */
@Injectable({ providedIn: 'root' })
export class LodgingReservationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/reservations`;

  list(query: ReservationListQuery = {}): Observable<ReservationListResult> {
    return this.http
      .get<ApiResponse<LodgingReservation[]>>(this.baseUrl, { params: toParams(query) })
      .pipe(
        map((res) => ({
          data: res.data,
          total: res.meta?.total ?? res.data.length,
          page: res.meta?.page ?? 1,
          totalPages: res.meta?.totalPages ?? 1,
        })),
        catchError(this.handleError),
      );
  }

  stats(): Observable<ReservationStats> {
    return this.http
      .get<ApiResponse<ReservationStats>>(`${this.baseUrl}/stats`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  get(id: number): Observable<LodgingReservation> {
    return this.http
      .get<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  cancel(id: number, reason: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/cancel`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  markNoShow(id: number, reason?: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/no-show`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  quote(request: ReservationQuoteRequest): Observable<ReservationQuote> {
    return this.http
      .get<ApiResponse<ReservationQuote>>(`${this.baseUrl}/quote`, { params: toParams(request) })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(request: CreateReservationRequest): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(this.baseUrl, request)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Occupancy rack of the nights `[from, to)` (H1.3). */
  rack(from: string, to: string): Observable<Rack> {
    return this.http
      .get<ApiResponse<Rack>>(`${environment.apiUrl}/store/hospitality/rack`, {
        params: toParams({ from, to }),
      })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can show it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}

/** Query object → HttpParams, skipping empty values. */
function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
