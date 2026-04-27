import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SubscriptionPlan,
  Invoice,
  CheckoutPreviewResponse,
  PaymentMethod,
  ApiResponse,
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

  checkoutPreview(planId: string | number): Observable<ApiResponse<CheckoutPreviewResponse>> {
    return this.http.post<ApiResponse<CheckoutPreviewResponse>>(
      this.getApiUrl('checkout/preview'),
      { planId: Number(planId) },
    );
  }

  checkoutCommit(
    planId: string | number,
    paymentMethodId?: string | number,
    returnUrl?: string,
  ): Observable<ApiResponse<any>> {
    const body: Record<string, number | string> = { planId: Number(planId) };
    if (paymentMethodId !== undefined && paymentMethodId !== null && paymentMethodId !== '') {
      body['paymentMethodId'] = Number(paymentMethodId);
    }
    if (returnUrl) {
      body['returnUrl'] = returnUrl;
    }
    return this.http.post<ApiResponse<any>>(this.getApiUrl('checkout/commit'), body);
  }

  getPaymentMethods(): Observable<ApiResponse<PaymentMethod[]>> {
    return this.http.get<ApiResponse<PaymentMethod[]>>(this.getApiUrl('payment-methods'));
  }

  addPaymentMethod(data: { type: string; token: string }): Observable<ApiResponse<PaymentMethod>> {
    return this.http.post<ApiResponse<PaymentMethod>>(this.getApiUrl('payment-methods'), data);
  }

  removePaymentMethod(id: string): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(this.getApiUrl(`payment-methods/${id}`));
  }

  setDefaultPaymentMethod(id: string): Observable<ApiResponse<PaymentMethod>> {
    return this.http.put<ApiResponse<PaymentMethod>>(this.getApiUrl(`payment-methods/${id}/default`), {});
  }
}
