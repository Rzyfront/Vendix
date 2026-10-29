import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { hospitalityErrorMessage } from '../../shared/hospitality-errors';
import {
  SireListQuery,
  SireListResult,
  SireSheet,
  SireSubmission,
  SireSummary,
} from '../interfaces/sire.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: { total: number; page: number; totalPages: number };
}

/** Hospitality Suite (H4.2) — `/store/hospitality/compliance/sire` client. */
@Injectable({ providedIn: 'root' })
export class LodgingSireService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/compliance/sire`;

  summary(): Observable<SireSummary> {
    return this.http
      .get<ApiResponse<SireSummary>>(`${this.baseUrl}/summary`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  list(query: SireListQuery): Observable<SireListResult> {
    return this.http
      .get<ApiResponse<SireSubmission[]>>(this.baseUrl, { params: toParams(query) })
      .pipe(
        map((res) => ({
          data: res.data,
          total: res.meta?.total ?? res.data.length,
          totalPages: res.meta?.totalPages ?? 1,
        })),
        catchError(this.handleError),
      );
  }

  sheet(id: number): Observable<SireSheet> {
    return this.http
      .get<ApiResponse<SireSheet>>(`${this.baseUrl}/${id}`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  markReported(ids: number[]): Observable<{ updated: number }> {
    return this.http
      .post<ApiResponse<{ updated: number }>>(`${this.baseUrl}/mark-reported`, { ids })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Without a status: the pending movements. */
  export(query: Pick<SireListQuery, 'search' | 'status'>): Observable<Blob> {
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
