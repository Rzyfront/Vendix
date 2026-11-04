import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../../core/store';
import type { AppPageDocument } from '../../private/modules/store/apps/templates/app-page.types';

/** Public config of the store's booking page (`GET /ecommerce/booking-page`). */
export interface BookingPagePublicConfig {
  /** Secondary "para tu estadía" block: amenities and products. */
  product_ids: number[];
  /** The owner's own page (apps-f2); absent when never saved. */
  page?: AppPageDocument;
}

/** Backend `booking-checkin.ts`: what the page offers for the online check-in. */
export type OnlineCheckinState = 'available' | 'completed' | 'not_confirmed' | 'closed';

export interface OnlineCheckin {
  state: OnlineCheckinState;
  /** Relative path of the PMS check-in form (`/pre-registro/{token}`). */
  path: string | null;
  completed_at: string | null;
}

/**
 * Booking page of the store resolved from the domain (Apps · STORE_BOOKING).
 * Rooms, rates, availability, holds and the check-in form are the PMS
 * booking engine through `HotelBookingService`, unchanged; this service only
 * reads whether the page is published and the guest's check-in access.
 */
@Injectable({ providedIn: 'root' })
export class BookingPageService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/booking-page`;

  /** `undefined` while loading, `null` when the store has no published page. */
  readonly config = signal<BookingPagePublicConfig | null | undefined>(undefined);

  private request$: Observable<BookingPagePublicConfig | null> | null = null;

  load(): Observable<BookingPagePublicConfig | null> {
    if (!this.request$) {
      this.request$ = this.http
        .get<{ data: BookingPagePublicConfig }>(this.apiUrl, { headers: this.headers() })
        .pipe(
          map((res) => res.data ?? null),
          catchError(() => of(null)),
          tap((config) => this.config.set(config)),
          shareReplay(1),
        );
    }
    return this.request$;
  }

  /** The logged-in guest's online check-in access for one of their reservations. */
  checkin(reservationId: number): Observable<OnlineCheckin> {
    return this.http
      .get<{ data: OnlineCheckin }>(`${this.apiUrl}/reservations/${reservationId}/checkin`, {
        headers: this.headers(),
      })
      .pipe(map((res) => res.data));
  }

  private headers(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders(storeId ? { 'x-store-id': String(storeId) } : {});
  }
}
