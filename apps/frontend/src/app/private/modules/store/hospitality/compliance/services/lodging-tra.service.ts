import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { hospitalityErrorMessage } from '../../shared/hospitality-errors';
import {
  TraListQuery,
  TraListResult,
  TraSubmission,
  TraSummary,
  TraTestResult,
} from '../interfaces/tra.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: { total: number; page: number; totalPages: number };
}

/** Hospitality Suite (H4.1) — `/store/hospitality/compliance/tra` client. */
@Injectable({ providedIn: 'root' })
export class LodgingTraService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/compliance/tra`;

  summary(): Observable<TraSummary> {
    return this.http
      .get<ApiResponse<TraSummary>>(`${this.baseUrl}/summary`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  list(query: TraListQuery): Observable<TraListResult> {
    return this.http
      .get<ApiResponse<TraSubmission[]>>(this.baseUrl, { params: toParams(query) })
      .pipe(
        map((res) => ({
          data: res.data,
          total: res.meta?.total ?? res.data.length,
          totalPages: res.meta?.totalPages ?? 1,
        })),
        catchError(this.handleError),
      );
  }

  /** Without ids: every pending or rejected record. */
  retry(ids?: number[]): Observable<{ queued: number }> {
    return this.http
      .post<ApiResponse<{ queued: number }>>(`${this.baseUrl}/retry`, { ids })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  markReported(ids: number[]): Observable<{ updated: number }> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(`${this.baseUrl}/mark-reported`, { ids })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  saveToken(token: string): Observable<TraTestResult> {
    return this.http
      .put<ApiResponse<TraTestResult>>(`${this.baseUrl}/token`, { token })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  testToken(): Observable<TraTestResult> {
    return this.http
      .post<ApiResponse<TraTestResult>>(`${this.baseUrl}/token/test`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  export(query: Pick<TraListQuery, 'search' | 'status'>): Observable<Blob> {
    return this.http
      .get(`${this.baseUrl}/export`, { params: toParams(query), responseType: 'blob' })
      .pipe(catchError(this.handleError));
  }

  private handleError(error: unknown): Observable<never> {
    return throwError((): string => hospitalityErrorMessage(error));
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
