import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  ServiceRegistryQuery,
  ServiceRegistryResponse,
  ServiceRegistryRow,
  ServiceRegistryRowRef,
} from './service-registry.interfaces';

@Injectable({ providedIn: 'root' })
export class ServiceRegistryService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/service-reminders/registry`;

  list(query: ServiceRegistryQuery): Observable<ServiceRegistryResponse> {
    let params = new HttpParams()
      .set('filter', query.filter)
      .set('page', String(query.page))
      .set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    return this.http.get<ServiceRegistryResponse>(this.base, { params });
  }

  sendEmail(row: ServiceRegistryRow): Observable<{ success: boolean; message: string }> {
    return this.http
      .post<{ data: { success: boolean; message: string } }>(`${this.base}/email`, this.ref(row))
      .pipe(map((res) => res.data));
  }

  /** `phone` solo cuando el cliente no tiene teléfono guardado (queda en su perfil). */
  whatsapp(row: ServiceRegistryRow, phone?: string): Observable<{ url: string; message: string }> {
    return this.http
      .post<{ data: { url: string; message: string } }>(`${this.base}/whatsapp`, { ...this.ref(row), ...(phone ? { phone } : {}) })
      .pipe(map((res) => res.data));
  }

  /** Vincula un cliente registrado a una atención hecha sin cliente (solo si no tenía). */
  assignCustomer(row: ServiceRegistryRow, customerId: number): Observable<{ success: boolean }> {
    return this.assignCustomerToOrder(row.source_order_id, row.service.id, customerId);
  }

  /** Igual que `assignCustomer`, desde una atención recién cerrada (orden SVC + servicio). */
  assignCustomerToOrder(sourceOrderId: number, productId: number, customerId: number): Observable<{ success: boolean }> {
    return this.http
      .post<{ data: { success: boolean } }>(`${this.base}/assign-customer`, {
        source_order_id: sourceOrderId,
        product_id: productId,
        customer_id: customerId,
      })
      .pipe(map((res) => res.data));
  }

  dismiss(row: ServiceRegistryRow): Observable<{ success: boolean }> {
    return this.http
      .post<{ data: { success: boolean } }>(`${this.base}/dismiss`, this.ref(row))
      .pipe(map((res) => res.data));
  }

  private ref(row: ServiceRegistryRow): ServiceRegistryRowRef {
    return { source_order_id: row.source_order_id, product_id: row.service.id };
  }
}
