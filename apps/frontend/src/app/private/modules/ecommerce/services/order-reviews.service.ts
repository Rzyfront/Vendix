import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';
import {
  CreateOrderProductReviewDto,
  CreateOrderReviewDto,
  OrderReview,
  OrderReviewStatus,
} from '../models/order-review.model';

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * Reseñas de la experiencia de compra y de productos desde el resumen del
 * pedido. Dos modos: por token público (guest) o por orderId (cuenta, JWT).
 */
@Injectable({ providedIn: 'root' })
export class OrderReviewsService {
  private readonly http = inject(HttpClient);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly apiUrl = `${environment.apiUrl}/ecommerce/order-reviews`;

  private getHeaders(): HttpHeaders {
    const storeId = this.tenantFacade.getCurrentDomainConfig()?.store_id;
    return new HttpHeaders({ 'x-store-id': storeId?.toString() || '' });
  }

  private get<T>(url: string): Observable<T> {
    return this.http
      .get<Envelope<T>>(url, { headers: this.getHeaders() })
      .pipe(map((res) => res.data));
  }

  private post<T>(url: string, body: unknown): Observable<T> {
    return this.http
      .post<Envelope<T>>(url, body, { headers: this.getHeaders() })
      .pipe(map((res) => res.data));
  }

  getStatusByToken(token: string): Observable<OrderReviewStatus> {
    return this.get(`${this.apiUrl}/by-token/${encodeURIComponent(token)}`);
  }

  createByToken(token: string, dto: CreateOrderReviewDto): Observable<OrderReview> {
    return this.post(`${this.apiUrl}/by-token/${encodeURIComponent(token)}`, dto);
  }

  createProductReviewByToken(
    token: string,
    dto: CreateOrderProductReviewDto,
  ): Observable<unknown> {
    return this.post(
      `${this.apiUrl}/by-token/${encodeURIComponent(token)}/products`,
      dto,
    );
  }

  getStatusByOrder(orderId: number): Observable<OrderReviewStatus> {
    return this.get(`${this.apiUrl}/orders/${orderId}`);
  }

  createByOrder(orderId: number, dto: CreateOrderReviewDto): Observable<OrderReview> {
    return this.post(`${this.apiUrl}/orders/${orderId}`, dto);
  }

  createProductReviewByOrder(
    orderId: number,
    dto: CreateOrderProductReviewDto,
  ): Observable<unknown> {
    return this.post(`${this.apiUrl}/orders/${orderId}/products`, dto);
  }
}
