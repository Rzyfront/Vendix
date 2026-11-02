import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ProductPageCustomDomain,
  StoreAppDetailResponse,
  StoreAppsResponse,
} from '../interfaces/store-app.interface';

/**
 * Client of the Apps catalog (`GET /store/apps`, permission `store:apps:read`)
 * and of the product page (Fase 2), service page (Fase 3) and booking (Fase 4) activation
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
}
