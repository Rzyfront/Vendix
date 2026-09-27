import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

/**
 * Normalized address shape returned by the backend reverse-geocoding proxy.
 * Every field is nullable because the upstream provider may not resolve all
 * components for a given coordinate.
 */
export interface NormalizedAddress {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  country_code: string | null;
  postal_code: string | null;
  /** DIVIPOLA/DANE municipality code (Colombia). Optional, provider-dependent. */
  municipality_code: string | null;
}

/**
 * Forward-geocoding result (free-text address → coordinate). `lat`/`lng` are
 * null when the backend could not resolve the query.
 */
export interface ForwardGeocodeResult {
  lat: number | null;
  lng: number | null;
}

/**
 * Reverse-geocoding client. Calls ONLY our own backend proxy
 * (`GET /ecommerce/geocoding/reverse`), never a third-party geocoder directly,
 * so the API key and rate-limiting stay server-side.
 */
@Injectable({ providedIn: 'root' })
export class GeocodingService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly api_url = `${environment.apiUrl}/ecommerce/geocoding`;

  private getHeaders(): HttpHeaders {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  /**
   * Resolves a normalized address for the given coordinate. Tolerates both a
   * bare payload and a `{ success, data }` envelope so it stays compatible with
   * however the backend proxy wraps its response.
   */
  reverse(lat: number, lng: number): Observable<NormalizedAddress> {
    const params = new HttpParams()
      .set('lat', String(lat))
      .set('lng', String(lng));

    return this.http
      .get<{ success: boolean; data: NormalizedAddress } | NormalizedAddress>(
        `${this.api_url}/reverse`,
        { headers: this.getHeaders(), params },
      )
      .pipe(
        map((res) => {
          const payload =
            res && typeof res === 'object' && 'data' in res
              ? (res as { data: NormalizedAddress }).data
              : (res as NormalizedAddress);
          return payload;
        }),
      );
  }

  /**
   * Resolves a coordinate for a free-text address (Colombia-biased) so the map
   * can center on what the customer typed. Calls ONLY our backend proxy
   * (`GET /ecommerce/geocoding/forward`). Emits `{ lat: null, lng: null }` when
   * nothing matched — callers just leave the map where it is.
   *
   * `opts.city`/`opts.state` are OPTIONAL and purely additive: when the
   * caller already knows the city/department (e.g. from a selected
   * dropdown), pass them so the backend skips parsing them out of `query` by
   * splitting on commas — which breaks when the free-text address itself
   * contains a comma (e.g. "Calle 70, apto 4-83"). Omitting them keeps the
   * previous behavior unchanged (backward-compatible).
   */
  forward(
    query: string,
    opts?: { city?: string; state?: string },
  ): Observable<ForwardGeocodeResult> {
    let params = new HttpParams().set('q', query);
    if (opts?.city) params = params.set('city', opts.city);
    if (opts?.state) params = params.set('state', opts.state);

    return this.http
      .get<
        { success: boolean; data: ForwardGeocodeResult } | ForwardGeocodeResult
      >(`${this.api_url}/forward`, { headers: this.getHeaders(), params })
      .pipe(
        map((res) => {
          const payload =
            res && typeof res === 'object' && 'data' in res
              ? (res as { data: ForwardGeocodeResult }).data
              : (res as ForwardGeocodeResult);
          return payload;
        }),
      );
  }
}
