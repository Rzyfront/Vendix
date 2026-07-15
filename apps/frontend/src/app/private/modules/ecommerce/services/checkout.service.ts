import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export interface PaymentMethod {
  id: number;
  name: string;
  type: string;
  provider: string;
  processing_mode: 'DIRECT' | 'ONLINE' | 'ON_DELIVERY';
  logo_url: string | null;
  min_amount: number | null;
  max_amount: number | null;
  payment_instructions?: {
    bank_name?: string;
    account_holder?: string;
    account_number?: string;
    account_type?: string;
    instructions?: string;
    voucher_instructions?: string;
    redemption_phone?: string;
    notes?: string;
  };
}

export interface BookingSelection {
  product_id: number;
  product_variant_id?: number;
  date: string;
  start_time: string;
  end_time: string;
}

export interface GuestCheckoutCustomer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  document_type?: string;
  document_number?: string;
}

export interface CheckoutShippingAddress {
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province?: string;
  country_code: string;
  postal_code?: string;
  phone_number?: string;
  /** Exact GPS coordinates captured via the map picker (opt-in). */
  latitude?: number | null;
  longitude?: number | null;
}

export interface CheckoutRequest {
  shipping_address_id?: number;
  shipping_address?: CheckoutShippingAddress;
  shipping_method_id?: number;
  shipping_rate_id?: number;
  payment_method_id: number;
  notes?: string;
  bookings?: BookingSelection[];
  items?: Array<{
    product_id: number;
    product_variant_id?: number;
    quantity: number;
  }>;
  guest_customer?: GuestCheckoutCustomer;
  /**
   * Optional coupon code typed by the customer. Backend validates against
   * {@link CouponsService.validate} and rejects the checkout if invalid.
   * The frontend NEVER sends precomputed totals.
   */
  coupon_code?: string;
}

export interface CheckoutResponse {
  order_id: number;
  order_number: string;
  total: number;
  state: string;
  message: string;
  public_order_token?: string | null;
  invoice_data_token?: string | null;
  invoice_id?: number | null;
  // Backend-authoritative totals — the frontend renders these instead of
  // recomputing on its own to avoid drift.
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  promotion_discount?: number;
  coupon_discount?: number;
  shipping_cost?: number;
}

export interface WhatsappCheckoutResponse extends CheckoutResponse {
  subtotal: number;
  tax: number;
  // Detailed discount totals so the WhatsApp UI surfaces promos + coupons
  // and the message can include the final price the customer will pay.
  discount_amount?: number;
  promotion_discount?: number;
  coupon_discount?: number;
  shipping_cost?: number;
  item_count: number;
  items: Array<{
    name: string;
    variant_sku: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  customer?: {
    first_name: string;
    last_name: string;
    phone: string | null;
    email?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    address: {
      address_line1: string;
      address_line2: string | null;
      city: string;
      state_province: string | null;
      country_code: string;
      postal_code: string | null;
      phone_number: string | null;
    } | null;
  } | null;
}

export interface WompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  acceptance_token: string;
  accept_personal_auth: string;
  customer_email: string;
}

export interface ConfirmWompiPaymentResponse {
  state: string;
  orderState: string;
  transactionId: string | null;
  alreadyConfirmed: boolean;
  message?: string;
}

export interface CheckoutEligibility {
  invoicing_enabled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class CheckoutService {
  private api_url = `${environment.apiUrl}/ecommerce/checkout`;
  private eligibility$: Observable<CheckoutEligibility> | null = null;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
  ) {}

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  getPaymentMethods(
    shippingType?: string,
  ): Observable<{ success: boolean; data: PaymentMethod[] }> {
    let params: { [key: string]: string } = {};
    if (shippingType) {
      params['shipping_type'] = shippingType;
    }
    return this.http.get<{ success: boolean; data: PaymentMethod[] }>(
      `${this.api_url}/payment-methods`,
      { headers: this.getHeaders(), params },
    );
  }

  checkout(
    request: CheckoutRequest,
    file?: File | null,
  ): Observable<{ success: boolean; data: CheckoutResponse }> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(request));
    if (file) {
      formData.append('file', file);
    }
    // NOTE: do not set Content-Type manually — the browser sets the
    // multipart boundary automatically.
    return this.http.post<{ success: boolean; data: CheckoutResponse }>(
      this.api_url,
      formData,
      { headers: this.getHeaders() },
    );
  }

  prepareWompiPayment(
    orderId: number,
    amount: number,
    customerEmail?: string,
    redirectUrl?: string,
    publicOrderToken?: string | null,
  ): Observable<{ success: boolean; data: WompiWidgetConfig }> {
    return this.http.post<{ success: boolean; data: WompiWidgetConfig }>(
      `${this.api_url}/prepare-wompi`,
      {
        order_id: orderId,
        amount,
        customer_email: customerEmail || '',
        redirect_url: redirectUrl || `${window.location.origin}/account/orders`,
        public_order_token: publicOrderToken || undefined,
      },
      { headers: this.getHeaders() },
    );
  }

  /**
   * Force-confirm a Wompi payment by polling the gateway. Called from the
   * Wompi widget callback so the user sees the right order state on return
   * instead of waiting for the webhook to land. Failure here MUST NOT block
   * the navigation flow — the webhook is the canonical fallback.
   */
  confirmWompiPayment(
    orderId: number,
    publicOrderToken?: string | null,
  ): Observable<{ success: boolean; data: ConfirmWompiPaymentResponse }> {
    return this.http.post<{
      success: boolean;
      data: ConfirmWompiPaymentResponse;
    }>(
      `${this.api_url}/confirm-wompi-payment/${orderId}`,
      { public_order_token: publicOrderToken || undefined },
      { headers: this.getHeaders() },
    );
  }

  whatsappCheckout(
    notes?: string,
    items?: Array<{
      product_id: number;
      product_variant_id?: number;
      quantity: number;
    }>,
    guestCustomer?: GuestCheckoutCustomer | null,
    shippingAddress?: CheckoutShippingAddress | null,
    couponCode?: string | null,
  ): Observable<{ success: boolean; data: WhatsappCheckoutResponse }> {
    return this.http.post<{ success: boolean; data: WhatsappCheckoutResponse }>(
      `${this.api_url}/whatsapp`,
      {
        notes,
        items,
        guest_customer: guestCustomer,
        shipping_address: shippingAddress,
        coupon_code: couponCode || undefined,
      },
      { headers: this.getHeaders() },
    );
  }

  getGuestOrderSummary(
    token: string,
  ): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(
      `${environment.apiUrl}/ecommerce/invoice-data/${token}/order-summary`,
      { headers: this.getHeaders() },
    );
  }

  getInvoicingEligibility(): Observable<CheckoutEligibility> {
    if (!this.eligibility$) {
      this.eligibility$ = this.http
        .get<{ success: boolean; data: CheckoutEligibility }>(
          `${this.api_url}/eligibility`,
          { headers: this.getHeaders() },
        )
        .pipe(
          map((r) => r.data),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.eligibility$;
  }
}
