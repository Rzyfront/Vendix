import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  available: number;
}

export interface CreateBookingDto {
  product_id: number;
  date: string;
  start_time: string;
  end_time: string;
  notes?: string;
}

export interface RescheduleBookingDto {
  date: string;
  start_time: string;
  end_time: string;
}

export interface HoldResult {
  id: number;
  booking_number: string;
  product_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  expires_at: string | null;
}

export interface CustomerBooking {
  id: number;
  booking_number: string;
  product_id: number;
  product_name: string;
  date: string;
  start_time: string;
  end_time: string;
  status:
    | 'pending'
    | 'confirmed'
    | 'in_progress'
    | 'completed'
    | 'cancelled'
    | 'no_show';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable({
  providedIn: 'root',
})
export class EcommerceBookingService {
  private api_url = `${environment.apiUrl}/ecommerce/reservations`;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
  ) {}

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  getAvailability(
    productId: number,
    dateFrom: string,
    dateTo: string,
  ): Observable<{ success: boolean; data: AvailabilitySlot[] }> {
    const params = new HttpParams()
      .set('date_from', dateFrom)
      .set('date_to', dateTo);

    return this.http.get<{ success: boolean; data: AvailabilitySlot[] }>(
      `${this.api_url}/availability/${productId}`,
      { headers: this.getHeaders(), params },
    );
  }

  createBooking(
    dto: CreateBookingDto,
  ): Observable<{ success: boolean; data: CustomerBooking; message?: string }> {
    return this.http.post<{
      success: boolean;
      data: CustomerBooking;
      message?: string;
    }>(this.api_url, dto, { headers: this.getHeaders() });
  }

  getMyBookings(): Observable<{ success: boolean; data: CustomerBooking[] }> {
    return this.http.get<{ success: boolean; data: CustomerBooking[] }>(
      `${this.api_url}/my`,
      { headers: this.getHeaders() },
    );
  }

  cancelBooking(
    id: number,
  ): Observable<{ success: boolean; message?: string }> {
    return this.http.post<{ success: boolean; message?: string }>(
      `${this.api_url}/${id}/cancel`,
      {},
      { headers: this.getHeaders() },
    );
  }

  rescheduleBooking(
    id: number,
    dto: RescheduleBookingDto,
  ): Observable<{ success: boolean; data: CustomerBooking; message?: string }> {
    return this.http.post<{
      success: boolean;
      data: CustomerBooking;
      message?: string;
    }>(`${this.api_url}/${id}/reschedule`, dto, { headers: this.getHeaders() });
  }

  holdBooking(dto: {
    product_id: number;
    date: string;
    start_time: string;
    end_time: string;
    notes?: string;
  }): Observable<{ success: boolean; data: HoldResult }> {
    return this.http.post<{ success: boolean; data: HoldResult }>(
      `${this.api_url}/hold`,
      dto,
      { headers: this.getHeaders() },
    );
  }

  confirmHold(
    id: number,
  ): Observable<{ success: boolean; data: CustomerBooking }> {
    return this.http.post<{ success: boolean; data: CustomerBooking }>(
      `${this.api_url}/${id}/confirm-hold`,
      {},
      { headers: this.getHeaders() },
    );
  }
}
