import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { RatePlan, RatePlanPayload } from '../interfaces/rate-plan.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H2.1) — `/store/hospitality/rate-plans` client. */
@Injectable({ providedIn: 'root' })
export class RatePlansService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/rate-plans`;

  list(): Observable<RatePlan[]> {
    return this.http
      .get<ApiResponse<RatePlan[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: RatePlanPayload): Observable<RatePlan> {
    return this.http
      .post<ApiResponse<RatePlan>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(id: number, payload: Partial<RatePlanPayload>): Observable<RatePlan> {
    return this.http
      .patch<ApiResponse<RatePlan>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
