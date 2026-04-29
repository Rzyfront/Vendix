import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  StoreSubscription,
  SubscriptionOverviewStats,
  ApiResponse,
} from '../interfaces/org-subscription.interface';

@Injectable({ providedIn: 'root' })
export class OrgSubscriptionsService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/organization/reseller/subscriptions${endpoint ? '/' + endpoint : ''}`;
  }

  getOverviewStats(): Observable<ApiResponse<SubscriptionOverviewStats>> {
    return this.http.get<ApiResponse<SubscriptionOverviewStats>>(this.getApiUrl('stats'));
  }

  getStoreSubscriptions(params?: Record<string, any>): Observable<ApiResponse<StoreSubscription[]>> {
    return this.http.get<ApiResponse<StoreSubscription[]>>(this.getApiUrl('stores'), { params });
  }

  getStoreSubscription(storeId: number): Observable<ApiResponse<StoreSubscription>> {
    return this.http.get<ApiResponse<StoreSubscription>>(this.getApiUrl(`stores/${storeId}`));
  }

  getInvoices(params?: Record<string, any>): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${environment.apiUrl}/store/subscriptions/current/invoices`, { params });
  }

  getInvoice(invoiceId: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${environment.apiUrl}/store/subscriptions/current/invoices/${invoiceId}`);
  }

  /**
   * S3.1 — PDF download wrapper for org-level UIs (re-uses the
   * store-scoped endpoint; the request context is resolved by domain).
   */
  downloadInvoicePdf(invoiceId: number): Observable<HttpResponse<Blob>> {
    return this.http.get(
      `${environment.apiUrl}/store/subscriptions/current/invoices/${invoiceId}/pdf`,
      { responseType: 'blob', observe: 'response' },
    );
  }

  getPlans(): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${environment.apiUrl}/store/subscriptions/plans`);
  }

  previewPlanChange(planId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${environment.apiUrl}/store/subscriptions/checkout/preview`, { planId });
  }

  commitPlanChange(planId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${environment.apiUrl}/store/subscriptions/checkout/commit`, { planId });
  }
}
