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

export interface BankAccountOption {
  id: number;
  name: string | null;
  bank_name: string;
  account_number: string;
  image_url: string | null;
}

export interface BookingSelection {
  product_id: number;
  product_variant_id?: number;
  date: string;
  start_time: string;
  end_time: string;
  /**
   * Opcionales: cuando el cliente eligió proveedor en el flujo
   * `BookingComponent`, los propagamos para que el resumen del checkout
   * pueda mostrar quién lo va a atender sin obligarlo a re-picar.
   */
  provider_id?: number;
  provider_name?: string;
  /**
   * Modalidad de la reserva propagada desde `BookingComponent`:
   *   - `'shop'`: el cliente va al local del proveedor.
   *   - `'home'`: el proveedor va a la dirección del cliente.
   * Si el cliente eligió "a domicilio", `service_address_id` apunta a la
   * dirección snapshot usada para la reserva.
   */
  service_location_type?: 'shop' | 'home';
  service_address_id?: number;
  service_address_label?: string;
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
    /**
     * Presentación de venta elegida (`price_tiers.id`). Sin ella el backend
     * resuelve la presentación por defecto y el pedido sale al precio
     * unitario, no al del paquete que eligió el comprador.
     *
     * Viaja SIN riesgo dentro del `FormData`: `checkout()` serializa el
     * request COMPLETO con `JSON.stringify(request)` bajo la clave `data`, es
     * decir recorre el objeto genéricamente y no una lista fija de campos.
     */
    price_tier_id?: number;
  }>;
  guest_customer?: GuestCheckoutCustomer;
  /**
   * Optional coupon code typed by the customer. Backend validates against
   * {@link CouponsService.validate} and rejects the checkout if invalid.
   * The frontend NEVER sends precomputed totals.
   */
  coupon_code?: string;
  /**
   * ID de la cuenta bancaria destino para `bank_transfer`/`voucher`. Backend
   * resuelve y valida con `resolveAndValidateBankAccount`. Omitir (undefined)
   * para métodos que no requieren cuenta; pasar `null` explícito cuando el
   * usuario eligió un método con cuentas configuradas pero ninguna quedó
   * disponible.
   */
  bank_account_id?: number | null;
  /**
   * CP-tienda-checkout-whatsapp: `'whatsapp'` cuando la orden se finaliza con
   * "Finalizar por WhatsApp". Recorre el mismo núcleo del backend; solo el
   * post-éxito del frontend cambia (resumen + `wa.me` con automensaje).
   */
  channel?: 'ecommerce' | 'whatsapp';
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
  /**
   * CP-tienda-checkout-whatsapp: líneas de la orden creada (para el resumen y
   * el automensaje de WhatsApp, armados desde lo realmente comprado).
   */
  items?: Array<{
    name: string;
    variant_sku: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  channel?: 'ecommerce' | 'whatsapp';
}

// ELIMINADO en CP-tienda-checkout-whatsapp: `WhatsappCheckoutResponse` vivía
// para el POST directo a /whatsapp que el storefront ya no llama. La
// respuesta de `checkout()` (canal 'whatsapp') trae `items` + `channel`.

export interface DeliveryOption {
  method_id: number;
  method_name: string;
  delivery_type: 'pickup' | 'home_delivery' | 'other';
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

  /**
   * CP-tienda-checkout-whatsapp (C.2): tipos de entrega que la tienda expone,
   * para el paso 0 del checkout. Sin precios ni zonas (eso sigue en
   * `POST /shipping/calculate` vía `CartService.getShippingEstimates`).
   */
  getDeliveryOptions(): Observable<{
    success: boolean;
    data: DeliveryOption[];
  }> {
    return this.http.get<{ success: boolean; data: DeliveryOption[] }>(
      `${this.api_url}/delivery-options`,
      { headers: this.getHeaders() },
    );
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

  /**
   * Devuelve las cuentas bancarias activas configuradas para un método
   * `bank_transfer` / `voucher` del storefront. El endpoint usa
   * `@OptionalAuth()` y resuelve el tenant a partir del header `x-store-id`
   * que ya inyecta `getHeaders()` desde el `TenantFacade`.
   *
   * Devuelve `[]` cuando el tenant no tiene cuentas activas para ese método
   * Y la API devolvió un 2xx con cuerpo JSON válido. Si la respuesta NO es
   * JSON (típico cuando un vhost sirviendo la SPA contesta con el
   * `index.html` y status 200), lanza error ruidosamente — antes el bug era
   * tragar cualquier fallo como `[]` y el comprador terminaba con la lista
   * vacía sin error visible.
   */
  getBankAccountsForMethod(
    methodId: number,
  ): Observable<BankAccountOption[]> {
    return this.http
      .get<{ success: boolean; data: BankAccountOption[] }>(
        `${this.api_url}/payment-methods/${methodId}/bank-accounts`,
        { headers: this.getHeaders(), observe: 'response' },
      )
      .pipe(
        map((resp) => {
          const contentType = (resp.headers.get('Content-Type') ?? '').toLowerCase();
          if (!contentType.includes('application/json')) {
            throw new Error(
              `API devolvió Content-Type=${contentType || '(vacío)'} en lugar de JSON — probablemente el vhost sirvió el SPA en vez de la API`,
            );
          }
          const body = resp.body;
          if (
            !body ||
            body.success !== true ||
            !Array.isArray(body.data)
          ) {
            throw new Error(
              `API devolvió cuerpo JSON malformado: ${JSON.stringify(body).slice(0, 120)}`,
            );
          }
          return body.data;
        }),
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

  // `whatsappCheckout` eliminado en CP-tienda-checkout-whatsapp: "Finalizar
  // por WhatsApp" recorre `checkout()` con `channel='whatsapp'`. El endpoint
  // legacy `POST /whatsapp` sigue vivo en el backend por compatibilidad.
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
