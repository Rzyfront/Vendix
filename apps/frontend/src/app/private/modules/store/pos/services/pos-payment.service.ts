import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay, map } from 'rxjs/operators';
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

  getPaymentMethods(): Observable<PaymentMethod[]> {
    return of(this.PAYMENT_METHODS.filter((method) => method.enabled)).pipe(
      delay(100),
    );
  }

  processPayment(request: PaymentRequest): Observable<PaymentResponse> {
    return of(request).pipe(
      delay(2000),
      map((req) => {
        if (req.paymentMethod.type === 'cash') {
          return this.processCashPayment(req);
        } else if (req.paymentMethod.type === 'card') {
          return this.processCardPayment(req);
        } else if (req.paymentMethod.type === 'transfer') {
          return this.processTransferPayment(req);
        } else if (req.paymentMethod.type === 'digital_wallet') {
          return this.processDigitalWalletPayment(req);
        }
        return { success: false, message: 'Método de pago no soportado' };
      }),
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
}
