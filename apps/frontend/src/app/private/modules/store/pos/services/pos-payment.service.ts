import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, timeout, delay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { StoreContextService } from '../../../../../core/services/store-context.service';
import { CartState } from '../models/cart.model';
import {
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
  Transaction,
} from '../models/payment.model';

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
  private readonly PAYMENT_METHODS: PaymentMethod[] = [
    {
      id: 'cash',
      name: 'Efectivo',
      type: 'cash',
      icon: 'cash',
      enabled: true,
    },
    {
      id: 'card',
      name: 'Tarjeta de Crédito/Débito',
      type: 'card',
      icon: 'credit-card',
      enabled: true,
      requiresReference: true,
      referenceLabel: 'Últimos 4 dígitos',
    },
    {
      id: 'transfer',
      name: 'Transferencia Bancaria',
      type: 'transfer',
      icon: 'bank',
      enabled: true,
      requiresReference: true,
      referenceLabel: 'Número de referencia',
    },
    {
      id: 'digital_wallet',
      name: 'Billetera Digital',
      type: 'digital_wallet',
      icon: 'smartphone',
      enabled: true,
      requiresReference: true,
      referenceLabel: 'Referencia de pago',
    },
  ];

  private transactions: Transaction[] = [];

  constructor(
    private http: HttpClient,
    private storeContextService: StoreContextService,
  ) { }

  getPaymentMethods(): Observable<PaymentMethod[]> {
    // Use the context-aware endpoint that relies on the user's token scope
    const paymentMethodsUrl = `${environment.apiUrl}/store/payments/payment-methods`;

    return this.http.get<any>(paymentMethodsUrl).pipe(
      map((response) => {
        const methodsData = response.data || response;
        if (methodsData && Array.isArray(methodsData)) {
          // Transform backend payment methods to frontend format
          return methodsData.map((method: any) => {
            // Handle both flattened or nested structure
            const type = method.system_payment_method?.type || method.type || 'unknown';
            const name = method.display_name || method.name || method.system_payment_method?.name;

            return {
              id: method.id.toString(),
              name: name,
              type: type,
              icon: this.getPaymentIcon(type),
              enabled: method.state === 'enabled',
              requiresReference: type !== 'cash',
              referenceLabel: this.getReferenceLabel(type),
              // Preserve original metadata if needed
              original: method
            };
          });
        }
        // Fallback to default methods if backend fails
        return this.PAYMENT_METHODS.filter((method) => method.enabled);
      }),
      catchError((error) => {
        console.warn(
          'Error fetching payment methods from backend, using defaults:',
          error,
        );
        return of(this.PAYMENT_METHODS.filter((method) => method.enabled)).pipe(
          delay(100),
        );
      }),
    );
  }

  private getPaymentIcon(type: string): string {
    const iconMap: { [key: string]: string } = {
      cash: 'cash',
      card: 'credit-card',
      paypal: 'paypal',
      bank_transfer: 'bank',
      digital_wallet: 'smartphone',
    };
    return iconMap[type] || 'credit-card';
  }

  private getReferenceLabel(type: string): string {
    const labelMap: { [key: string]: string } = {
      card: 'Últimos 4 dígitos',
      paypal: 'Email de PayPal',
      bank_transfer: 'Número de referencia',
      digital_wallet: 'Referencia de pago',
    };
    return labelMap[type] || 'Referencia';
  }

  /**
   * Process payment for immediate sale
   */
  processPayment(request: PaymentRequest): Observable<PaymentResponse> {
    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado. Inicie sesión nuevamente.'));
    }

    const register_id = localStorage.getItem('pos_register_id');
    if (!register_id) {
      // Ideally this should be strictly required, but for now we might fallback to a session ID if not configured,
      // BUT user said "nothing hardcoded". So we error if not configured.
      // However, to avoid breaking the app if no register config exists, we might need a prompt.
      // The prompt said "si algun dato falta... notificarse". So throwing error satisfies this.
      return throwError(() => new Error('Caja no configurada (Register ID missing).'));
    }

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
        parseFloat((request.cashReceived || request.amount).toString()).toFixed(2),
      ),
      payment_reference: request.reference || '',
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
    createdBy: string, // This arg was passed but ignored in favor of hardcoded 'current_user'. Now we use StoreContextService internally or this arg if proven reliable.
  ): Observable<any> {
    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = localStorage.getItem('pos_register_id');
    if (!register_id) {
      return throwError(() => new Error('Caja no configurada.'));
    }

    // Check if anonymous sale is allowed
    const isAnonymousSale = paymentRequest.isAnonymousSale === true;

    // For non-anonymous sales, customer is required
    if (!isAnonymousSale && !cartState.customer) {
      return throwError(() => new Error('Debe seleccionar un cliente para procesar la venta.'));
    }

    // Build sale data with conditional customer fields
    const sale_data: any = {
      store_id: this.getStoreId(),
      items: cartState.items.map((item) => ({
        product_id: parseInt(item.product.id),
        product_name: item.product.name,
        product_sku: item.product.sku,
        quantity: item.quantity,
        unit_price: Number(parseFloat(item.unitPrice.toString()).toFixed(2)),
        total_price: Number(parseFloat(item.totalPrice.toString()).toFixed(2)),
        cost: item.product.cost
          ? parseFloat(item.product.cost.toString())
          : undefined,
        product_variant_id: item.variant_id || null,
        variant_sku: item.variant_sku || null,
        variant_attributes: item.variant_attributes || null,
      })),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      discount_amount: Number(
        parseFloat(cartState.summary.discountAmount.toString()).toFixed(2),
      ),
      total_amount: Number(
        parseFloat(cartState.summary.total.toString()).toFixed(2),
      ),
      requires_payment: true,
      store_payment_method_id: parseInt(paymentRequest.paymentMethod.id),
      amount_received: Number(
        parseFloat(
          (paymentRequest.cashReceived || cartState.summary.total).toString(),
        ).toFixed(2),
      ),
      payment_reference: paymentRequest.reference || '',
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: true,
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
          };
        } else {
          throw new Error(data.message || 'Error al procesar la venta');
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Process credit sale (no immediate payment)
   */
  processCreditSale(cartState: CartState, createdBy: string): Observable<any> {
    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = localStorage.getItem('pos_register_id');
    if (!register_id) {
      return throwError(() => new Error('Caja no configurada.'));
    }

    if (!cartState.customer) {
      return throwError(() => new Error('Debe seleccionar un cliente.'));
    }

    const credit_data = {
      customer_id: cartState.customer.id,
      customer_name: `${cartState.customer.first_name} ${cartState.customer.last_name}`,
      customer_email: cartState.customer.email,
      customer_phone: cartState.customer.phone,
      store_id: this.getStoreId(),
      items: cartState.items.map((item) => ({
        product_id: parseInt(item.product.id),
        product_name: item.product.name,
        product_sku: item.product.sku,
        quantity: item.quantity,
        unit_price: Number(parseFloat(item.unitPrice.toString()).toFixed(2)),
        total_price: Number(parseFloat(item.totalPrice.toString()).toFixed(2)),
        cost: item.product.cost
          ? parseFloat(item.product.cost.toString())
          : undefined,
        product_variant_id: item.variant_id || null,
        variant_sku: item.variant_sku || null,
        variant_attributes: item.variant_attributes || null,
      })),
      subtotal: Number(
        parseFloat(cartState.summary.subtotal.toString()).toFixed(2),
      ),
      tax_amount: Number(
        parseFloat(cartState.summary.taxAmount.toString()).toFixed(2),
      ),
      discount_amount: Number(
        parseFloat(cartState.summary.discountAmount.toString()).toFixed(2),
      ),
      total_amount: Number(
        parseFloat(cartState.summary.total.toString()).toFixed(2),
      ),
      requires_payment: false,
      credit_terms: {
        payment_terms: 'Pendiente de pago',
      },
      register_id: register_id,
      seller_user_id: user_id,
      internal_notes: cartState.notes || '',
      update_inventory: true,
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
   * Save draft order
   */
  saveDraft(cartState: CartState, createdBy: string): Observable<any> {
    const user_id = this.storeContextService.getUserId();
    if (!user_id) {
      return throwError(() => new Error('Usuario no identificado.'));
    }

    const register_id = localStorage.getItem('pos_register_id');
    // Draft might not need register strictly, but let's be consistent or lax. 
    // User said "nada del pos puede ser hardcodeado". 
    // If register missing, we can fail or skip it? Usually drafts are register-agnostic?
    // I'll fail if missing to be safe per instructions.
    if (!register_id) {
      return throwError(() => new Error('Caja no configurada.'));
    }

    // Drafts *might* not have a customer yet?
    // "si algun dato falta... notificarse".
    // If saving draft without customer is valid (e.g. anonymous draft), we can allow null.
    // But "customer_id" 1 was hardcoded. If we remove hardcoding, we must either pass null or require it.
    // I'll check if backend allows null customer. If I pass null, does it work?
    // If not, I'll error.
    if (!cartState.customer) {
      return throwError(() => new Error('Debe seleccionar un cliente para guardar el borrador.'));
    }

    const draft_data = {
      customer_id: cartState.customer.id,
      customer_name: `${cartState.customer.first_name} ${cartState.customer.last_name}`,
      customer_email: cartState.customer.email,
      customer_phone: cartState.customer.phone,
      store_id: this.getStoreId(),
      items: cartState.items.map((item) => ({
        product_id: parseInt(item.product.id),
        product_name: item.product.name,
        product_sku: item.product.sku,
        quantity: item.quantity,
        unit_price: Number(item.unitPrice.toFixed(2)),
        total_price: Number(item.totalPrice.toFixed(2)),
        cost: item.product.cost,
        product_variant_id: item.variant_id || null,
        variant_sku: item.variant_sku || null,
        variant_attributes: item.variant_attributes || null,
      })),
      subtotal: Number(cartState.summary.subtotal.toFixed(2)),
      tax_amount: Number(cartState.summary.taxAmount.toFixed(2)),
      discount_amount: Number(cartState.summary.discountAmount.toFixed(2)),
      total_amount: Number(cartState.summary.total.toFixed(2)),
      requires_payment: false,
      register_id: register_id,
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
   * Get current store ID
   */
  private getStoreId(): number {
    return this.storeContextService.getStoreIdOrThrow();
  }
}
