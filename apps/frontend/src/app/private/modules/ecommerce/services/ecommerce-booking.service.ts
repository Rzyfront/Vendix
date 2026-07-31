import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
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
  product_variant_id?: number;
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
  checked_in_at: string | null;
  confirmation_requested_at: string | null;
  data_collection_submissions?: { id: number; token: string; status: string }[];
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

  /**
   * Returns the authenticated customer's saved addresses (sorted by
   * is_primary DESC). Used by the booking flow to show when the customer
   * picks "A domicilio".
   */
  getCustomerAddresses(): Observable<any[]> {
    return this.http
      .get<any>(`${this.api_url}/customer/addresses`, { headers: this.getHeaders() })
      .pipe(map((r) => r?.data ?? r ?? []));
  }

  /**
   * Returns the store's primary address (the technician's local) for
   * the "En el local" option in the booking flow.
   *
   * Returns `null` when the store has no address. The previous
   * implementation used `r?.data ?? r ?? null`, which returned the
   * wrapper object `{ success: true, data: null }` whenever `data`
   * was null — that truthy object bypassed the template's
   * `@if (storeAddress(); as addr)` guard and rendered the row
   * with empty fields.
   *
   * The endpoint is mounted at `/ecommerce/reservations/store/address`
   * (see `@Controller('ecommerce/reservations')` in the backend), NOT
   * at `/store/address`. Calling the latter returned 404 silently in
   * the browser console, which made the address appear "missing" even
   * though the backend endpoint was working fine.
   */
  getStoreAddress(): Observable<any | null> {
    return this.http
      .get<any>(`${this.api_url}/store/address`, { headers: this.getHeaders() })
      .pipe(map((r) => r?.data ?? null));
  }

  /**
   * Returns the store's service config (offer_home_service + local
   * address). Used by the booking flow to decide whether to render
   * the 'A domicilio' radio card.
   */
  getStoreServices(productId?: number): Observable<{
    offer_home_service: boolean;
    /**
     * Appointment redesign phase 2 — per-product home-service
     * eligibility. Only set when `productId` is passed; mirrors the
     * `offer_home_service_for_product` field returned by
     * `GET /ecommerce/store/services?product_id=...`. When the
     * product is not eligible, the selector hides the "A domicilio"
     * option even if the store globally offers it.
     */
    offer_home_service_for_product?: boolean;
    local_address: any | null;
  }> {
    let params = new HttpParams();
    if (productId) params = params.set('product_id', String(productId));
    return this.http
      .get<any>(`${this.api_url}/store/services`, {
        headers: this.getHeaders(),
        params,
      })
      .pipe(
        map((r) => {
          const data = r?.data ?? r ?? {};
          const offer = data.offer_home_service !== false;
          return {
            offer_home_service: offer,
            // Cuando no pasamos product_id, el backend no incluye
            // `offer_home_service_for_product`; caemos al global para
            // preservar la UX legacy (selector visible por default).
            offer_home_service_for_product:
              typeof data.offer_home_service_for_product === 'boolean'
                ? data.offer_home_service_for_product
                : offer,
            local_address: data.local_address ?? null,
          };
        }),
      );
  }

  /**
   * Creates a new address for the authenticated customer. The new row
   * is auto-linked to the customer's user_id on the backend.
   */
  createCustomerAddress(dto: {
    address_line1: string;
    address_line2?: string;
    city: string;
    state_province?: string;
    country_code: string;
    postal_code?: string;
    phone_number?: string;
    is_primary?: boolean;
  }): Observable<any> {
    return this.http
      .post<any>(`${this.api_url}/customer/addresses`, dto, { headers: this.getHeaders() })
      .pipe(map((r) => r?.data ?? r));
  }

  getAvailability(
    productId: number,
    dateFrom: string,
    dateTo: string,
    productVariantId?: number,
  ): Observable<{ success: boolean; data: AvailabilitySlot[] }> {
    let params = new HttpParams()
      .set('date_from', dateFrom)
      .set('date_to', dateTo);
    if (productVariantId) {
      params = params.set('product_variant_id', productVariantId.toString());
    }

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

  /**
   * Appointment redesign phase 2 — lista las solicitudes de reagenda
   * pendientes del customer autenticado. Útil para mostrar el badge
   * "Pendiente de aprobación" en las cards de reservas.
   */
  listMyRescheduleRequests(): Observable<any[]> {
    return this.http
      .get<{ success: boolean; data: any[] }>(
        `${this.api_url}/reschedule-requests/mine`,
        { headers: this.getHeaders() },
      )
      .pipe(map((res) => res.data ?? []));
  }

  /**
   * El customer cancela su propia solicitud pendiente.
   */
  cancelMyRescheduleRequest(reqId: number): Observable<any> {
    return this.http.delete<{ success: boolean; data: any }>(
      `${this.api_url}/reschedule-requests/${reqId}`,
      { headers: this.getHeaders() },
    );
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
