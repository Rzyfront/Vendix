import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
  PaymentProcessorConfig,
} from './payment-processor.interface';

export abstract class BasePaymentProcessor {
  protected config: PaymentProcessorConfig;

  constructor(config: PaymentProcessorConfig) {
    this.config = config;
  }

  abstract processPayment(paymentData: PaymentData): Promise<PaymentResult>;
  abstract refundPayment(
    paymentId: string,
    amount?: number,
  ): Promise<RefundResult>;
  abstract validatePayment(paymentData: PaymentData): Promise<boolean>;
  abstract getPaymentStatus(transactionId: string): Promise<PaymentStatus>;
  abstract validateWebhook(signature: string, body: string): Promise<boolean>;

  protected generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  protected formatAmount(amount: number): number {
    return Math.round(amount * 100);
  }

  protected parseAmount(amount: number): number {
    return amount / 100;
  }

  protected logTransaction(action: string, data: any, result?: any): void {
    // Transaction logging placeholder
  }

  protected handleError(error: any, context: string): PaymentResult {
    this.logTransaction('ERROR', { context, error: error.message });

    return {
      success: false,
      status: 'failed',
      message: error.message || 'Payment processing failed',
      gatewayResponse: error,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isTestMode(): boolean {
    return this.config.testMode;
  }
}
