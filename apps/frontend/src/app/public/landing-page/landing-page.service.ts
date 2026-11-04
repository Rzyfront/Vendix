import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../../core/store';
import type { CrmContactPayload } from '../dynamic-landing/services/crm-landing.service';

/** Offer of the landing on its own domain (`GET /ecommerce/landing-page`). */
export interface LandingOffer {
  /** `info` only captures the lead; `product` sells one product. */
  mode: 'info' | 'product';
  title: string;
  description: string | null;
  product: { id: number; slug: string; name: string } | null;
}

export interface LandingPagePublic {
  /** Hostname of the landing's own domain; the offer shows only there. */
  hostname: string;
  /** Apps F5: the landing's own domain plus its aliases (lowercase). */
  hostnames?: string[];
  offer: LandingOffer;
}

export interface LandingLeadResponse {
  success: boolean;
  message?: string;
  data: {
    customer_created: boolean;
    customer_id: number | null;
    opportunity_id: number | null;
  };
}

/**
 * True when the browser is on the landing's own domain. The store's primary
 * `{tienda}-store` domain also renders the landing (`STORE_LANDING`) and must
 * stay as it is: no offer, same contact endpoint as before.
 */
export function isOwnLandingHost(page: LandingPagePublic | null, host: string): boolean {
  if (!page) return false;
  const target = host.toLowerCase();
  const hosts = page.hostnames?.length ? page.hostnames : [page.hostname];
  return hosts.some((h) => h.toLowerCase() === target);
}

/**
 * Apps · landing page (Fase 6), public side. Reads the published landing of
 * the store resolved from the domain and posts its leads. The landing content
 * itself still comes from `CrmLandingService` (`/ecommerce/crm/landing`).
 */
@Injectable({ providedIn: 'root' })
export class LandingPageService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly base = `${environment.apiUrl}/ecommerce/landing-page`;

  /**
   * The landing app when this page is its own domain; `null` anywhere else
   * (including `{tienda}-store`), `undefined` while loading.
   */
  readonly ownPage = signal<LandingPagePublic | null | undefined>(undefined);

  private request$: Observable<LandingPagePublic | null> | null = null;

  load(): Observable<LandingPagePublic | null> {
    if (!this.request$) {
      const host = this.isBrowser ? window.location.hostname : '';
      this.request$ = this.http
        .get<{ data: LandingPagePublic }>(this.base, { headers: this.headers() })
        .pipe(
          map((res) => res.data ?? null),
          catchError(() => of(null)),
          map((page) => (isOwnLandingHost(page, host) ? page : null)),
          tap((page) => this.ownPage.set(page)),
          shareReplay(1),
        );
    }
    return this.request$;
  }

  submitLead(payload: CrmContactPayload): Observable<LandingLeadResponse> {
    return this.http.post<LandingLeadResponse>(`${this.base}/lead`, payload, {
      headers: this.headers(),
    });
  }

  private headers(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders(storeId ? { 'x-store-id': String(storeId) } : {});
  }
}
