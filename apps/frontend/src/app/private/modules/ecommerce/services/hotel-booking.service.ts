import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../environments/environment';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

export interface HotelSearchQuery {
  arrival_date: string;
  departure_date: string;
  adults: number;
  children: number;
}

export interface HotelRoomType {
  id: number;
  name: string;
  description: string | null;
  bed_config: string | null;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  images: string[];
  amenities: { code: string; label: string }[];
  available: number;
  bookable: boolean;
  unavailable_reason: string | null;
  rate_plan: { id: number; name: string } | null;
  total_amount: string;
  nightly_average: string;
  amount_due_now: string;
  deposit_percent: string;
  cancellation_policy: string | null;
}

export interface HotelSearchResult {
  arrival_date: string;
  departure_date: string;
  nights: number;
  check_in_time: string;
  check_out_time: string;
  hold_minutes: number;
  currency: string;
  room_types: HotelRoomType[];
}

export interface HotelHold {
  reservation_id: number;
  reservation_number: string;
  hold_expires_at: string;
  amount_due: string;
  checkout_url: string;
}

export interface HotelReservation {
  id: number;
  reservation_number: string;
  status: 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';
  arrival_date: string;
  departure_date: string;
  nights: number;
  room_type: string;
  adults: number;
  children: number;
  total_amount: string;
  amount_due: string;
  paid_amount: string;
  payment_status: 'pending' | 'completed' | 'cancelled' | null;
  hold_expires_at: string | null;
  checkout_url: string | null;
}

/** H6.6 — hotel booking engine of the storefront. */
@Injectable({ providedIn: 'root' })
export class HotelBookingService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/hospitality`;

  private headers(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  search(query: HotelSearchQuery): Observable<HotelSearchResult> {
    const params = new HttpParams()
      .set('arrival_date', query.arrival_date)
      .set('departure_date', query.departure_date)
      .set('adults', query.adults)
      .set('children', query.children);
    return this.http
      .get<{ data: HotelSearchResult }>(`${this.apiUrl}/search`, { headers: this.headers(), params })
      .pipe(map((r) => r.data));
  }

  createHold(body: {
    unit_type_id: number;
    arrival_date: string;
    departure_date: string;
    adults: number;
    children: number;
    notes?: string;
  }): Observable<HotelHold> {
    return this.http
      .post<{ data: HotelHold }>(
        `${this.apiUrl}/holds`,
        { ...body, return_url: `${window.location.origin}/hotel/reserva` },
        { headers: this.headers() },
      )
      .pipe(map((r) => r.data));
  }

  getReservation(id: number): Observable<HotelReservation> {
    return this.http
      .get<{ data: HotelReservation }>(`${this.apiUrl}/reservations/${id}`, { headers: this.headers() })
      .pipe(map((r) => r.data));
  }
}
