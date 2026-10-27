import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { IcalExportUnit } from '../interfaces/ical-export.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type TokenResult = Pick<IcalExportUnit, 'id' | 'code' | 'ical_export_token'>;

/** Hospitality Suite (H6.1) — `/store/hospitality/channels/ical` client. */
@Injectable({ providedIn: 'root' })
export class LodgingIcalExportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/hospitality/channels/ical`;

  units(): Observable<IcalExportUnit[]> {
    return this.http
      .get<ApiResponse<IcalExportUnit[]>>(`${this.baseUrl}/units`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Creates the link, or replaces it (the previous URL stops working). */
  rotate(unitId: number): Observable<TokenResult> {
    return this.http
      .post<ApiResponse<TokenResult>>(`${this.baseUrl}/units/${unitId}/token`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  revoke(unitId: number): Observable<TokenResult> {
    return this.http
      .delete<ApiResponse<TokenResult>>(`${this.baseUrl}/units/${unitId}/token`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Public URL that Airbnb/Booking import (no session needed). */
  feedUrl(token: string): string {
    return `${environment.apiUrl}/public/hospitality/ical/${token}.ics`;
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
