import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { LodgingRestriction, RestrictionPayload } from '../interfaces/rate-plan.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H2.3) — `/store/hospitality/restrictions` client. */
@Injectable({ providedIn: 'root' })
export class RestrictionsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/restrictions`;

  /** Nights from `from` to `to`, both included (`YYYY-MM-DD`). */
  list(from: string, to: string): Observable<LodgingRestriction[]> {
    return this.http
      .get<ApiResponse<LodgingRestriction[]>>(this.baseUrl, { params: { from, to } })
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  save(payload: RestrictionPayload): Observable<LodgingRestriction[]> {
    return this.http
      .put<ApiResponse<LodgingRestriction[]>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
