import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  StoreSubscription,
  SubscriptionOverviewStats,
  ApiResponse,
} from '../interfaces/org-subscription.interface';

/**
 * Org-level subscriptions service. After Phase 2 of the operating-scope
 * consolidation every endpoint lives under `/organization/subscriptions/`
 * (Rule Zero: ORG_ADMIN tokens never call store routes). The DomainScopeGuard
 * on the backend rejects cross-domain calls with 403, so any leftover
 * legacy URL would break ORG_ADMIN flows after deploy.
 */
@Injectable({ providedIn: 'root' })
export class OrgSubscriptionsService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/organization/subscriptions${endpoint ? '/' + endpoint : ''}`;
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
    return this.http.get<ApiResponse<any>>(this.getApiUrl('invoices'), { params });
  }

  getInvoice(invoiceId: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(this.getApiUrl(`invoices/${invoiceId}`));
  }

  /**
   * Streams the invoice PDF. The endpoint validates that the invoice belongs
   * to a store of the organization in context before rendering.
   */
  downloadInvoicePdf(invoiceId: number): Observable<HttpResponse<Blob>> {
    return this.http.get(this.getApiUrl(`invoices/${invoiceId}/pdf`), {
      responseType: 'blob',
      observe: 'response',
    });
  }

  /**
   * Plan catalogue applies the org's partner overrides (if any). When
   * `storeId` is provided, plans are flagged with `is_current` against that
   * store's subscription.
   */
  getPlans(storeId?: number): Observable<ApiResponse<any>> {
    const params: Record<string, any> = {};
    if (storeId != null) params['store_id'] = storeId;
    return this.http.get<ApiResponse<any>>(this.getApiUrl('plans'), { params });
  }

  previewPlanChange(storeId: number, planId: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(this.getApiUrl('checkout/preview'), {
      storeId,
      planId,
    });
  }

  commitPlanChange(
    storeId: number,
    planId: number,
    options?: {
      no_refund_acknowledged?: boolean;
      no_refund_acknowledged_at?: string;
      coupon_code?: string;
      returnUrl?: string;
    },
  ): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(this.getApiUrl('checkout/commit'), {
      storeId,
      planId,
      no_refund_acknowledged: options?.no_refund_acknowledged ?? true,
      no_refund_acknowledged_at:
        options?.no_refund_acknowledged_at ?? new Date().toISOString(),
      coupon_code: options?.coupon_code,
      returnUrl: options?.returnUrl,
    });
  }
}
