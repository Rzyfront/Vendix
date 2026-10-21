import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  ServiceRegistryQuery,
  ServiceRegistryResponse,
  ServiceRegistryRow,
  ServiceRegistryRowRef,
} from './service-registry.interfaces';

@Injectable({ providedIn: 'root' })
export class ServiceRegistryService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/service-reminders/registry`;

  list(query: ServiceRegistryQuery): Observable<ServiceRegistryResponse> {
    let params = new HttpParams()
      .set('filter', query.filter)
      .set('page', String(query.page))
      .set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    return this.http.get<ServiceRegistryResponse>(this.base, { params });
  }

  sendEmail(row: ServiceRegistryRow): Observable<{ success: boolean; message: string }> {
    return this.http
      .post<{ data: { success: boolean; message: string } }>(`${this.base}/email`, this.ref(row))
      .pipe(map((res) => res.data));
  }

  whatsapp(row: ServiceRegistryRow): Observable<{ url: string; message: string }> {
    return this.http
      .post<{ data: { url: string; message: string } }>(`${this.base}/whatsapp`, this.ref(row))
      .pipe(map((res) => res.data));
  }

  dismiss(row: ServiceRegistryRow): Observable<{ success: boolean }> {
    return this.http
      .post<{ data: { success: boolean } }>(`${this.base}/dismiss`, this.ref(row))
      .pipe(map((res) => res.data));
  }

  private ref(row: ServiceRegistryRow): ServiceRegistryRowRef {
    return { source_order_id: row.source_order_id, product_id: row.service.id };
  }
}
