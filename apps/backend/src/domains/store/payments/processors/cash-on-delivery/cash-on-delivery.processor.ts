import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';

export class CashOnDeliveryPaymentProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_COD_PAYMENT', paymentData);

      const transactionId = this.generateTransactionId();

      return {
        success: true,
        transactionId,
        status: 'pending',
        message:
          'Cash on delivery payment registered. Awaiting courier delivery and admin confirmation.',
        nextAction: {
          type: 'await',
          data: {
            instruction:
              'Confirmar el cobro en el panel de administración una vez el repartidor entregue el pedido y reciba el pago (efectivo o comprobante de transferencia).',
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
      this.logTransaction('REFUND_COD_PAYMENT', { paymentId, amount });

      return {
        success: true,
        refundId: `refund_${Date.now()}`,
        amount: amount || 0,
        status: 'succeeded',
        message: 'Cash on delivery refund processed successfully',
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
}
