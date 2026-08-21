import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { throwError, of } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  OrderStats,
  OrderState,
  PaymentStatus,
  CreateOrderDto,
  CreateOrderItemDto,
  UpdateOrderStatusDto,
  UpdatePaymentStatusDto,
  PayOrderDto,
  PayOrderResponse,
  ShipOrderDto,
  DeliverOrderDto,
  CancelOrderDto,
  ReactivateOrderDto,
  RefundOrderDto,
  CreateRefundRequest,
  RefundCalculationResult,
  RefundRecord,
  FastTrackOrderDto,
  AssignShippingMethodDto,
} from '../interfaces/order.interface';

/**
 * Payload para crear una dirección store-side (`POST /store/addresses`).
 * Usa los nombres del DTO del backend (`address_line_1`, `state`, `country`),
 * que el service backend mapea a las columnas `address_line1`/`state_province`/`country_code`.
 */
export interface CreateAddressPayload {
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code?: string;
  country: string;
  /**
   * Código DANE (Divipola, 5 dígitos) del municipio. Se persiste en
   * `addresses.municipality_code` y el emisor de factura electrónica lo lee
   * para el bloque `cac:Address/cac:CountrySubentity/cbc:CityName`.
   */
  municipality_code?: string;
  type?: string;
  customer_id?: number;
  delivery_instructions?: string;
}

/**
 * Payload para editar una dirección store-side (`PATCH /store/addresses/:id`).
 * `UpdateAddressDto = PartialType(CreateAddressDto)` en el backend: todas las
 * claves son opcionales. Mismas claves que `CreateAddressPayload` salvo
 * `customer_id` (no se muta al editar) y `delivery_instructions` (la dirección
 * de envío no las expone en el editor — viven en la orden). `latitude`/`longitude`
 * van como `string` porque el DTO backend usa `@IsString() @IsLatLong()`.
 * `phone_number` NO está en el DTO (vive en la columna Prisma pero el backend
 * no lo expone para escritura), así que se omite aquí.
 */
export interface UpdateAddressPayload {
  address_line_1?: string;
  address_line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  municipality_code?: string;
  type?: string;
  is_primary?: boolean;
  latitude?: string;
  longitude?: string;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let storeOrdersStatsCache: CacheEntry<Observable<OrderStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class StoreOrdersService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) {}

  /**
   * Construye parámetros URL manejando arrays y objetos complejos
   */
  private buildQueryParams(query: OrderQuery): URLSearchParams {
    const params = new URLSearchParams();

    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          // Manejar arrays: status[]=pending&status[]=confirmed
          value.forEach((item) => params.append(key, item.toString()));
        } else if (key === 'date_range' && value) {
          // Manejar rangos de fecha predefinidos
          this.handleDateRange(value, params);
        } else {
          // Manejar valores simples
          params.append(key, value.toString());
        }
      }
    });

    return params;
  }

  /**
   * Convierte rangos de fecha predefinidos a fechas específicas
   */
  private handleDateRange(dateRange: string, params: URLSearchParams): void {
    const now = new Date();
    let fromDate: Date;
    let toDate: Date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );

    switch (dateRange) {
      case 'today':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
        );
        break;
      case 'yesterday':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 1,
          0,
          0,
          0,
        );
        toDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 1,
          23,
          59,
          59,
        );
        break;
      case 'thisWeek':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          0,
          0,
          0,
        );
        break;
      case 'lastWeek':
        fromDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay() - 7,
          0,
          0,
          0,
        );
        toDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - now.getDay(),
          23,
          59,
          59,
        );
        break;
      case 'thisMonth':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
        break;
      case 'lastMonth':
        fromDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear(), now.getMonth(), 0, 0, 0, 0);
        break;
      case 'thisYear':
        fromDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
        break;
      case 'lastYear':
        fromDate = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0);
        toDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
        break;
      default:
        return; // No hacer nada si el rango no es reconocido
    }

    if (fromDate) {
      params.append('date_from', fromDate.toISOString());
    }
    if (toDate) {
      params.append('date_to', toDate.toISOString());
    }
  }

  getOrders(query: OrderQuery = {}): Observable<PaginatedOrdersResponse> {
    const params = this.buildQueryParams(query);
    const url = `${this.apiUrl}/store/orders?${params.toString()}`;

    return this.http.get<PaginatedOrdersResponse>(url).pipe(
      catchError((error) => {
        console.error('Error fetching orders:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  getOrderStats(): Observable<OrderStats> {
    const now = Date.now();

    if (storeOrdersStatsCache && (now - storeOrdersStatsCache.lastFetch) < this.CACHE_TTL) {
      return storeOrdersStatsCache.observable;
    }

    const url = `${this.apiUrl}/store/orders/stats`;
    const observable$ = this.http.get<OrderStats>(url).pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      tap(() => {
        if (storeOrdersStatsCache) {
          storeOrdersStatsCache.lastFetch = Date.now();
        }
      }),
      catchError((error) => {
        console.error('Error fetching order stats:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );

    storeOrdersStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  getOrderById(orderId: string): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR.
    // Backend wraps successful responses in `{ success, data, message }`
    // via `ResponseService.success`, so a raw `this.http.get<Order>` left
    // every consumer reading `result.id` and getting `undefined`. The
    // `map` unwraps `data` while preserving the raw envelope for any
    // caller that still wants it (`(r as any).data ?? r`).
    return this.http.get<any>(url).pipe(
      map((r) => (r?.data ?? r) as Order),
      catchError((error) => {
        console.error('Error fetching order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  getOrderTimeline(orderId: string): Observable<any[]> {
    const url = `${this.apiUrl}/store/orders/${orderId}/timeline`;

    return this.http.get<any>(url).pipe(
      map((r) => (Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [])),
      catchError((error) => {
        console.error('Error fetching order timeline:', error);
        // CP-POS-SVC-PERF-001 — never propagate as fatal: order detail
        // must render even when the timeline endpoint fails. The page
        // shows an empty history instead of a full crash.
        return of([] as any[]);
      }),
    );
  }

  updateOrderStatus(orderId: string, status: OrderState): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.patch<Order>(url, { state: status }).pipe(
      catchError((error) => {
        console.error('Error updating order status:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Crear una nueva orden
   */
  createOrder(order: CreateOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders`;

    return this.http.post<Order>(url, order).pipe(
      catchError((error) => {
        console.error('Error creating order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Actualizar estado de orden con DTO extendido
   */
  updateOrderStatusExtended(
    orderId: string,
    update: UpdateOrderStatusDto,
  ): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.patch<Order>(url, { state: update.status }).pipe(
      catchError((error) => {
        console.error('Error updating order status:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Actualizar estado de pago
   */
  updatePaymentStatus(
    orderId: string,
    update: UpdatePaymentStatusDto,
  ): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http
      .patch<Order>(url, { payment_status: update.paymentStatus })
      .pipe(
        catchError((error) => {
          console.error('Error updating payment status:', error);
          return throwError(() => this.buildApiError(error));
        }),
      );
  }

  /**
   * Eliminar una orden
   */
  deleteOrder(orderId: string): Observable<void> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;

    return this.http.delete<void>(url).pipe(
      catchError((error) => {
        console.error('Error deleting order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Exportar órdenes a CSV/Excel
   */
  exportOrders(query: OrderQuery = {}): Observable<Blob> {
    const params = this.buildQueryParams(query);
    const url = `${this.apiUrl}/store/orders/export?${params.toString()}`;

    return this.http.get(url, { responseType: 'blob' }).pipe(
      catchError((error) => {
        console.error('Error exporting orders:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Normalize an HTTP/RxJS error into a typed shape callers can branch on.
   *
   * CP-POS-CREAR-EDITAR-COBRAR-001 / B.3 + vendix-error-handling:
   * previous implementation returned only a string, dropping `error_code`
   * and `details` on the floor. POS callers now need to distinguish
   * `POS_CUSTOMER_REQUIRED_001`, `POS_STOCK_INSUFFICIENT_001`,
   * `ORD_EDIT_STATE_CHANGED_001`, etc., without parsing free-form messages.
   *
   * Delegates to `parseApiError` (shared utility) so the user-facing copy
   * follows the same `ERROR_MESSAGES` catalog as the rest of the frontend,
   * including the `details.blockers[]` short-circuit for fiscal validators.
   */
  extractApiError(error: unknown): {
    message: string;
    errorCode: string | null;
    details: unknown;
    devMessage: string | null;
  } {
    const parsed = parseApiError(error);
    return {
      message: parsed.userMessage,
      errorCode: parsed.errorCode,
      details: parsed.details,
      devMessage: parsed.devMessage,
    };
  }

  /**
   * Backward-compatible string extractor.
   *
   * Existing call sites use `extractErrorMessage(err)` and immediately build
   * an `Error(message)` in the catch handler. To avoid a wide refactor that
   * touches callers outside this file, keep this method returning a string
   * but route it through `parseApiError` so it picks up the same UX copy
   * (`ERROR_MESSAGES[error_code]`, blockers, presentable backend messages).
   *
   * New code that needs `error_code` should call {@link extractApiError}
   * directly.
   */
  private extractErrorMessage(error: unknown): string {
    return this.extractApiError(error).message;
  }

  /**
   * Build an `Error` whose message is the UX-safe copy and whose
   * `errorCode` / `details` properties are the typed backend code and
   * payload. Use inside `catchError` so the caller can branch on
   * `error.errorCode === 'POS_CUSTOMER_REQUIRED_001'` etc.
   */
  private buildApiError(error: unknown): Error {
    const { message, errorCode, details, devMessage } = this.extractApiError(error);
    const wrapped = new Error(message) as Error & {
      errorCode: string | null;
      details: unknown;
      devMessage: string | null;
    };
    wrapped.errorCode = errorCode;
    wrapped.details = details;
    wrapped.devMessage = devMessage;
    (wrapped as any).cause = error;
    return wrapped;
  }

  // ── Order Flow Methods ──────────────────────────────────────

  getValidTransitions(orderId: string): Observable<OrderState[]> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/transitions`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching valid transitions:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowPayOrder(orderId: string, dto: PayOrderDto): Observable<PayOrderResponse> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/pay`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error processing payment:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowCreditPayment(orderId: string, dto: PayOrderDto): Observable<PayOrderResponse> {
    return this.http.post<any>(
      `${this.apiUrl}/store/orders/${orderId}/flow/credit-payment`,
      dto,
    ).pipe(
      map((response: any) => response.data || response),
      catchError((error) => throwError(() => error)),
    );
  }

  flowForgiveInstallment(orderId: string, installmentId: number): Observable<any> {
    return this.http.post<any>(
      `${this.apiUrl}/store/orders/${orderId}/flow/installments/${installmentId}/forgive`,
      {},
    ).pipe(
      map((response: any) => response.data || response),
      catchError((error) => throwError(() => error)),
    );
  }

  flowShipOrder(orderId: string, dto: ShipOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/ship`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error shipping order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowDeliverOrder(orderId: string, dto: DeliverOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/deliver`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error delivering order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowConfirmPayment(orderId: string): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/confirm-payment`;
    return this.http.post<any>(url, {}).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error confirming payment:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowConfirmDelivery(orderId: string): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/confirm-delivery`;
    return this.http.post<any>(url, {}).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error confirming delivery:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowCancelPayment(orderId: string, dto?: { reason?: string }): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/cancel-payment`;
    return this.http.post<any>(url, dto || {}).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error cancelling payment:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  assignShippingMethod(orderId: string, dto: AssignShippingMethodDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/shipping`;
    return this.http.patch<Order>(url, dto).pipe(
      catchError((error) => {
        console.error('Error assigning shipping method:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * POST /store/orders/:id/flow/fast-track
   * Executes pay (optional) + ship + deliver + finish in a single call.
   */
  flowFastTrack(orderId: string, dto: FastTrackOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/fast-track`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fast-tracking order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  getAvailableActions(orderId: string): Observable<any[]> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/available-actions`;

    return this.http.get<any[]>(url).pipe(
      catchError((error) => {
        console.error('Error fetching available actions:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  updateOrderItems(orderId: string, dto: any): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/items`;
    return this.http.put<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error updating order items:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Phase D.1 / D.2 — `PUT /store/orders/:id/editor`.
   *
   * Thin wrapper around the editor endpoint. The full DTO is shaped by the
   * caller (the POS editor builds the payload from the cart state). The
   * response is the canonical `Order`, which the parent then uses as the
   * source of truth for the subsequent `flow/pay` charge.
   *
   * Errors are normalized through {@link buildApiError} so the cashier
   * surfaces `errorCode` / `details` instead of raw HTTP text.
   */
  updateOrderFromEditor(orderId: string, dto: any): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/editor`;
    return this.http.put<any>(url, dto).pipe(
      map((r) => (r?.data ?? r) as Order),
      catchError((error) => {
        console.error('Error updating order via editor endpoint:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowCancelOrder(orderId: string, dto: CancelOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/cancel`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error cancelling order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowReactivateOrder(orderId: string, dto: ReactivateOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/reactivate`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error reactivating order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  flowRefundOrder(orderId: string, dto: RefundOrderDto): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/refund`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error refunding order:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  // ── Professional Refund Flow ──────────────────────────────

  previewRefund(orderId: string, dto: CreateRefundRequest): Observable<RefundCalculationResult> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/refund/preview`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error previewing refund:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  // REFUND OVERHAUL — returns the refund methods the store can actually
  // execute for a given order (processor configured, cash register open,
  // bank accounts present, always store_credit). Backend drives this via
  // RefundMethodsService; the modal renders the dropdown from this response.
  getAvailableRefundMethods(orderId: string): Observable<{
    methods: {
      value: 'original_payment' | 'cash' | 'bank_transfer' | 'store_credit';
      label: string;
      icon: string;
      available: boolean;
      reason_unavailable?: string;
    }[];
    bank_accounts: { id: number; label: string }[];
  }> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/refund/available-methods`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching available refund methods:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  createRefund(orderId: string, dto: CreateRefundRequest): Observable<any> {
    const url = `${this.apiUrl}/store/orders/${orderId}/flow/refund`;
    return this.http.post<any>(url, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error creating refund:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  getOrderRefunds(orderId: string): Observable<RefundRecord[]> {
    const url = `${this.apiUrl}/store/orders/${orderId}/refunds`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching order refunds:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar órdenes
   */
  invalidateCache(): void {
    storeOrdersStatsCache = null;
  }

  getPaymentReceiptUrl(
    orderId: string | number,
    paymentId: number,
  ): Observable<{ url: string; expires_at: string; content_type?: string }> {
    const url = `${this.apiUrl}/store/orders/${orderId}/payments/${paymentId}/receipt-url`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error fetching payment receipt URL:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  // ── Dirección de envío (captura en página) ────────────────

  /**
   * POST /store/addresses
   * Crea una dirección; si trae `customer_id`, el backend la vincula al cliente.
   * Devuelve la dirección creada (incluye `id`).
   */
  createCustomerAddress(
    payload: CreateAddressPayload,
  ): Observable<{ id: number } & Record<string, unknown>> {
    const url = `${this.apiUrl}/store/addresses`;
    return this.http.post<any>(url, payload).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error creating customer address:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }

  /**
   * PATCH /store/orders/:id
   * Asigna una dirección de envío existente a la orden. La respuesta incluye
   * la relación `addresses_orders_shipping_address_idToaddresses` poblada.
   */
  updateOrderShippingAddress(
    orderId: string,
    shippingAddressId: number,
  ): Observable<Order> {
    const url = `${this.apiUrl}/store/orders/${orderId}`;
    return this.http
      .patch<any>(url, { shipping_address_id: shippingAddressId })
      .pipe(
        map((r) => r.data || r),
        catchError((error) => {
          console.error('Error updating order shipping address:', error);
          return throwError(() => this.buildApiError(error));
        }),
      );
  }

  /**
   * PATCH /store/addresses/:id
   * Edita una dirección existente (ej. la dirección de envío ya asignada a
   * una orden). El backend (`addresses.controller.update`) requiere permiso
   * `store:addresses:update` y acepta `UpdateAddressDto = PartialType(CreateAddressDto)`.
   * Devuelve la dirección actualizada.
   */
  updateAddress(
    addressId: number,
    payload: UpdateAddressPayload,
  ): Observable<{ id: number } & Record<string, unknown>> {
    const url = `${this.apiUrl}/store/addresses/${addressId}`;
    return this.http.patch<any>(url, payload).pipe(
      map((r) => r.data || r),
      catchError((error) => {
        console.error('Error updating address:', error);
        return throwError(() => this.buildApiError(error));
      }),
    );
  }
}
