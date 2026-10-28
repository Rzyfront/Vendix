import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { CancellationPolicy, CancellationPolicyPayload } from '../interfaces/rate-plan.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H2.4) — `/store/hospitality/cancellation-policies` client. */
@Injectable({ providedIn: 'root' })
export class CancellationPoliciesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/cancellation-policies`;

  list(): Observable<CancellationPolicy[]> {
    return this.http
      .get<ApiResponse<CancellationPolicy[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: CancellationPolicyPayload): Observable<CancellationPolicy> {
    return this.http
      .post<ApiResponse<CancellationPolicy>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(id: number, payload: Partial<CancellationPolicyPayload>): Observable<CancellationPolicy> {
    return this.http
      .patch<ApiResponse<CancellationPolicy>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
