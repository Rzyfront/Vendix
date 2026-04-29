import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SubscriptionPlan,
  Invoice,
  CheckoutPreviewResponse,
  PaymentMethod,
  PaymentMethodCharge,
  ApiResponse,
  CouponValidationResponse,
  SubscriptionTimelineEvent,
} from '../interfaces/store-subscription.interface';

@Injectable({ providedIn: 'root' })
export class StoreSubscriptionService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/subscriptions${endpoint ? '/' + endpoint : ''}`;
  }

  getPlans(): Observable<ApiResponse<SubscriptionPlan[]>> {
    return this.http.get<ApiResponse<SubscriptionPlan[]>>(this.getApiUrl('plans'));
  }

  getInvoices(params?: Record<string, any>): Observable<ApiResponse<Invoice[]>> {
    return this.http.get<ApiResponse<Invoice[]>>(this.getApiUrl('current/invoices'), { params });
  }

  /**
   * S3.1 — Downloads the SaaS invoice as PDF.
   * Backend endpoint: GET /store/subscriptions/current/invoices/:id/pdf
   * Bypasses the subscription gate so suspended customers can still
   * retrieve historical invoices.
   */
  downloadInvoicePdf(
    invoiceId: string | number,
  ): Observable<HttpResponse<Blob>> {
    return this.http.get(this.getApiUrl(`current/invoices/${invoiceId}/pdf`), {
      responseType: 'blob',
      observe: 'response',
    });
  }

  /**
   * S3.3 — Timeline de eventos de subscripción del cliente.
   * Cursor-based pagination. El backend NO expone `triggered_by_user_id`.
   */
  getEventsTimeline(opts?: {
    limit?: number;
    cursor?: string;
    type?: string;
  }): Observable<
    ApiResponse<{ data: SubscriptionTimelineEvent[]; next_cursor: string | null }>
  > {
    const params: Record<string, string> = {};
    if (opts?.limit !== undefined) params['limit'] = String(opts.limit);
    if (opts?.cursor) params['cursor'] = opts.cursor;
    if (opts?.type) params['type'] = opts.type;
    return this.http.get<
      ApiResponse<{ data: SubscriptionTimelineEvent[]; next_cursor: string | null }>
    >(this.getApiUrl('current/events'), { params });
  }

  /**
   * Retrieves the full detail for a single SaaS invoice.
   * Backend endpoint: GET /store/subscriptions/current/invoices/:invoiceId
   *
   * The backend currently returns the raw subscription_invoices record
   * (line_items + split_breakdown as JSON). Payments are not yet eagerly
   * included — see TODO(G5-backend) in saas-invoice-detail.component.ts.
   */
  getInvoice(invoiceId: string | number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(this.getApiUrl(`current/invoices/${invoiceId}`));
  }

  checkoutPreview(
    planId: string | number,
    couponCode?: string,
  ): Observable<ApiResponse<CheckoutPreviewResponse>> {
    const body: Record<string, number | string> = { planId: Number(planId) };
    if (couponCode && couponCode.trim()) {
      body['coupon_code'] = couponCode.trim();
    }
    return this.http.post<ApiResponse<CheckoutPreviewResponse>>(
      this.getApiUrl('checkout/preview'),
      body,
    );
  }

  checkoutCommit(
    planId: string | number,
    paymentMethodId?: string | number,
    returnUrl?: string,
    noRefundAcknowledged: boolean = false,
    noRefundAcknowledgedAt?: string,
    couponCode?: string,
  ): Observable<ApiResponse<any>> {
    const body: Record<string, number | string | boolean> = {
      planId: Number(planId),
      // G8 — backend valida y persiste en subscription_invoices.metadata.
      no_refund_acknowledged: noRefundAcknowledged,
    };
    if (paymentMethodId !== undefined && paymentMethodId !== null && paymentMethodId !== '') {
      body['paymentMethodId'] = Number(paymentMethodId);
    }
    if (returnUrl) {
      body['returnUrl'] = returnUrl;
    }
    if (noRefundAcknowledgedAt) {
      body['no_refund_acknowledged_at'] = noRefundAcknowledgedAt;
    }
    // S2.1 — Optional redemption code. Backend re-validates and applies the
    // overlay on success.
    if (couponCode && couponCode.trim()) {
      body['coupon_code'] = couponCode.trim();
    }
    return this.http.post<ApiResponse<any>>(this.getApiUrl('checkout/commit'), body);
  }

  /**
   * S2.1 — Validate a redemption code against the current store. Returns
   * `{ valid, reason?, plan?, overlay_features?, duration_days?, expires_at? }`.
   */
  validateCoupon(code: string): Observable<ApiResponse<CouponValidationResponse>> {
    return this.http.post<ApiResponse<CouponValidationResponse>>(
      this.getApiUrl('checkout/validate-coupon'),
      { code },
    );
  }

  getPaymentMethods(): Observable<ApiResponse<PaymentMethod[]>> {
    return this.http.get<ApiResponse<PaymentMethod[]>>(this.getApiUrl('payment-methods'));
  }

  getPaymentMethodWidgetConfig(): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(this.getApiUrl('payment-methods/widget-config'));
  }

  addPaymentMethod(data: {
    provider_token: string;
    type?: string;
    last4?: string;
    brand?: string;
    expiry_month?: string;
    expiry_year?: string;
    card_holder?: string;
    is_default?: boolean;
  }): Observable<ApiResponse<PaymentMethod>> {
    return this.http.post<ApiResponse<PaymentMethod>>(this.getApiUrl('payment-methods/tokenize'), data);
  }

  removePaymentMethod(id: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`payment-methods/${id}`));
  }

  setDefaultPaymentMethod(id: string): Observable<ApiResponse<PaymentMethod>> {
    return this.http.put<ApiResponse<PaymentMethod>>(this.getApiUrl(`payment-methods/${id}/default`), {});
  }

  /**
   * S3.2 — Retrieve the last N (default 5) charge attempts executed
   * against a specific saved payment method. Used by the "Configurar"
   * modal to surface recent activity (succeeded / failed + reason).
   */
  getPaymentMethodCharges(
    id: string,
    limit = 5,
  ): Observable<ApiResponse<PaymentMethodCharge[]>> {
    return this.http.get<ApiResponse<PaymentMethodCharge[]>>(
      this.getApiUrl(`payment-methods/${id}/charges`),
      { params: { limit: String(limit) } },
    );
  }

  /**
   * G11 — Replace a tokenized payment method (soft-delete old, create new).
   * Backend transfers the `is_default` flag and audits the replacement.
   */
  replacePaymentMethod(
    id: string,
    data: {
      provider_token: string;
      type?: string;
      last4?: string;
      brand?: string;
      expiry_month?: string;
      expiry_year?: string;
      card_holder?: string;
      is_default?: boolean;
    },
  ): Observable<ApiResponse<PaymentMethod>> {
    return this.http.post<ApiResponse<PaymentMethod>>(
      this.getApiUrl(`payment-methods/${id}/replace`),
      data,
    );
  }
}
