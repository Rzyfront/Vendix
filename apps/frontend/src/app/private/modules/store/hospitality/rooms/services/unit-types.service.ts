import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { UnitType, UnitTypePayload } from '../interfaces/unit-type.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Hospitality Suite (H0.2) — `/store/hospitality/unit-types` client. */
@Injectable({ providedIn: 'root' })
export class UnitTypesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/unit-types`;

  list(): Observable<UnitType[]> {
    return this.http
      .get<ApiResponse<UnitType[]>>(this.baseUrl)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  create(payload: UnitTypePayload): Observable<UnitType> {
    return this.http
      .post<ApiResponse<UnitType>>(this.baseUrl, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  update(id: number, payload: Partial<UnitTypePayload>): Observable<UnitType> {
    return this.http
      .patch<ApiResponse<UnitType>>(`${this.baseUrl}/${id}`, payload)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
