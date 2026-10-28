import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { Season, SeasonPayload } from '../interfaces/rate-plan.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H2.2) — `/store/hospitality/seasons` client. */
@Injectable({ providedIn: 'root' })
export class SeasonsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/seasons`;

  list(): Observable<Season[]> {
    return this.http
      .get<ApiResponse<Season[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: SeasonPayload): Observable<Season> {
    return this.http
      .post<ApiResponse<Season>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(id: number, payload: Partial<SeasonPayload>): Observable<Season> {
    return this.http
      .patch<ApiResponse<Season>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
