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

export type StationType = 'carro' | 'moto' | 'peluqueria' | 'barberia' | 'salon_belleza' | 'general' | 'celular';

export interface ServiceStation {
  id: number;
  name: string;
  station_type?: StationType;
  capacity: number;
  /** Si es false la estación no lleva cronómetro ni pide tiempo estimado al ingresar. */
  track_time?: boolean;
  /** Minutos objetivo por atención cuando track_time está activo; null usa la duración del servicio. */
  target_minutes?: number | null;
  /** Formulario de Recolección de datos de la estación; null = se usa el del servicio. */
  intake_template_id?: number | null;
  status: 'active' | 'inactive';
  public_id: string | null;
  qr_status: 'ready' | 'unavailable';
  services: Array<{ product_id: number; product: { id: number; name: string; base_price?: number | string; service_duration_minutes: number | null } | null }>;
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
  base_price?: number | string | null;
  service_duration_minutes?: number | null;
  is_recurring?: boolean;
}

/** Campo de Recolección de datos tal como viene en un item de plantilla. */
export interface IntakeMetadataField {
  id: number;
  field_key: string;
  field_type: string;
  label: string;
  entity_type: string;
  description?: string | null;
  options?: unknown;
  is_required?: boolean;
}

export interface IntakeTemplateItem {
  id: number;
  sort_order?: number;
  is_required?: boolean;
  placeholder?: string | null;
  help_text?: string | null;
  icon?: string | null;
  width?: string;
  metadata_field: IntakeMetadataField;
}

export interface IntakeTemplateSection {
  id: number;
  title: string;
  description?: string | null;
  sort_order?: number;
  items?: IntakeTemplateItem[];
  child_sections?: IntakeTemplateSection[];
}

/** Plantilla de recepción (misma forma que GET /store/data-collection/templates/:id). */
export interface IntakeTemplate {
  id: number;
  name: string;
  description?: string | null;
  tabs?: Array<{ id: number; title: string; sort_order?: number; sections?: IntakeTemplateSection[] }>;
  sections?: IntakeTemplateSection[];
}

export type IntakeValue = string | number | boolean | null;

export interface SessionIntakeAnswer {
  field_id: number;
  label: string;
  field_type: string;
  entity_type: string;
  value: unknown;
}

export interface SessionIntake {
  template_id: number;
  template_name: string;
  answers: SessionIntakeAnswer[];
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

  getPublicUrl(id: number): Observable<string> {
    return this.http.get<{ data?: { public_url: string } }>(`${this.base}/${id}/public-url`).pipe(
      map((response) => this.unwrap(response).public_url),
    );
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

  create(body: { name: string; capacity: number; station_type?: StationType; track_time?: boolean; target_minutes?: number | null; intake_template_id?: number | null }): Observable<ServiceStation> {
    return this.http.post<{ data?: ServiceStation } | ServiceStation>(this.base, body).pipe(map((r) => this.unwrap(r)));
  }

  update(id: number, body: Partial<Pick<ServiceStation, 'name' | 'capacity' | 'status' | 'station_type' | 'track_time' | 'target_minutes' | 'intake_template_id'>>): Observable<ServiceStation> {
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

  getAllProducts(): Observable<any[]> {
    return this.http.get<{ data?: unknown } | unknown>(`${environment.apiUrl}/store/products?limit=150`).pipe(
      map((r) => {
        const unwrapped = this.unwrap<unknown>(r);
        if (Array.isArray(unwrapped)) return unwrapped;
        if (unwrapped && typeof unwrapped === 'object' && 'data' in unwrapped && Array.isArray((unwrapped as { data: unknown }).data)) {
          return (unwrapped as { data: any[] }).data;
        }
        return [];
      }),
    );
  }

  getSellableProducts(): Observable<any[]> {
    return this.http
      .get<{ data?: unknown } | unknown>(
        `${environment.apiUrl}/store/products?limit=150&is_sellable=true&is_ingredient=false&include_variants=true`,
      )
      .pipe(
        map((r) => {
          const unwrapped = this.unwrap<unknown>(r);
          if (Array.isArray(unwrapped)) return unwrapped;
          if (unwrapped && typeof unwrapped === 'object' && 'data' in unwrapped && Array.isArray((unwrapped as { data: unknown }).data)) {
            return (unwrapped as { data: any[] }).data;
          }
          return [];
        }),
      );
  }

  /** Asegura el presupuesto base para cobrar; falla si un tope del cliente no cubre el total. */
  prepareCharge(sessionId: number): Observable<{ order_id: number }> {
    return this.http
      .post<{ data?: { order_id: number } } | { order_id: number }>(`${environment.apiUrl}/store/service-sessions/${sessionId}/prepare-charge`, {})
      .pipe(map((r) => this.unwrap(r)));
  }

  reissueAccessLink(
    sessionId: number,
    body: { identity_verified: true; verification_method: 'in_person' | 'phone_callback' | 'known_customer'; verification_note: string; idempotency_key: string },
  ): Observable<{ access_url?: string | null; email_delivery_status?: string }> {
    return this.http
      .post<{ data?: { access_url?: string | null; email_delivery_status?: string } } | { access_url?: string | null; email_delivery_status?: string }>(
        `${environment.apiUrl}/store/service-sessions/${sessionId}/access-link/reissue`,
        body,
      )
      .pipe(map((r) => this.unwrap(r)));
  }

  getIntakeTemplate(productId: number, stationId?: number | null): Observable<IntakeTemplate | null> {
    let params = new HttpParams().set('product_id', String(productId));
    if (stationId) params = params.set('station_id', String(stationId));
    return this.http
      .get<{ data?: { template: IntakeTemplate | null } } | { template: IntakeTemplate | null }>(
        `${environment.apiUrl}/store/service-sessions/intake-template`,
        { params },
      )
      .pipe(map((r) => this.unwrap<{ template: IntakeTemplate | null }>(r)?.template ?? null));
  }

  getIntakePrefill(productId: number, customerId: number, stationId?: number | null): Observable<Array<{ field_id: number; value: unknown }>> {
    let params = new HttpParams().set('product_id', String(productId)).set('customer_id', String(customerId));
    if (stationId) params = params.set('station_id', String(stationId));
    return this.http
      .get<{ data?: { values: Array<{ field_id: number; value: unknown }> } } | { values: Array<{ field_id: number; value: unknown }> }>(
        `${environment.apiUrl}/store/service-sessions/intake-prefill`,
        { params },
      )
      .pipe(map((r) => this.unwrap<{ values: Array<{ field_id: number; value: unknown }> }>(r)?.values ?? []));
  }

  getSession(id: number): Observable<any> {
    return this.http.get<{ data?: any } | any>(`${environment.apiUrl}/store/service-sessions/${id}`).pipe(
      map((r) => this.unwrap(r)),
    );
  }

  addItem(sessionId: number, body: { product_id: number; product_variant_id?: number; quantity?: number; unit_price?: number; description?: string }): Observable<any> {
    return this.http.post<{ data?: any } | any>(`${environment.apiUrl}/store/service-sessions/${sessionId}/items`, body).pipe(
      map((r) => this.unwrap(r)),
    );
  }

  removeItem(sessionId: number, itemId: number): Observable<any> {
    return this.http.delete<{ data?: any } | any>(`${environment.apiUrl}/store/service-sessions/${sessionId}/items/${itemId}`).pipe(
      map((r) => this.unwrap(r)),
    );
  }

  setBudget(sessionId: number, amount: number, currency: string = 'COP', expectedVersion: number = 0): Observable<any> {
    return this.http.put<{ data?: any } | any>(
      `${environment.apiUrl}/store/service-sessions/${sessionId}/budget`,
      { amount, currency, expectedVersion },
    ).pipe(
      map((r) => this.unwrap(r)),
    );
  }
}
