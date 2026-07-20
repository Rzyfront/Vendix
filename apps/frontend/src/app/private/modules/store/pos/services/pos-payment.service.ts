import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError, Subject } from 'rxjs';
import { catchError, map, timeout, delay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { PaymentMethodsCatalogService } from '../../../../../shared/services/payment-methods-catalog.service';
import { PosCashRegisterService } from './pos-cash-register.service';
import { CartItem, CartState } from '../models/cart.model';
import {
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
  Transaction,
} from '../models/payment.model';
import { PosShippingAddress } from '../models/shipping.model';

// Re-export types for component usage
export type {
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
  Transaction,
} from '../models/payment.model';

@Injectable({
  providedIn: 'root',
})
export class PosPaymentService {
  private readonly apiUrl = `${environment.apiUrl}/store/payments/pos`;

  /**
   * Emitted when a transactional action requires an active cash register session.
   * The POS component listens to this to show the session-open modal.
   */
  private readonly _sessionRequired = new Subject<void>();
  readonly sessionRequired$ = this._sessionRequired.asObservable();

  /** Whether require_session_for_sales is active (set from store settings) */
  private _requireSessionForSales = false;

  setRequireSessionForSales(value: boolean): void {
    this._requireSessionForSales = value;
  }

  /**
   * Validates cash register session for transactional operations.
   * Returns an error Observable if session is required but missing.
   * Returns null if validation passes.
   */
  private validateCashRegisterSession(): Observable<never> | null {
    if (!this.cashRegisterService.isEnabled) return null;
    if (!this._requireSessionForSales) return null;
    if (this.cashRegisterService.hasActiveSession()) return null;

    // Emit event so POS component can show the open-session modal
    this._sessionRequired.next();
    return throwError(
      () => new Error('Debes abrir una caja registradora para procesar ventas.'),
    );
  }

  private transactions: Transaction[] = [];

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
    private cashRegisterService: PosCashRegisterService,
    private paymentMethodsCatalog: PaymentMethodsCatalogService,
  ) {}

  /**
   * Get register_id from centralized service.
   * Uses PosCashRegisterService which handles both feature-enabled (DB) and
   * feature-disabled (localStorage) modes transparently.
   */
  private getRegisterId(): string | null {
    return this.cashRegisterService.getRegisterId();
  }

  private mapCartItemsForPos(cartState: CartState): any[] {
    return cartState.items.map((item) => this.mapCartItemForPos(item));
  }

  private getAppliedPromotionIds(cartState: CartState): number[] {
    return cartState.appliedDiscounts
      .filter((discount) => discount.promotion_id && !discount.coupon_id)
      .map((discount) => Number(discount.promotion_id))
      .filter((promotionId) => Number.isFinite(promotionId));
  }

  private mapCartItemForPos(item: CartItem): any {
    const isCustomItem =
      item.itemType === 'custom' || item.product.id.startsWith('custom-');
    const lineUnits = item.is_weight_product && item.weight
      ? item.weight
      : item.quantity;
    const taxRate = item.taxRate ?? this.calculateItemTaxRate(item);
    const categoryIds = this.getProductCategoryIds(item);

    return {
      item_type: isCustomItem ? 'custom' : 'product',
      product_id: isCustomItem ? null : parseInt(item.product.id, 10),
      category_id: isCustomItem ? undefined : categoryIds[0],
      category_ids: isCustomItem ? undefined : categoryIds,
      product_name: item.product.name,
      description: item.description || item.notes || item.product.description || undefined,
      product_sku: isCustomItem ? undefined : item.product.sku,
      quantity: item.quantity,
      unit_price: Number(item.unitPrice.toFixed(2)),
      final_unit_price: Number(item.finalPrice.toFixed(2)),
      total_price: Number((item.finalPrice * lineUnits).toFixed(2)),
      tax_rate: taxRate,
      tax_amount_item:
        item.taxAmount > 0 && lineUnits > 0
          ? Number((item.taxAmount / lineUnits).toFixed(2))
          : undefined,
      tax_category_id: item.taxCategoryId || undefined,
      cost:
        !isCustomItem && item.product.cost
          ? parseFloat(item.product.cost.toString())
          : undefined,
      product_variant_id: isCustomItem ? null : item.variant_id || null,
      variant_sku: isCustomItem ? null : item.variant_sku || null,
      variant_attributes: isCustomItem ? null : item.variant_attributes || null,
      applied_price_tier_id: isCustomItem
        ? null
        : item.applied_price_tier_id || null,
      weight: item.weight || undefined,
      weight_unit: item.weight_unit || undefined,
      price_override_reason: item.isPriceOverridden
        ? item.priceOverrideReason
        : undefined,
      // Plan KDS fire-flows (F1): forward the cashier's "usar stock" intent
      // from the cart so the backend can persist it on order_items and
      // route the line through the payment-side inventory decrement
      // instead of the kitchen fire. Only meaningful for `prepared`
      // products; ignored for everything else.
      skip_kds: item.skipKds === true,
    };
  }

  private getProductCategoryIds(item: CartItem): number[] {
    const product = item.product as any;
    const rawCategoryIds = Array.isArray(product.category_ids)
      ? product.category_ids
      : product.category_id
        ? [product.category_id]
        : [];

    return rawCategoryIds
      .map((categoryId: string | number) => Number(categoryId))
      .filter((categoryId: number) => Number.isFinite(categoryId));
  }

  private calculateItemTaxRate(item: CartItem): number | undefined {
    const product = item.product;
    if (!product?.tax_assignments?.length) return undefined;
    const rateSum = product.tax_assignments.reduce(
      (sum: number, assignment: any) => {
        const assignmentRate =
          assignment.tax_categories?.tax_rates?.reduce(
            (rateTotal: number, rate: any) =>
              rateTotal + parseFloat(rate.rate || '0'),
            0,
          ) || 0;
        return sum + assignmentRate;
      },
      0,
    );
    return rateSum || undefined;
  }

  /**
   * Payment methods available for POS charging.
   *
   * Delegates to the shared {@link PaymentMethodsCatalogService}, which hits the
   * same context-aware endpoint (`GET /store/payments/payment-methods`) and maps
   * the response to the canonical `PaymentMethod` shape. Kept as a thin wrapper
   * so existing POS/table consumers keep their `getPaymentMethods()` call site.
   */
  getPaymentMethods(): Observable<PaymentMethod[]> {
    return this.paymentMethodsCatalog.getEnabledMethods();
  }

  /**
   * Process payment for immediate sale
   */
  processPayment(request: PaymentRequest): Observable<PaymentResponse> {
    const sessionError = this.validateCashRegisterSession();
    if (sessionError) return sessionError;

    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(
        () => new Error('Usuario no identificado. Inicie sesión nuevamente.'),
      );
    }

    const register_id = this.getRegisterId();

    // For payment-only, we might not always have a customer if it's a direct charge (e.g. paying a debt).
    // But the request has customerEmail. If we don't have a structured customer, we fail?
    // The previous code used request.customerEmail.

    const payment_data = {
      customer_id: request.customerId, // Consumer must provide this
      customer_name: request.customerName,
      customer_email: request.customerEmail,
      customer_phone: request.customerPhone,
      store_id: this.getStoreId(),
      items: [],
      subtotal: Number(parseFloat(request.amount.toString()).toFixed(2)),
      tax_amount: 0,
      discount_amount: 0,
      total_amount: Number(parseFloat(request.amount.toString()).toFixed(2)),
      requires_payment: true,
      store_payment_method_id: parseInt(request.paymentMethod.id),
      amount_received: Number(
        parseFloat((request.cashReceived || request.amount).toString()).toFixed(
          2,
        ),
      ),
      payment_reference: request.reference || '',
      wompi_payment_method: (request.paymentMethod?.original as any)?.system_payment_method?.type === 'wompi'
        ? request.metadata?.wompiPaymentMethod
        : undefined,
      wallet_id: request.metadata?.walletId,
      return_url: window.location.origin + '/pos/payment-callback',
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: '',
      update_inventory: false,
    };

    return this.http.post<any>(this.apiUrl, payment_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          return {
            success: true,
            transactionId:
              data.payment?.transaction_id ||
              data.payment?.id ||
              this.generateTransactionId(),
            message: data.message || 'Pago procesado correctamente',
            change: data.payment?.change,
            nextAction: data.payment?.nextAction || data.nextAction,
          };
        } else {
          return {
            success: false,
            message: data.message || 'Error al procesar el pago',
          };
        }
      }),
      catchError((error) => {
        return of({
          success: false,
          message: error.error?.message || 'Error al procesar el pago',
        });
      }),
    );
  }

  /**
   * Process sale with payment (cash sale)
   */
  processSaleWithPayment(
    cartState: CartState,
    paymentRequest: PaymentRequest,
    createdBy: string,
    tableSessionId?: number | null,
  ): Observable<any> {
    const sessionError = this.validateCashRegisterSession();
    if (sessionError) return sessionError;

    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = this.getRegisterId();

    // Check if anonymous sale is allowed
    const isAnonymousSale = paymentRequest.isAnonymousSale === true;

    // For non-anonymous sales, customer is required
    if (!isAnonymousSale && !cartState.customer) {
      return throwError(
        () => new Error('Debe seleccionar un cliente para procesar la venta.'),
      );
    }

    // Build sale data with conditional customer fields.
    //
    // IMPORTANT — Promotions and coupons:
    //   The backend is the source of truth for `discount_amount` and the
    //   final `grand_total`. We send `promotion_ids` (manual promotions
    //   selected by the cashier) and `coupon_code`; the backend recalculates
    //   the actual discount via `PromotionEngineService.quoteDiscounts` and
    //   `CouponsService.validate`. Any locally computed `discount_amount` is
    //   intentionally omitted so the frontend cannot override the server
    //   calculation.
    const sale_data: any = {
      store_id: this.getStoreId(),
      items: this.mapCartItemsForPos(cartState),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      promotion_ids: this.getAppliedPromotionIds(cartState),
      total_amount: Number(
        parseFloat(cartState.summary.total.toString()).toFixed(2),
      ),
      requires_payment: true,
      payment_form: '1', // DIAN: contado
      store_payment_method_id: parseInt(paymentRequest.paymentMethod.id),
      amount_received: Number(
        parseFloat(
          (paymentRequest.cashReceived || cartState.summary.total).toString(),
        ).toFixed(2),
      ),
      payment_reference: paymentRequest.reference || '',
      wompi_payment_method: (paymentRequest.paymentMethod?.original as any)?.system_payment_method?.type === 'wompi'
        ? paymentRequest.metadata?.wompiPaymentMethod
        : undefined,
      wallet_id: paymentRequest.metadata?.walletId,
      return_url: window.location.origin + '/pos/payment-callback',
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: true,
      coupon_id: cartState.appliedCoupon?.id,
      coupon_code: cartState.appliedCoupon?.code,
      booking_ids: cartState.pendingBookings?.map(b => b.id) || [],
      // Bug 1 / Obj 4 (Fase K): when the cashier opened/selected a
      // table from the inline picker in `pos-payment-interface`, the
      // backend closes out the table's existing draft order instead
      // of creating a brand-new one. The backend re-derives totals
      // from the items already on the order.
      ...(tableSessionId != null ? { table_session_id: tableSessionId } : {}),
    };

    // For anonymous sales, use "Consumidor Final" as customer name
    // For regular sales, include customer fields
    if (isAnonymousSale) {
      sale_data.customer_name = 'Consumidor Final';
    } else if (cartState.customer) {
      sale_data.customer_id = cartState.customer.id;
      sale_data.customer_name = `${cartState.customer.first_name} ${cartState.customer.last_name}`;
      sale_data.customer_email = cartState.customer.email;
      sale_data.customer_phone = cartState.customer.phone;
    }

    return this.http.post<any>(this.apiUrl, sale_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          // Ensure payment object has correct structure if needed by consumer
          const mappedPayment = data.payment
            ? {
                ...data.payment,
                paymentMethod: paymentRequest.paymentMethod,
                transactionId: data.payment.transaction_id,
              }
            : undefined;

          return {
            success: true,
            order: data.order,
            payment: mappedPayment,
            message: data.message,
            change: data.payment?.change,
            nextAction: data.payment?.nextAction || data.nextAction,
          };
        } else {
          throw new Error(data.message || 'Error al procesar la venta');
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Process sale with shipping (home delivery / pickup)
   */
  processShippingSale(
    cartState: CartState,
    shippingData: {
      shippingMethodId: number;
      shippingCost: number;
      deliveryType: string;
      shippingAddress: PosShippingAddress;
      deliveryNotes?: string;
      shippingAddressId?: number | null;
    },
    paymentRequest: PaymentRequest | null,
    createdBy: string,
    creditConfig?: {
      num_installments: number;
      frequency: 'weekly' | 'biweekly' | 'monthly';
      first_installment_date: string;
      interest_rate: number;
      initial_payment: number;
      initial_payment_method_id?: number;
    },
  ): Observable<any> {
    const sessionError = this.validateCashRegisterSession();
    if (sessionError) return sessionError;

    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = this.getRegisterId();

    if (!cartState.customer) {
      return throwError(
        () => new Error('Debe seleccionar un cliente para órdenes con envío.'),
      );
    }

    const totalWithShipping = Number(
      parseFloat(
        (cartState.summary.total + shippingData.shippingCost).toString(),
      ).toFixed(2),
    );

    // See `processSaleWithPayment` for the rationale on not sending
    // `discount_amount`: the backend recalculates it from `promotion_ids` +
    // `coupon_code` and is the source of truth for the final `grand_total`.
    const sale_data: Record<string, any> = {
      customer_id: cartState.customer.id,
      customer_name:
        `${cartState.customer.first_name} ${cartState.customer.last_name || ''}`.trim(),
      customer_email: cartState.customer.email,
      customer_phone: cartState.customer.phone,
      store_id: this.getStoreId(),
      items: this.mapCartItemsForPos(cartState),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      promotion_ids: this.getAppliedPromotionIds(cartState),
      total_amount: totalWithShipping,
      // Shipping fields
      delivery_type: shippingData.deliveryType,
      shipping_method_id: shippingData.shippingMethodId,
      shipping_cost: Number(
        parseFloat(shippingData.shippingCost.toString()).toFixed(2),
      ),
      shipping_address_snapshot: shippingData.shippingAddress,
      ...(shippingData.shippingAddressId
        ? { shipping_address_id: shippingData.shippingAddressId }
        : {}),
      // POS meta
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: shippingData.deliveryNotes || cartState.notes || '',
      update_inventory: true,
      coupon_id: cartState.appliedCoupon?.id,
      coupon_code: cartState.appliedCoupon?.code,
      booking_ids: cartState.pendingBookings?.map(b => b.id) || [],
    };

    if (creditConfig) {
      // Credit flow
      sale_data['requires_payment'] = false;
      sale_data['payment_form'] = '2'; // DIAN: crédito
      sale_data['installment_terms'] = {
        num_installments: creditConfig.num_installments,
        frequency: creditConfig.frequency,
        first_installment_date: creditConfig.first_installment_date,
        interest_rate: creditConfig.interest_rate || 0,
        initial_payment: creditConfig.initial_payment || 0,
        initial_payment_method_id: creditConfig.initial_payment_method_id,
      };
    } else if (paymentRequest) {
      // Pago del método elegido. Incluye cash_on_delivery: su
      // `store_payment_method_id` se envía igual y el processor backend
      // (cash-on-delivery.processor) devuelve 'pending', dejando la orden en
      // pending_payment. Ya NO existe el eje "contra entrega" sin pago: siempre
      // se envía el pago producido por el collector.
      sale_data['requires_payment'] = true;
      sale_data['payment_form'] = '1'; // DIAN: contado
      sale_data['store_payment_method_id'] = parseInt(
        paymentRequest.paymentMethod.id,
      );
      sale_data['amount_received'] = Number(
        parseFloat(
          (paymentRequest.cashReceived || totalWithShipping).toString(),
        ).toFixed(2),
      );
      sale_data['payment_reference'] = paymentRequest.reference || '';
    }

    return this.http.post<any>(this.apiUrl, sale_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          const mappedPayment =
            data.payment && paymentRequest
              ? {
                  ...data.payment,
                  paymentMethod: paymentRequest.paymentMethod,
                  transactionId: data.payment.transaction_id,
                }
              : undefined;

          return {
            success: true,
            order: data.order,
            payment: mappedPayment,
            message: data.message,
            change: data.payment?.change,
          };
        } else {
          throw new Error(data.message || 'Error al procesar el envío');
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Process credit sale (no immediate payment)
   */
  processCreditSale(cartState: CartState, createdBy: string): Observable<any> {
    const sessionError = this.validateCashRegisterSession();
    if (sessionError) return sessionError;

    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = this.getRegisterId();

    if (!cartState.customer) {
      return throwError(() => new Error('Debe seleccionar un cliente.'));
    }

    // Backend recalculates discounts from `promotion_ids` + `coupon_code`.
    // See `processSaleWithPayment` comment for full rationale.
    const credit_data = {
      customer_id: cartState.customer.id,
      customer_name: `${cartState.customer.first_name} ${cartState.customer.last_name}`,
      customer_email: cartState.customer.email,
      customer_phone: cartState.customer.phone,
      store_id: this.getStoreId(),
      items: this.mapCartItemsForPos(cartState),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      promotion_ids: this.getAppliedPromotionIds(cartState),
      total_amount: Number(
        parseFloat(cartState.summary.total.toString()).toFixed(2),
      ),
      requires_payment: false,
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: true,
      coupon_id: cartState.appliedCoupon?.id,
      coupon_code: cartState.appliedCoupon?.code,
      booking_ids: cartState.pendingBookings?.map(b => b.id) || [],
    };

    return this.http.post<any>(this.apiUrl, credit_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          return {
            success: true,
            order: data.order,
            message: data.message,
          };
        } else {
          throw new Error(
            data.message || 'Error al procesar la venta a crédito',
          );
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Procesar venta a crédito con términos de cuotas (desde modal de pago POS)
   */
  processCreditSaleWithTerms(
    cartState: CartState,
    creditConfig: {
      num_installments: number;
      frequency: 'weekly' | 'biweekly' | 'monthly';
      first_installment_date: string;
      interest_rate: number;
      interest_type?: string;
      initial_payment: number;
      initial_payment_method_id?: number;
    },
    createdBy: string,
    creditType: 'installments' | 'free' = 'installments',
  ): Observable<any> {
    const sessionError = this.validateCashRegisterSession();
    if (sessionError) return sessionError;

    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = this.getRegisterId();

    if (!cartState.customer) {
      return throwError(() => new Error('Debe seleccionar un cliente para ventas a crédito.'));
    }

    // Backend recalculates discounts from `promotion_ids` + `coupon_code`.
    // See `processSaleWithPayment` comment for full rationale.
    const credit_data: any = {
      customer_id: cartState.customer.id,
      customer_name: `${cartState.customer.first_name} ${cartState.customer.last_name}`,
      customer_email: cartState.customer.email,
      customer_phone: cartState.customer.phone,
      store_id: this.getStoreId(),
      items: this.mapCartItemsForPos(cartState),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      promotion_ids: this.getAppliedPromotionIds(cartState),
      total_amount: Number(
        parseFloat(cartState.summary.total.toString()).toFixed(2),
      ),
      requires_payment: false,
      payment_form: '2', // DIAN: crédito
      credit_type: creditType,
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: true,
      coupon_id: cartState.appliedCoupon?.id,
      coupon_code: cartState.appliedCoupon?.code,
      booking_ids: cartState.pendingBookings?.map(b => b.id) || [],
      installment_terms: {
        num_installments: creditConfig.num_installments,
        frequency: creditConfig.frequency,
        first_installment_date: creditConfig.first_installment_date,
        interest_rate: creditConfig.interest_rate || 0,
        interest_type: creditConfig.interest_type || 'simple',
        initial_payment: creditConfig.initial_payment || 0,
        initial_payment_method_id: creditConfig.initial_payment_method_id,
      },
    };

    return this.http.post<any>(this.apiUrl, credit_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          return {
            success: true,
            order: data.order,
            message: data.message,
          };
        } else {
          throw new Error(
            data.message || 'Error al procesar la venta a crédito',
          );
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Guardar borrador de orden
   */
  saveDraft(cartState: CartState, createdBy: string): Observable<any> {
    // Drafts are NOT transactional — no cash register session required.
    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = this.getRegisterId(); // Optional for drafts

    // Drafts: backend still recalculates discounts when saved.
    // See `processSaleWithPayment` comment for the rationale.
    // `customer` is optional — POS drafts can be anonymous (Consumidor
    // Final). When present, link to the customer row; when missing, the
    // backend stores the order with `customer_id = null`.
    const customer = cartState.customer;
    const draft_data: Record<string, any> = {
      ...(customer?.id ? { customer_id: customer.id } : {}),
      customer_name: customer
        ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
        : 'Consumidor Final',
      ...(customer?.email ? { customer_email: customer.email } : {}),
      ...(customer?.phone ? { customer_phone: customer.phone } : {}),
      store_id: this.getStoreId(),
      items: this.mapCartItemsForPos(cartState),
      subtotal: Number(cartState.summary.subtotal.toFixed(2)),
      tax_amount: Number(cartState.summary.taxAmount.toFixed(2)),
      promotion_ids: this.getAppliedPromotionIds(cartState),
      total_amount: Number(cartState.summary.total.toFixed(2)),
      is_draft: true,
      requires_payment: false,
      ...(register_id ? { register_id } : {}),
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: false,
    };

    return this.http.post<any>(this.apiUrl, draft_data).pipe(
      map((response) => {
        const data = response.data || response;
        if (data.success) {
          return {
            success: true,
            order: data.order,
            message: data.message,
          };
        } else {
          throw new Error(data.message || 'Error al guardar el borrador');
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  private processCashPayment(request: PaymentRequest): PaymentResponse {
    if (!request.cashReceived || request.cashReceived < request.amount) {
      return { success: false, message: 'El monto recibido es insuficiente' };
    }

    const change = request.cashReceived - request.amount;
    const transactionId = this.generateTransactionId();

    this.saveTransaction({
      id: transactionId,
      orderId: request.orderId,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      status: 'completed',
      createdAt: new Date(),
      details: {
        amountReceived: request.cashReceived,
        change: change,
      },
    });

    return {
      success: true,
      transactionId,
      message: 'Pago en efectivo procesado correctamente',
      change,
    };
  }

  private processCardPayment(request: PaymentRequest): PaymentResponse {
    if (!request.reference || request.reference.length !== 4) {
      return {
        success: false,
        message: 'Los últimos 4 dígitos son requeridos',
      };
    }

    const transactionId = this.generateTransactionId();

    this.saveTransaction({
      id: transactionId,
      orderId: request.orderId,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      status: 'completed',
      createdAt: new Date(),
      reference: request.reference,
      details: {
        last4Digits: request.reference,
        cardType: 'Visa/Mastercard',
        authCode: this.generateAuthCode(),
        transactionId,
      },
    });

    return {
      success: true,
      transactionId,
      message: 'Pago con tarjeta procesado correctamente',
    };
  }

  private processTransferPayment(request: PaymentRequest): PaymentResponse {
    if (!request.reference) {
      return {
        success: false,
        message: 'El número de referencia es requerido',
      };
    }

    const transactionId = this.generateTransactionId();

    this.saveTransaction({
      id: transactionId,
      orderId: request.orderId,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      status: 'completed',
      createdAt: new Date(),
      reference: request.reference,
    });

    return {
      success: true,
      transactionId,
      message: 'Transferencia procesada correctamente',
    };
  }

  private processDigitalWalletPayment(
    request: PaymentRequest,
  ): PaymentResponse {
    if (!request.reference) {
      return { success: false, message: 'La referencia de pago es requerida' };
    }

    const transactionId = this.generateTransactionId();

    this.saveTransaction({
      id: transactionId,
      orderId: request.orderId,
      amount: request.amount,
      paymentMethod: request.paymentMethod,
      status: 'completed',
      createdAt: new Date(),
      reference: request.reference,
    });

    return {
      success: true,
      transactionId,
      message: 'Pago con billetera digital procesado correctamente',
    };
  }

  private saveTransaction(transaction: Transaction): void {
    this.transactions.push(transaction);
  }

  private generateTransactionId(): string {
    return (
      'TXN' + Date.now() + Math.random().toString(36).slice(2, 11).toUpperCase()
    );
  }

  private generateAuthCode(): string {
    return Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  getTransactionHistory(): Observable<Transaction[]> {
    return of(
      this.transactions.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      ),
    );
  }

  refundTransaction(transactionId: string): Observable<PaymentResponse> {
    const transaction = this.transactions.find((t) => t.id === transactionId);
    if (!transaction) {
      return throwError(() => new Error('Transacción no encontrada'));
    }

    if (transaction.status === 'refunded') {
      return throwError(
        () => new Error('La transacción ya ha sido reembolsada'),
      );
    }

    transaction.status = 'refunded';

    return of({
      success: true,
      transactionId: 'REF' + Date.now(),
      message: 'Reembolso procesado correctamente',
    }).pipe(delay(1000));
  }

  /**
   * Get PSE financial institutions from Wompi
   */
  getPseFinancialInstitutions(): Observable<any[]> {
    return this.http
      .get<any>(`${environment.apiUrl}/store/payments/wompi/financial-institutions`)
      .pipe(map((res: any) => res.data || []));
  }

  /**
   * Get payment status (for polling async Wompi payments)
   */
  getPaymentStatus(paymentId: string): Observable<any> {
    return this.http.get<any>(
      `${environment.apiUrl}/store/payments/${paymentId}/status`,
    );
  }

  /**
   * Force-confirm a POS Wompi payment.
   *
   * Calls the backend confirm endpoint which polls Wompi for the canonical
   * transaction state and applies it through the shared webhook handler.
   * The endpoint is idempotent: terminal-state payments return immediately
   * with `alreadyConfirmed: true`.
   *
   * Used by:
   *  - The POS polling loop (every 5s while payment is pending).
   *  - The "Verificar pago ahora" manual button.
   */
  confirmWompiPayment(paymentId: number): Observable<{
    state: string;
    transactionId: string | null;
    alreadyConfirmed: boolean;
    message?: string;
  }> {
    return this.http
      .post<any>(
        `${environment.apiUrl}/store/payments/pos/confirm-wompi-payment/${paymentId}`,
        {},
      )
      .pipe(
        map((res) => {
          // Backend ResponseService.success wraps payload in { success, data, message }.
          const inner = res?.data ?? res;
          return {
            state: inner?.state ?? 'pending',
            transactionId: inner?.transactionId ?? null,
            alreadyConfirmed: !!inner?.alreadyConfirmed,
            message: inner?.message,
          };
        }),
      );
  }

  /**
   * Get current store ID
   */
  private getStoreId(): number {
    return this.storeContextService.getStoreIdOrThrow();
  }
}
