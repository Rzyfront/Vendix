import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { Allotment, AllotmentPayload, AllotmentUpdatePayload } from '../interfaces/rate-plan.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H2.5) — `/store/hospitality/allotments` client. */
@Injectable({ providedIn: 'root' })
export class AllotmentsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/allotments`;

  list(): Observable<Allotment[]> {
    return this.http
      .get<ApiResponse<Allotment[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: AllotmentPayload): Observable<Allotment> {
    return this.http
      .post<ApiResponse<Allotment>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(id: number, payload: AllotmentUpdatePayload): Observable<Allotment> {
    return this.http
      .patch<ApiResponse<Allotment>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
