import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';

export class BankTransferProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_BANK_TRANSFER', paymentData);

      const transactionId = this.generateTransactionId();
      const reference = this.generateReference();

      return {
        success: true,
        transactionId,
        status: 'pending',
        message: 'Bank transfer initiated',
        nextAction: {
          type: 'await',
          data: {
            reference,
            bankAccount: this.getBankAccount(),
            instructions: 'Transfer the amount to the provided account',
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
      this.logTransaction('REFUND_BANK_TRANSFER', { paymentId, amount });

      return {
        success: true,
        refundId: `refund_${Date.now()}`,
        amount: amount || 0,
        status: 'pending',
        message: 'Bank transfer refund initiated',
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
      status: 'pending',
      transactionId,
    };
  }

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    return true;
  }

  private generateReference(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `TRF${timestamp}${random}`;
  }

  private getBankAccount(): any {
    return (
      this.config.settings?.bankAccount || {
        bank: 'Default Bank',
        accountNumber: '****1234',
        accountType: 'Checking',
        holderName: 'Company Name',
      }
    );
  }
}
