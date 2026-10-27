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
  RoomChangeQuote,
  RoomChangeRequest,
} from '../interfaces/reservation.interface';
import { SellableRatePlan } from '../../rates/interfaces/rate-plan.interface';

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

  /** Cancels one room of a multi-room reservation; the others stay (H1.5). */
  cancelRoom(roomId: number, reason: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/rooms/${roomId}/cancel`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  markNoShow(id: number, reason?: string): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(`${this.baseUrl}/${id}/no-show`, { reason })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** H2.1 — active rate plans with the room types each one prices. */
  sellableRatePlans(): Observable<SellableRatePlan[]> {
    return this.http
      .get<ApiResponse<SellableRatePlan[]>>(`${this.baseUrl}/rate-plans`)
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

  /** Validates and prices a room change without applying it (H1.4). */
  changeQuote(roomId: number, change: RoomChangeRequest): Observable<RoomChangeQuote> {
    return this.http
      .get<ApiResponse<RoomChangeQuote>>(`${this.baseUrl}/rooms/${roomId}/change-quote`, {
        params: toParams(change),
      })
      .pipe(
        map((r) => r.data),
        catchError(this.handleError),
      );
  }

  /** Assigns, moves or resizes a reservation room (H1.4). */
  changeRoom(roomId: number, change: RoomChangeRequest): Observable<LodgingReservation> {
    return this.http
      .patch<ApiResponse<LodgingReservation>>(`${this.baseUrl}/rooms/${roomId}`, change)
      .pipe(
        map((r) => r.data),
        catchError(this.handleError),
      );
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
