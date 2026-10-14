import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

export interface PaginatedApiResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean };
}

export interface ServiceStation {
  id: number;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
  public_id: string | null;
  qr_status: 'ready' | 'unavailable';
  services: Array<{ product_id: number; product: { id: number; name: string; service_duration_minutes: number | null } | null }>;
  providers: Array<{ provider_id: number; provider: { id: number; display_name: string; is_active: boolean } | null }>;
}

export interface StationSchedule {
  block_order?: number;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface StationException {
  id: number;
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface StationServiceOption {
  id: number;
  name: string;
  service_duration_minutes?: number | null;
}

export interface StationProviderOption {
  id: number;
  display_name: string;
  is_active: boolean;
}

@Injectable({ providedIn: 'root' })
export class ServiceStationsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/service-stations`;

  private unwrap<T>(response: { data?: T } | T): T {
    return (response && typeof response === 'object' && 'data' in response
      ? response.data
      : response) as T;
  }

  list(page: number, limit: number): Observable<PaginatedApiResponse<ServiceStation>> {
    const params = new HttpParams().set('page', String(page)).set('limit', String(limit));
    return this.http.get<PaginatedApiResponse<ServiceStation>>(this.base, { params });
  }

  getAvailability(
    serviceId: number,
    dateFrom: string,
    dateTo: string,
    providerId?: number,
    productVariantId?: number,
    stationId?: number,
  ): Observable<any[]> {
    let params = new HttpParams()
      .set('service_id', String(serviceId))
      .set('date_from', dateFrom)
      .set('date_to', dateTo);
    if (providerId) params = params.set('provider_id', String(providerId));
    if (productVariantId) params = params.set('product_variant_id', String(productVariantId));
    if (stationId) params = params.set('station_id', String(stationId));
    return this.http.get<{ data?: any[] } | any[]>(`${environment.apiUrl}/store/service-stations/availability`, { params })
      .pipe(map((response) => this.unwrap(response)));
  }

  create(body: { name: string; capacity: number }): Observable<ServiceStation> {
    return this.http.post<{ data?: ServiceStation } | ServiceStation>(this.base, body).pipe(map((r) => this.unwrap(r)));
  }

  update(id: number, body: Partial<Pick<ServiceStation, 'name' | 'capacity' | 'status'>>): Observable<ServiceStation> {
    return this.http.patch<{ data?: ServiceStation } | ServiceStation>(`${this.base}/${id}`, body).pipe(map((r) => this.unwrap(r)));
  }

  deactivate(id: number): Observable<ServiceStation> {
    return this.http.delete<{ data?: ServiceStation } | ServiceStation>(`${this.base}/${id}`).pipe(map((r) => this.unwrap(r)));
  }

  setServices(id: number, product_ids: number[]): Observable<ServiceStation> {
    return this.http.put<{ data?: ServiceStation } | ServiceStation>(`${this.base}/${id}/services`, { product_ids }).pipe(map((r) => this.unwrap(r)));
  }

  setProviders(id: number, provider_ids: number[]): Observable<ServiceStation> {
    return this.http.put<{ data?: ServiceStation } | ServiceStation>(`${this.base}/${id}/providers`, { provider_ids }).pipe(map((r) => this.unwrap(r)));
  }

  getSchedules(id: number): Observable<StationSchedule[]> {
    return this.http.get<{ data?: StationSchedule[] } | StationSchedule[]>(`${this.base}/${id}/schedules`).pipe(map((r) => this.unwrap(r)));
  }

  setSchedules(id: number, schedules: StationSchedule[]): Observable<StationSchedule[]> {
    return this.http.put<{ data?: StationSchedule[] } | StationSchedule[]>(`${this.base}/${id}/schedules`, { schedules }).pipe(map((r) => this.unwrap(r)));
  }

  getExceptions(id: number): Observable<StationException[]> {
    return this.http.get<{ data?: StationException[] } | StationException[]>(`${this.base}/${id}/exceptions`).pipe(map((r) => this.unwrap(r)));
  }

  createException(id: number, body: { start_at: string; end_at: string; reason?: string }): Observable<StationException> {
    return this.http.post<{ data?: StationException } | StationException>(`${this.base}/${id}/exceptions`, body).pipe(map((r) => this.unwrap(r)));
  }

  deleteException(id: number, exceptionId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/${id}/exceptions/${exceptionId}`);
  }

  getServiceOptions(): Observable<StationServiceOption[]> {
    return this.http.get<{ data?: unknown } | unknown>(`${environment.apiUrl}/store/products?product_type=service&limit=100`).pipe(
      map((r) => {
        const unwrapped = this.unwrap<unknown>(r);
        if (Array.isArray(unwrapped)) return unwrapped as StationServiceOption[];
        if (unwrapped && typeof unwrapped === 'object' && 'data' in unwrapped && Array.isArray((unwrapped as { data: unknown }).data)) {
          return (unwrapped as { data: StationServiceOption[] }).data;
        }
        return [];
      }),
    );
  }
}
