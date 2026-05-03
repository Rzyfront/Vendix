import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
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
}

export interface WhatsappCheckoutResponse extends CheckoutResponse {
  subtotal: number;
  tax: number;
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

@Injectable({
  providedIn: 'root',
})
export class CheckoutService {
  private api_url = `${environment.apiUrl}/ecommerce/checkout`;

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
  ): Observable<{ success: boolean; data: CheckoutResponse }> {
    return this.http.post<{ success: boolean; data: CheckoutResponse }>(
      this.api_url,
      request,
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
  ): Observable<{ success: boolean; data: ConfirmWompiPaymentResponse }> {
    return this.http.post<{
      success: boolean;
      data: ConfirmWompiPaymentResponse;
    }>(
      `${this.api_url}/confirm-wompi-payment/${orderId}`,
      {},
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
  ): Observable<{ success: boolean; data: WhatsappCheckoutResponse }> {
    return this.http.post<{ success: boolean; data: WhatsappCheckoutResponse }>(
      `${this.api_url}/whatsapp`,
      {
        notes,
        items,
        guest_customer: guestCustomer,
        shipping_address: shippingAddress,
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
}
