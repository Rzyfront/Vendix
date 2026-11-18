import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  PlatformAlertView,
  PlatformAlertsFilters,
  PlatformAlertsPage,
  PlatformAlertsPaginationMeta,
  PlatformAlertsStats,
  PlatformTestAlertResult,
  PlatformTestAlertSeverity,
} from '../interfaces/monitoring-alerts.interface';

interface DataEnvelope<T> {
  data: T;
}

interface PaginatedEnvelope {
  data: PlatformAlertView[];
  meta: PlatformAlertsPaginationMeta;
}

@Injectable({ providedIn: 'root' })
export class MonitoringAlertsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/superadmin/monitoring/alerts`;

  list(filters: PlatformAlertsFilters): Observable<PlatformAlertsPage> {
    let params = new HttpParams()
      .set('status', filters.status)
      .set('page', String(filters.page))
      .set('limit', String(filters.limit));
    if (filters.severity) params = params.set('severity', filters.severity);
    if (filters.source) params = params.set('source', filters.source);
    const search = filters.search?.trim();
    if (search) params = params.set('search', search);

    return this.http
      .get<PaginatedEnvelope>(this.baseUrl, { params })
      .pipe(map((res) => ({ data: res.data ?? [], meta: res.meta })));
  }

  getStats(): Observable<PlatformAlertsStats> {
    return this.http
      .get<DataEnvelope<PlatformAlertsStats>>(`${this.baseUrl}/stats`)
      .pipe(map((res) => res.data));
  }

  getById(id: number): Observable<PlatformAlertView> {
    return this.http
      .get<DataEnvelope<PlatformAlertView>>(`${this.baseUrl}/${id}`)
      .pipe(map((res) => res.data));
  }

  resolve(id: number): Observable<PlatformAlertView> {
    return this.http
      .post<DataEnvelope<PlatformAlertView>>(`${this.baseUrl}/${id}/resolve`, {})
      .pipe(map((res) => res.data));
  }

  sendTest(severity: PlatformTestAlertSeverity): Observable<PlatformTestAlertResult> {
    return this.http
      .post<DataEnvelope<PlatformTestAlertResult>>(`${this.baseUrl}/test`, { severity })
      .pipe(map((res) => res.data));
  }
}
