import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  CreateReservationRequest,
  LodgingReservation,
  ReservationQuote,
  ReservationQuoteRequest,
} from '../interfaces/reservation.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H1.1) — `/store/hospitality/reservations` client. */
@Injectable({ providedIn: 'root' })
export class LodgingReservationsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/reservations`;

  list(): Observable<LodgingReservation[]> {
    return this.http
      .get<ApiResponse<LodgingReservation[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  quote(request: ReservationQuoteRequest): Observable<ReservationQuote> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(request)) {
      if (value !== undefined && value !== null) params = params.set(key, String(value));
    }
    return this.http
      .get<ApiResponse<ReservationQuote>>(`${this.baseUrl}/quote`, { params })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(request: CreateReservationRequest): Observable<LodgingReservation> {
    return this.http
      .post<ApiResponse<LodgingReservation>>(this.baseUrl, request)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can show it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
