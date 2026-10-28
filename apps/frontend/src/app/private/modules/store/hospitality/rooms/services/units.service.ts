import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  LodgingUnit,
  LodgingUnitPayload,
  LodgingUnitsBulkPayload,
} from '../interfaces/unit.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H0.3) — `/store/hospitality/units` client. */
@Injectable({ providedIn: 'root' })
export class LodgingUnitsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/units`;

  list(): Observable<LodgingUnit[]> {
    return this.http
      .get<ApiResponse<LodgingUnit[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: LodgingUnitPayload): Observable<LodgingUnit> {
    return this.http
      .post<ApiResponse<LodgingUnit>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  createBulk(payload: LodgingUnitsBulkPayload): Observable<LodgingUnit[]> {
    return this.http
      .post<ApiResponse<LodgingUnit[]>>(`${this.baseUrl}/bulk`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(
    id: number,
    payload: Partial<LodgingUnitPayload> & { is_active?: boolean },
  ): Observable<LodgingUnit> {
    return this.http
      .patch<ApiResponse<LodgingUnit>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
