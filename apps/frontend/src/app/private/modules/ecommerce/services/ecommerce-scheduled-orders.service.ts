import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export type FulfillmentSlotBlockedReason =
  | 'lead_time'
  | 'too_far'
  | 'slot_full'
  | 'day_full'
  | null;

export interface FulfillmentSlot {
  /** ISO UTC; es lo que se envía en `schedule`. */
  start: string;
  end: string;
  local_start: string;
  local_end: string;
  capacity: number;
  taken: number;
  available: boolean;
  blocked_reason: FulfillmentSlotBlockedReason;
}

export interface FulfillmentDay {
  /** YYYY-MM-DD en la zona horaria de la tienda. */
  date: string;
  day_of_week: number;
  blocked_reason: 'day_blocked' | null;
  exception_reason?: string | null;
  day_capacity: number | null;
  day_taken: number;
  slots: FulfillmentSlot[];
}

/** Bloque `schedule` del checkout. */
export interface CheckoutSchedule {
  start: string;
  end: string;
  fulfillment_type?: 'pickup' | 'delivery';
}

@Injectable({ providedIn: 'root' })
export class EcommerceScheduledOrdersService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly api_url = `${environment.apiUrl}/ecommerce/scheduled-orders`;

  private headers(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  /**
   * Disponibilidad del rango. Devuelve `null` si el agendamiento está
   * apagado (SCHED_DISABLED) o falla la carga: el checkout no muestra el paso.
   */
  getAvailability(from: string, to: string): Observable<FulfillmentDay[] | null> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<{ data?: FulfillmentDay[] } | FulfillmentDay[]>(
        `${this.api_url}/availability`,
        { headers: this.headers(), params },
      )
      .pipe(
        map((res) => {
          const days = Array.isArray(res) ? res : res?.data;
          return Array.isArray(days) ? days : null;
        }),
        catchError(() => of(null)),
      );
  }
}
