import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { TenantFacade } from '../../core/store';
import type { AppPageDocument } from '../../private/modules/store/apps/templates/app-page.types';

/** Public config of the store's product page (`GET /ecommerce/product-page`). */
export interface ProductPagePublicConfig {
  product: { id: number; slug: string; name: string };
  complement_product_ids: number[];
  /** The owner's own page (apps-f2); absent when never saved. */
  page?: AppPageDocument;
}

/**
 * Reads the published product page of the store resolved from the domain.
 * The result is cached for the session: the root guard and the layout read
 * the same config, so the page costs one request.
 */
@Injectable({ providedIn: 'root' })
export class ProductPageService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);

  /** `undefined` while loading, `null` when the store has no published page. */
  readonly config = signal<ProductPagePublicConfig | null | undefined>(undefined);

  private request$: Observable<ProductPagePublicConfig | null> | null = null;

  load(): Observable<ProductPagePublicConfig | null> {
    if (!this.request$) {
      const storeId = this.tenant.getCurrentDomainConfig()?.store_id;
      const headers = new HttpHeaders(
        storeId ? { 'x-store-id': String(storeId) } : {},
      );
      this.request$ = this.http
        .get<{ data: ProductPagePublicConfig }>(
          `${environment.apiUrl}/ecommerce/product-page`,
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
