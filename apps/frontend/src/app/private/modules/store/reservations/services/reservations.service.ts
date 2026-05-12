import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Booking,
  BookingStats,
  BookingQuery,
  CreateBookingDto,
  RescheduleBookingDto,
  AvailabilitySlot,
  ServiceProvider,
  ProviderSchedule,
  ProviderException,
} from '../interfaces/reservation.interface';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class ReservationsService {
  private apiUrl = `${environment.apiUrl}/store/reservations`;

  constructor(private http: HttpClient) {}

  getReservations(query: BookingQuery = {}): Observable<PaginatedResponse<Booking>> {
    let params = new HttpParams();

    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);
    if (query.customer_id) params = params.set('customer_id', query.customer_id.toString());
    if (query.product_id) params = params.set('product_id', query.product_id.toString());
    if (query.channel) params = params.set('channel', query.channel);
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.sort_order) params = params.set('sort_order', query.sort_order);

    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map((response) => {
        const inner = response.data || response;
        return {
          data: inner.data || [],
          meta: inner.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 },
        };
      }),
    );
  }

  getReservation(id: number): Observable<Booking> {
    return this.http.get<any>(`${this.apiUrl}/${id}`).pipe(
      map((response) => response.data || response),
    );
  }

  createReservation(dto: CreateBookingDto): Observable<Booking> {
    return this.http.post<any>(this.apiUrl, dto).pipe(
      map((response) => response.data || response),
    );
  }

  confirmReservation(id: number): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/confirm`, {}).pipe(
      map((response) => response.data || response),
    );
  }

  cancelReservation(id: number): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/cancel`, {}).pipe(
      map((response) => response.data || response),
    );
  }

  completeReservation(id: number): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/complete`, {}).pipe(
      map((response) => response.data || response),
    );
  }

  markNoShow(id: number): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/no-show`, {}).pipe(
      map((response) => response.data || response),
    );
  }

  rescheduleReservation(id: number, dto: RescheduleBookingDto): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/reschedule`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  getStats(): Observable<BookingStats> {
    return this.http.get<any>(`${this.apiUrl}/stats`).pipe(
      map((response) => response.data || response),
    );
  }

  getToday(): Observable<Booking[]> {
    return this.http.get<any>(`${this.apiUrl}/today`).pipe(
      map((response) => response.data || response),
    );
  }

  getAvailability(
    productId: number,
    dateFrom: string,
    dateTo: string,
    providerId?: number,
    productVariantId?: number,
  ): Observable<AvailabilitySlot[]> {
    let params = new HttpParams()
      .set('date_from', dateFrom)
      .set('date_to', dateTo);

    if (providerId) {
      params = params.set('provider_id', providerId.toString());
    }
    if (productVariantId) {
      params = params.set('product_variant_id', productVariantId.toString());
    }

    return this.http.get<any>(`${this.apiUrl}/availability/${productId}`, { params }).pipe(
      map((response) => response.data || response),
    );
  }

  getCalendar(dateFrom: string, dateTo: string, productId?: number): Observable<Record<string, Booking[]>> {
    let params = new HttpParams()
      .set('date_from', dateFrom)
      .set('date_to', dateTo);

    if (productId) params = params.set('product_id', productId.toString());

    return this.http.get<any>(`${this.apiUrl}/calendar`, { params }).pipe(
      map((response) => response.data || response),
    );
  }

  startReservation(id: number): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}/start`, {}).pipe(
      map((response) => response.data || response),
    );
  }

  updateNotes(id: number, dto: { notes?: string; internal_notes?: string }): Observable<Booking> {
    return this.http.patch<any>(`${this.apiUrl}/${id}`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  // --- Providers ---

  getProviders(): Observable<ServiceProvider[]> {
    return this.http.get<any>(`${this.apiUrl}/providers`).pipe(
      map((response) => response.data || response),
    );
  }

  getProvider(id: number): Observable<ServiceProvider> {
    return this.http.get<any>(`${this.apiUrl}/providers/${id}`).pipe(
      map((response) => response.data || response),
    );
  }

  createProvider(dto: { employee_id: number; display_name?: string; avatar_url?: string; bio?: string }): Observable<ServiceProvider> {
    return this.http.post<any>(`${this.apiUrl}/providers`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  updateProvider(id: number, dto: { display_name?: string; avatar_url?: string; bio?: string; is_active?: boolean; sort_order?: number }): Observable<ServiceProvider> {
    return this.http.patch<any>(`${this.apiUrl}/providers/${id}`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  getAvailableEmployees(): Observable<{ id: number; first_name: string; last_name: string; position?: string }[]> {
    return this.http.get<any>(`${this.apiUrl}/providers/available-employees`).pipe(
      map((response) => response.data || response),
    );
  }

  getProvidersForService(productId: number): Observable<ServiceProvider[]> {
    return this.http.get<any>(`${this.apiUrl}/providers/for-service/${productId}`).pipe(
      map((response) => response.data || response),
    );
  }

  assignServiceToProvider(providerId: number, productId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/providers/${providerId}/services`, { product_id: productId }).pipe(
      map((response) => response.data || response),
    );
  }

  removeServiceFromProvider(providerId: number, productId: number): Observable<void> {
    return this.http.delete<any>(`${this.apiUrl}/providers/${providerId}/services/${productId}`);
  }

  getProviderSchedule(providerId: number): Observable<ProviderSchedule[]> {
    return this.http.get<any>(`${this.apiUrl}/providers/${providerId}/schedules`).pipe(
      map((response) => response.data || response),
    );
  }

  upsertProviderSchedule(providerId: number, items: Partial<ProviderSchedule>[]): Observable<ProviderSchedule[]> {
    return this.http.put<any>(`${this.apiUrl}/providers/${providerId}/schedules`, { items }).pipe(
      map((response) => response.data || response),
    );
  }

  getProviderExceptions(providerId: number, dateFrom?: string, dateTo?: string): Observable<ProviderException[]> {
    let params = new HttpParams();
    if (dateFrom) params = params.set('date_from', dateFrom);
    if (dateTo) params = params.set('date_to', dateTo);
    return this.http.get<any>(`${this.apiUrl}/providers/${providerId}/exceptions`, { params }).pipe(
      map((response) => response.data || response),
    );
  }

  createProviderException(providerId: number, dto: Partial<ProviderException>): Observable<ProviderException> {
    return this.http.post<any>(`${this.apiUrl}/providers/${providerId}/exceptions`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  deleteProviderException(providerId: number, exceptionId: number): Observable<void> {
    return this.http.delete<any>(`${this.apiUrl}/providers/${providerId}/exceptions/${exceptionId}`);
  }

  // Provider service assignments
  getProviderServices(providerId: number): Observable<any[]> {
    return this.http.get<any>(`${this.apiUrl}/providers/${providerId}/services`).pipe(
      map((response) => response.data || response || []),
    );
  }

  // Bookable services (for assignment)
  getBookableServices(): Observable<{ id: number; name: string; base_price?: number; service_duration_minutes?: number; booking_mode?: string }[]> {
    const params = new HttpParams()
      .set('product_type', 'service')
      .set('requires_booking', 'true')
      .set('limit', '100');

    return this.http.get<any>(`${environment.apiUrl}/store/products`, { params }).pipe(
      map((response) => {
        const inner = response.data || response;
        return inner.data || inner || [];
      }),
    );
  }
}
