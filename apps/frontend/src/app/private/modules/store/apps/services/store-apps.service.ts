import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AppKind,
  ProductPageCustomDomain,
  StoreAppDetailResponse,
  StoreAppsResponse,
} from '../interfaces/store-app.interface';

/**
 * Client of the Apps catalog (`GET /store/apps`, permission `store:apps:read`)
 * and of the store home (Fase 5), product page (Fase 2), service page (Fase 3), booking (Fase 4) and landing page (Fase 6) activation
 * (`store:apps:manage`).
 */
@Injectable({ providedIn: 'root' })
export class StoreAppsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/apps`;

  list(): Observable<StoreAppsResponse> {
    return this.http.get<StoreAppsResponse>(this.apiUrl);
  }

  get(kind: string): Observable<StoreAppDetailResponse> {
    return this.http.get<StoreAppDetailResponse>(`${this.apiUrl}/${kind}`);
  }

  /** Switches an app on (`draft`); apps-vistas-f1 S3. */
  activate(kind: AppKind): Observable<StoreAppDetailResponse> {
    return this.http.post<StoreAppDetailResponse>(`${this.apiUrl}/${kind}/activate`, {});
  }

  /** Switches a draft app off (`disabled`); a published app is unpublished first. */
  deactivate(kind: AppKind): Observable<StoreAppDetailResponse> {
    return this.http.post<StoreAppDetailResponse>(`${this.apiUrl}/${kind}/deactivate`, {});
  }

  saveProductPageConfig(body: {
    product_id: number;
    complement_product_ids: number[];
  }): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/product_page/config`, body);
  }

  publishProductPage(customDomainId: number | null): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/product_page/publish`,
      customDomainId ? { custom_domain_id: customDomainId } : {},
    );
  }

  unpublishProductPage(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/product_page/unpublish`, {});
  }

  productPageCustomDomains(): Observable<{ data: ProductPageCustomDomain[] }> {
    return this.http.get<{ data: ProductPageCustomDomain[] }>(
      `${this.apiUrl}/product_page/custom-domains`,
    );
  }

  saveServicePageConfig(body: {
    featured_service_ids: number[];
    product_ids: number[];
  }): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/service_page/config`, body);
  }

  publishServicePage(customDomainId: number | null): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/service_page/publish`,
      customDomainId ? { custom_domain_id: customDomainId } : {},
    );
  }

  unpublishServicePage(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/service_page/unpublish`, {});
  }

  servicePageCustomDomains(): Observable<{ data: ProductPageCustomDomain[] }> {
    return this.http.get<{ data: ProductPageCustomDomain[] }>(
      `${this.apiUrl}/service_page/custom-domains`,
    );
  }

  saveBookingConfig(body: { product_ids: number[] }): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/booking/config`, body);
  }

  publishBooking(customDomainId: number | null): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/booking/publish`,
      customDomainId ? { custom_domain_id: customDomainId } : {},
    );
  }

  unpublishBooking(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/booking/unpublish`, {});
  }

  bookingCustomDomains(): Observable<{ data: ProductPageCustomDomain[] }> {
    return this.http.get<{ data: ProductPageCustomDomain[] }>(
      `${this.apiUrl}/booking/custom-domains`,
    );
  }

  saveStoreHomeConfig(body: { footer_text: string | null }): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/store-home/config`, body);
  }

  /** Switches the store's `{tienda}-store` domain to the store home. */
  publishStoreHome(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/store-home/publish`, {});
  }

  /** Gives `{tienda}-store` back the landing it served before. */
  unpublishStoreHome(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/store-home/unpublish`, {});
  }

  /** Offer of the landing page (Fase 6); its content is the CRM landing, edited in the same view. */
  saveLandingConfig(body: {
    offer_mode: 'info' | 'product';
    offer_title: string | null;
    offer_description: string | null;
    offer_product_id: number | null;
  }): Observable<unknown> {
    return this.http.patch(`${this.apiUrl}/landing/config`, body);
  }

  /** Puts the landing on `{tienda}-landing` or on one of the store's custom domains. */
  publishLanding(customDomainId: number | null): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/landing/publish`,
      customDomainId ? { custom_domain_id: customDomainId } : {},
    );
  }

  unpublishLanding(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/landing/unpublish`, {});
  }

  landingCustomDomains(): Observable<{ data: ProductPageCustomDomain[] }> {
    return this.http.get<{ data: ProductPageCustomDomain[] }>(
      `${this.apiUrl}/landing/custom-domains`,
    );
  }
}
