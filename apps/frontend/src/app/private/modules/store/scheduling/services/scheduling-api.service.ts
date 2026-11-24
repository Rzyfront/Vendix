import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SchedulingCalendarResult,
  SchedulingListResponse,
  SchedulingQuery,
  SchedulingSources,
} from '../interfaces/scheduling.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Query → params: listas separadas por coma, vacíos fuera. */
export function schedulingParams(query: SchedulingQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params = params.set(key, value.join(','));
      continue;
    }
    params = params.set(key, String(value));
  }
  return params;
}

/** Órdenes → Programación y Agenda: lectura agregada (`/store/scheduling`). */
@Injectable({ providedIn: 'root' })
export class SchedulingApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/scheduling`;

  getSources(): Observable<SchedulingSources> {
    return this.http
      .get<ApiResponse<SchedulingSources>>(`${this.baseUrl}/sources`)
      .pipe(map((r) => r.data));
  }

  getEvents(query: SchedulingQuery): Observable<SchedulingListResponse> {
    return this.http
      .get<SchedulingListResponse>(`${this.baseUrl}/events`, { params: schedulingParams(query) })
      .pipe(map((r) => ({ data: r.data ?? [], meta: r.meta })));
  }

  getCalendar(query: SchedulingQuery & { from: string; to: string }): Observable<SchedulingCalendarResult> {
    return this.http
      .get<ApiResponse<SchedulingCalendarResult>>(`${this.baseUrl}/calendar`, {
        params: schedulingParams(query),
      })
      .pipe(map((r) => r.data));
  }
}
