import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  CreateIcalImportRequest,
  IcalExportUnit,
  IcalImport,
} from '../interfaces/ical-export.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

type TokenResult = Pick<IcalExportUnit, 'id' | 'code' | 'ical_export_token'>;

/** Hospitality Suite (H6.1–H6.2) — `/store/hospitality/channels/ical` client. */
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

  /** H6.2 — calendars imported per room. */
  imports(): Observable<IcalImport[]> {
    return this.http
      .get<ApiResponse<IcalImport[]>>(`${this.baseUrl}/imports`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Saves the calendar and syncs it once (the result comes in the row). */
  createImport(body: CreateIcalImportRequest): Observable<IcalImport> {
    return this.http
      .post<ApiResponse<IcalImport>>(`${this.baseUrl}/imports`, body)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  syncImport(id: number): Observable<IcalImport> {
    return this.http
      .post<ApiResponse<IcalImport>>(`${this.baseUrl}/imports/${id}/sync`, {})
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Stops importing; the room's upcoming blocks from that channel are released. */
  removeImport(id: number): Observable<{ id: number }> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.baseUrl}/imports/${id}`)
      .pipe(map((res) => res.data), catchError(this.handleError));
  }

  /** Rejects with the user-facing message so screens can toast it as-is. */
  private handleError(error: unknown): Observable<never> {
    return throwError(() => parseApiError(error).userMessage);
  }
}
