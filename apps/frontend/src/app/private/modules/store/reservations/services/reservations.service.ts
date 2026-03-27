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
  ServiceSchedule,
  ScheduleException,
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

  getAvailability(productId: number, dateFrom: string, dateTo: string): Observable<AvailabilitySlot[]> {
    const params = new HttpParams()
      .set('product_id', productId.toString())
      .set('date_from', dateFrom)
      .set('date_to', dateTo);

    return this.http.get<any>(`${this.apiUrl}/availability`, { params }).pipe(
      map((response) => response.data || response),
    );
  }

  getServiceSchedules(productId: number): Observable<ServiceSchedule[]> {
    return this.http.get<any>(`${this.apiUrl}/schedules/${productId}`).pipe(
      map((response) => response.data || response),
    );
  }

  upsertSchedule(productId: number, items: Partial<ServiceSchedule>[]): Observable<ServiceSchedule[]> {
    return this.http.put<any>(`${this.apiUrl}/schedules/${productId}`, { items }).pipe(
      map((response) => response.data || response),
    );
  }

  createException(dto: { product_id: number; date: string; reason?: string }): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/exceptions`, dto).pipe(
      map((response) => response.data || response),
    );
  }

  deleteException(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/exceptions/${id}`);
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

  getExceptions(productId: number, dateFrom?: string, dateTo?: string): Observable<ScheduleException[]> {
    let params = new HttpParams().set('product_id', productId.toString());
    if (dateFrom) params = params.set('date_from', dateFrom);
    if (dateTo) params = params.set('date_to', dateTo);

    return this.http.get<any>(`${this.apiUrl}/schedules/exceptions`, { params }).pipe(
      map((response) => response.data || response),
    );
  }
}
