import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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
  PayDueResponse,
} from '../interfaces/store-subscription.interface';
import { WompiWidgetConfig } from '../../../../../core/services/wompi-checkout.service';

/**
 * Phase 4 — Response shape for `POST /store/subscriptions/checkout/retry-payment`.
 * Backend returns the Wompi widget config plus the invoice metadata the user
 * is paying. Idempotent: re-calling does not duplicate the invoice; it
 * appends a new `payment` row with `attempt` incremented.
 */
export interface RetryPaymentResponse {
  widget: WompiWidgetConfig;
  invoice: { id: number; total: string; currency: string };
}

/**
 * Fiscal identity of the organization paying the subscription. Vendix issues an
 * electronic invoice for every charge, so this organization is the DIAN
 * *adquiriente* and these are the fields the invoice cannot be built without.
 *
 * `verification_digit` is read-only: the backend derives it from `tax_id`
 * (modulo-11 checksum), so the form never asks for it.
 */
export interface BillingProfileAddress {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state_province?: string | null;
  municipality_code: string;
  country_code?: string | null;
  postal_code?: string | null;
}

/**
 * De qué escalón de la cascada salió la dirección que el backend devuelve:
 * `fiscal` (una dirección `billing`/`legal` de la organización), `shipping`
 * (cualquier otra suya) o `store`. Se muestra en pantalla porque un respaldo
 * silencioso es cómo el checkout terminó pidiendo de nuevo una dirección que ya
 * estaba guardada.
 */
export type BillingAddressSource = 'fiscal' | 'shipping' | 'store';

/**
 * Dirección tal como el backend la DEVUELVE. Distinta del tipo de escritura:
 * una organización a medio configurar tiene fila de dirección sin municipio
 * DANE y sin departamento, así que acá esos campos son opcionales. Exigirlos en
 * la lectura sería describir un contrato que el servidor no cumple.
 */
export interface BillingProfileAddressRead {
  address_line1: string | null;
  address_line2?: string | null;
  city: string | null;
  state_province?: string | null;
  municipality_code?: string | null;
  country_code?: string | null;
  postal_code?: string | null;
}

export interface BillingProfile {
  legal_name: string;
  tax_id: string;
  document_type: string;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: string[] | null;
  email?: string | null;
  address: BillingProfileAddress;
}

export interface BillingProfileStatus {
  /**
   * Vendix emite factura electrónica real por las suscripciones (switch de
   * plataforma encendido y apuntando a producción). En falso, el checkout no
   * pide ni muestra datos fiscales: no habría documento que los llevara.
   */
  enabled: boolean;
  complete: boolean;
  /**
   * The organization already runs its own electronic invoicing, so this fiscal
   * identity is master data owned by the fiscal module. Checkout must show it
   * read-only; the backend drops any edit that arrives anyway.
   */
  locked: boolean;
  profile:
    | (Partial<Omit<BillingProfile, 'address'>> & {
        verification_digit?: string | null;
        address: BillingProfileAddressRead | null;
        /** Escalón del que salió `address`. `null` cuando no hay dirección. */
        address_source?: BillingAddressSource | null;
      })
    | null;
}

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

  /**
   * Fiscal identity Vendix already holds for this organization. Used by the
   * checkout to prefill the billing form and to skip it entirely for a
   * returning customer whose data is already complete.
   */
  getBillingProfile(): Observable<BillingProfileStatus> {
    return this.http
      .get<
        ApiResponse<BillingProfileStatus>
      >(this.getApiUrl('checkout/billing-profile'))
      .pipe(map((res) => res.data as BillingProfileStatus));
  }

  checkoutCommit(
    planId: string | number,
    paymentMethodId?: string | number,
    returnUrl?: string,
    noRefundAcknowledged: boolean = false,
    noRefundAcknowledgedAt?: string,
    couponCode?: string,
    billingProfile?: BillingProfile,
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
    // Only sent when the form actually collected it; a returning customer with
    // a complete profile commits without resending anything.
    const payload: Record<string, unknown> = { ...body };
    if (billingProfile) {
      payload['billing_profile'] = billingProfile;
    }
    return this.http.post<ApiResponse<any>>(
      this.getApiUrl('checkout/commit'),
      payload,
    );
  }

  /**
   * Phase 4 — Retry the payment for the current `pending_payment` invoice.
   * Backend returns a fresh Wompi widget config keyed to the same invoice;
   * idempotent across calls. Errors:
   *  - SUBSCRIPTION_001 (404) — no current subscription
   *  - SUBSCRIPTION_010 (409) — subscription not in pending_payment
   *  - DUNNING_001 (400) — no invoice to retry
   *  - SUBSCRIPTION_GATEWAY_003 (404) — no payment gateway configured
   */
  retryPayment(params?: {
    returnUrl?: string;
  }): Observable<RetryPaymentResponse> {
    const body: Record<string, string> = {};
    if (params?.returnUrl) body['returnUrl'] = params.returnUrl;
    return this.http
      .post<ApiResponse<RetryPaymentResponse>>(
        this.getApiUrl('checkout/retry-payment'),
        body,
      )
      .pipe(map((res) => res.data as RetryPaymentResponse));
  }

  /**
   * Paga directamente la factura pendiente de la suscripción (issued u overdue)
   * sin forzar el estado de la suscripción a `pending_payment`. Funciona en
   * active, grace_soft, grace_hard, suspended, etc.
   */
  payDue(params?: {
    invoiceId?: number;
    returnUrl?: string;
  }): Observable<PayDueResponse> {
    const body: Record<string, unknown> = {};
    if (params?.invoiceId) body['invoiceId'] = params.invoiceId;
    if (params?.returnUrl) body['returnUrl'] = params.returnUrl;
    return this.http
      .post<ApiResponse<PayDueResponse>>(
        this.getApiUrl('checkout/pay-due'),
        body,
      )
      .pipe(map((res) => res.data as PayDueResponse));
  }

  /**
   * Pull-fallback sync — Calls the backend's webhook safety net so the
   * subscription state machine closes the loop with Wompi even when the
   * Wompi webhook cannot reach the backend (localhost / NAT / outage).
   *
   * The polling loop calls this on every tick while the subscription is
   * still in `pending_payment`. Backend reuses its webhook handlers, so a
   * `paid` response is indistinguishable from a webhook-delivered success.
   *
   * Returns:
   *   - `paid`         → polling can stop, subscription will be active
   *   - `failed`       → polling can stop, surface error toast
   *   - `pending`      → keep polling (Wompi still authorizing)
   *   - `no_transaction` → no payment row found yet, keep polling
   */
  syncInvoiceFromGateway(
    invoiceId: number,
  ): Observable<
    ApiResponse<{
      status: 'paid' | 'failed' | 'pending' | 'no_transaction';
      already_paid?: boolean;
      transaction_id?: string;
      payment_status?: string;
    }>
  > {
    return this.http.post<
      ApiResponse<{
        status: 'paid' | 'failed' | 'pending' | 'no_transaction';
        already_paid?: boolean;
        transaction_id?: string;
        payment_status?: string;
      }>
    >(this.getApiUrl(`checkout/invoices/${invoiceId}/sync-from-gateway`), {});
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

  /**
   * Fase 4 (Wompi recurrent migration) — register a new tokenized card.
   *
   * Payload contract (mirrors backend `TokenizePaymentMethodDto`):
   *  - `card_token`: the `tok_*` from the Wompi widget
   *    (`transaction.payment_method.token`), NOT `transaction.id`.
   *  - `acceptance_token` + `personal_auth_token`: bit-exact strings the
   *    user accepted in the widget. Required by Wompi to register the
   *    card as a recurrent `payment_source` (COF).
   */
  addPaymentMethod(data: {
    card_token: string;
    acceptance_token: string;
    personal_auth_token: string;
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
   * RNC-24 — Send a support ticket from the dunning UI / paywall.
   * Backend endpoint: POST /store/subscriptions/support-request
   *
   * Backend validates that the subscription is in a dunning state
   * (grace_soft, grace_hard, suspended, blocked) and returns a `ticketId`.
   * Skipping the subscription gate is server-side (`@SkipSubscriptionGate`).
   */
  requestSupport(payload: {
    reason: string;
    message: string;
    contact_email?: string;
  }): Observable<ApiResponse<{ ticketId: number }>> {
    return this.http.post<ApiResponse<{ ticketId: number }>>(
      this.getApiUrl('support-request'),
      payload,
    );
  }

  /**
   * RNC-PaidPlan — Cancela un cambio de plan pendiente de pago.
   * Revierte pending_plan_id a null y anula el invoice pendiente.
   * Backend endpoint: DELETE /store/subscriptions/checkout/pending-change
   *
   * Errores esperados:
   *  - SUBSCRIPTION_001 (404) — no existe subscripción activa
   *  - SUBSCRIPTION_010 (409) — no hay cambio pendiente que cancelar
   */
  cancelPendingChange(): Observable<{ success: boolean; reverted_to_state: string }> {
    return this.http
      .delete<ApiResponse<{ success: boolean; reverted_to_state: string }>>(
        this.getApiUrl('checkout/pending-change'),
      )
      .pipe(map((res) => res.data as { success: boolean; reverted_to_state: string }));
  }

  /**
   * G11 — Replace a tokenized payment method (soft-delete old, create new).
   * Backend transfers the `is_default` flag and audits the replacement.
   */
  replacePaymentMethod(
    id: string,
    data: {
      card_token: string;
      acceptance_token: string;
      personal_auth_token: string;
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
