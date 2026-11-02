import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../../core/store';

/** Brand of the store home: store first, then organization (backend `store-home.reader.ts`). */
export interface StoreHomeBranding {
  name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
}

/** `GET /ecommerce/store-home`: only the brand and the footer, never products. */
export interface StoreHomePublic {
  store_name: string | null;
  branding: StoreHomeBranding;
  footer: { text: string; site_url: string };
}

/** Store home of the store resolved from the domain (Apps · STORE_HOME). */
@Injectable({ providedIn: 'root' })
export class StoreHomeService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/store-home`;

  /** `null` when the page cannot be read; the component falls back to the domain brand. */
  load(): Observable<StoreHomePublic | null> {
    const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
    return this.http
      .get<{ data: StoreHomePublic }>(this.apiUrl, {
        headers: new HttpHeaders(storeId ? { 'x-store-id': String(storeId) } : {}),
      })
      .pipe(
        map((res) => res.data ?? null),
        catchError(() => of(null)),
      );
  }
}
