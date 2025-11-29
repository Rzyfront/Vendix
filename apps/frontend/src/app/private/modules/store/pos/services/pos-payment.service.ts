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
  private readonly apiUrl = `${environment.apiUrl}/payments/pos`;
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
  ) {}

  getPaymentMethods(): Observable<PaymentMethod[]> {
    // Use the context-aware endpoint that relies on the user's token scope
    const paymentMethodsUrl = `${environment.apiUrl}/payments/payment-methods`;

    return this.http.get<any>(paymentMethodsUrl).pipe(
      map((response) => {
        if (response && Array.isArray(response)) {
          // Transform backend payment methods to frontend format
          return response.map((method: any) => ({
            id: method.id.toString(),
            name: method.name,
            type: method.type,
            icon: this.getPaymentIcon(method.type),
            enabled: method.state === 'enabled',
            requiresReference: method.type !== 'cash',
            referenceLabel: this.getReferenceLabel(method.type),
          }));
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
    const paymentData = {
      customer_id: request.customerEmail ? 1 : 1, // Will be set by backend context
      customer_name: 'Cliente General',
      customer_email: request.customerEmail || 'cliente@general.com',
      customer_phone: request.customerPhone || '',
      store_id: this.getStoreId(),
      items: [], // Empty for payment-only
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
      register_id: 'POS_REGISTER_001',
      seller_user_id: 'current_user',
      internal_notes: '',
      update_inventory: false, // Payment only, no inventory update
    };

    return this.http.post<any>(this.apiUrl, paymentData).pipe(
      map((response) => {
        if (response.success) {
          return {
            success: true,
            transactionId:
              response.payment?.transaction_id ||
              response.payment?.id ||
              this.generateTransactionId(),
            message: response.message || 'Pago procesado correctamente',
            change: response.payment?.change,
          };
        } else {
          return {
            success: false,
            message: response.message || 'Error al procesar el pago',
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
  ): Observable<any> {
    const saleData = {
      customer_id: cartState.customer?.id || 1,
      customer_name: cartState.customer
        ? `${cartState.customer.first_name} ${cartState.customer.last_name}`
        : 'Cliente General',
      customer_email: cartState.customer?.email || 'cliente@general.com',
      customer_phone: cartState.customer?.phone || '',
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
      register_id: 'POS_REGISTER_001',
      seller_user_id: createdBy,
      internal_notes: cartState.notes || '',
      update_inventory: true,
    };

    return this.http.post<any>(this.apiUrl, saleData).pipe(
      map((response) => {
        if (response.success) {
          // Ensure payment object has correct structure if needed by consumer
          const mappedPayment = response.payment
            ? {
                ...response.payment,
                paymentMethod: paymentRequest.paymentMethod,
                transactionId: response.payment.transaction_id,
              }
            : undefined;

          return {
            success: true,
            order: response.order,
            payment: mappedPayment,
            message: response.message,
            change: response.payment?.change,
          };
        } else {
          throw new Error(response.message || 'Error al procesar la venta');
        }
      }),
      catchError((error) => throwError(() => error)),
    );
  }

  /**
   * Process credit sale (no immediate payment)
   */
  processCreditSale(cartState: CartState, createdBy: string): Observable<any> {
    const creditData = {
      customer_id: cartState.customer?.id || 1,
      customer_name: cartState.customer
        ? `${cartState.customer.first_name} ${cartState.customer.last_name}`
        : 'Cliente General',
      customer_email: cartState.customer?.email || 'cliente@general.com',
      customer_phone: cartState.customer?.phone || '',
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
      register_id: 'POS_REGISTER_001',
      seller_user_id: createdBy,
      internal_notes: cartState.notes || '',
      update_inventory: true,
    };

    return this.http.post<any>(this.apiUrl, creditData).pipe(
      map((response) => {
        if (response.success) {
          return {
            success: true,
            order: response.order,
            message: response.message,
          };
        } else {
          throw new Error(
            response.message || 'Error al procesar la venta a crédito',
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
    const draftData = {
      customer_id: cartState.customer?.id || 1,
      customer_name: cartState.customer
        ? `${cartState.customer.first_name} ${cartState.customer.last_name}`
        : 'Cliente General',
      customer_email: cartState.customer?.email || 'cliente@general.com',
      customer_phone: cartState.customer?.phone || '',
      store_id: this.getStoreId(),
      items: cartState.items.map((item) => ({
        product_id: parseInt(item.product.id),
        product_name: item.product.name,
        product_sku: item.product.sku,
        quantity: item.quantity,
        unit_price: Number(item.unitPrice.toFixed(2)),
        total_price: Number(item.totalPrice.toFixed(2)),
        cost: item.product.cost,
      })),
      subtotal: Number(cartState.summary.subtotal.toFixed(2)),
      tax_amount: Number(cartState.summary.taxAmount.toFixed(2)),
      discount_amount: Number(cartState.summary.discountAmount.toFixed(2)),
      total_amount: Number(cartState.summary.total.toFixed(2)),
      requires_payment: false,
      register_id: 'POS_REGISTER_001',
      seller_user_id: createdBy,
      internal_notes: cartState.notes || '',
      update_inventory: false,
    };

    return this.http.post<any>(this.apiUrl, draftData).pipe(
      map((response) => {
        if (response.success) {
          return {
            success: true,
            order: response.order,
            message: response.message,
          };
        } else {
          throw new Error(response.message || 'Error al guardar el borrador');
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
