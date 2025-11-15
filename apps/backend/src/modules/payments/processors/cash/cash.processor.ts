import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';

export class CashPaymentProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_CASH_PAYMENT', paymentData);

      const transactionId = this.generateTransactionId();

      return {
        success: true,
        transactionId,
        status: 'succeeded',
        message: 'Cash payment processed successfully',
        nextAction: {
          type: 'await',
          data: {
            instruction: 'Please confirm cash payment in store',
          },
        },
      };
    } catch (error) {
      return this.handleError(error, 'processPayment');
    }
  }

  async refundPayment(
    paymentId: string,
    amount?: number,
  ): Promise<RefundResult> {
    try {
      this.logTransaction('REFUND_CASH_PAYMENT', { paymentId, amount });

      return {
        success: true,
        refundId: `refund_${Date.now()}`,
        amount: amount || 0,
        status: 'succeeded',
        message: 'Cash refund processed successfully',
      };
    } catch (error) {
      return {
        success: false,
        amount: amount || 0,
        status: 'failed',
        message: error.message,
      };
    }
  }

  async validatePayment(paymentData: PaymentData): Promise<boolean> {
    try {
      return Boolean(
        paymentData.amount > 0 &&
          paymentData.currency &&
          paymentData.orderId &&
          paymentData.storeId,
      );
    } catch (error) {
      return false;
    }
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    return {
      status: 'succeeded',
      transactionId,
      paidAt: new Date(),
    };
  }

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    return true;
  }
}
