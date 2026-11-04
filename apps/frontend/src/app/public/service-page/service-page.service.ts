import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../../core/store';
import type { AppPageDocument } from '../../private/modules/store/apps/templates/app-page.types';

/** Public config of the store's service page (`GET /ecommerce/service-page`). */
export interface ServicePagePublicConfig {
  /** Every service the page lists: featured first, then by name. */
  service_ids: number[];
  featured_service_ids: number[];
  /** Secondary "también puedes comprar" block. */
  product_ids: number[];
  /** The owner's own page (apps-f2); absent when never saved. */
  page?: AppPageDocument;
}

/**
 * Reads the published service page of the store resolved from the domain.
 * Cached for the session: the layout and the list read the same config.
 */
@Injectable({ providedIn: 'root' })
export class ServicePageService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);

  /** `undefined` while loading, `null` when the store has no published page. */
  readonly config = signal<ServicePagePublicConfig | null | undefined>(undefined);

  private request$: Observable<ServicePagePublicConfig | null> | null = null;

  load(): Observable<ServicePagePublicConfig | null> {
    if (!this.request$) {
      const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
      const headers = new HttpHeaders(
        storeId ? { 'x-store-id': String(storeId) } : {},
      );
      this.request$ = this.http
        .get<{ data: ServicePagePublicConfig }>(
          `${environment.apiUrl}/ecommerce/service-page`,
          { headers },
        )
        .pipe(
          map((res) => res.data ?? null),
          catchError(() => of(null)),
          tap((config) => this.config.set(config)),
          shareReplay(1),
        );
    }
    return this.request$;
  }
}
