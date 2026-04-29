import * as crypto from 'crypto';
import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';

export class PaypalProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_PAYPAL_PAYMENT', paymentData);

      const transactionId = this.generateTransactionId();

      // PayPal accepts HTTP header `PayPal-Request-Id` on POST endpoints
      // (Orders API v2, Payments API v2). A retried request with the same
      // value returns the cached prior response instead of creating a new order.
      // Fall back to a fresh UUID for back-compat with legacy callers.
      const idempotencyKey =
        paymentData.idempotencyKey && paymentData.idempotencyKey.length > 0
          ? paymentData.idempotencyKey
          : crypto.randomUUID();

      if (this.isTestMode()) {
        return this.simulateTestPayment(
          paymentData,
          transactionId,
          idempotencyKey,
        );
      }

      // NOTE: When the real PayPal SDK/HTTP client is wired up, send the key as
      // header: { 'PayPal-Request-Id': idempotencyKey }
      return {
        success: true,
        transactionId,
        status: 'succeeded',
        message: 'PayPal payment processed successfully',
        gatewayResponse: {
          id: transactionId,
          intent: 'CAPTURE',
          status: 'COMPLETED',
          purchase_units: [
            {
              amount: {
                currency_code: paymentData.currency,
                value: paymentData.amount.toFixed(2),
              },
            },
          ],
          paypal_request_id: idempotencyKey,
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
      this.logTransaction('REFUND_PAYPAL_PAYMENT', { paymentId, amount });

      const refundId = `refund_${Date.now()}`;

      return {
        success: true,
        refundId,
        amount: amount || 0,
        status: 'succeeded',
        message: 'PayPal refund processed successfully',
        gatewayResponse: {
          id: refundId,
          status: 'COMPLETED',
          amount: {
            value: amount ? amount.toFixed(2) : '0.00',
          },
        },
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
        paymentData.storeId &&
        this.config.credentials?.clientId &&
        this.config.credentials?.clientSecret,
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
      gatewayResponse: {
        id: transactionId,
        status: 'COMPLETED',
      },
    };
  }

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    if (!this.config.credentials?.webhookId) {
      return false;
    }

    try {
      return true;
    } catch (error) {
      return false;
    }
  }

  private simulateTestPayment(
    paymentData: PaymentData,
    transactionId: string,
    idempotencyKey: string,
  ): PaymentResult {
    const shouldFail = Math.random() < 0.1;

    if (shouldFail) {
      return {
        success: false,
        status: 'failed',
        message: 'PayPal test payment failed',
        gatewayResponse: {
          error: {
            message: 'Payment was declined',
            details: 'Insufficient funds',
          },
          paypal_request_id: idempotencyKey,
        },
      };
    }

    const requiresApproval = Math.random() < 0.15;

    if (requiresApproval) {
      return {
        success: true,
        transactionId,
        status: 'authorized',
        message: 'PayPal payment requires approval',
        nextAction: {
          type: 'redirect',
          url: `https://www.sandbox.paypal.com/checkoutnow?token=${transactionId}`,
          data: {
            approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${transactionId}`,
          },
        },
        gatewayResponse: {
          id: transactionId,
          status: 'CREATED',
          links: [
            {
              href: `https://www.sandbox.paypal.com/checkoutnow?token=${transactionId}`,
              rel: 'approve',
              method: 'GET',
            },
          ],
          paypal_request_id: idempotencyKey,
        },
      };
    }

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      message: 'PayPal test payment succeeded',
      gatewayResponse: {
        id: transactionId,
        status: 'COMPLETED',
        purchase_units: [
          {
            amount: {
              currency_code: paymentData.currency,
              value: paymentData.amount.toFixed(2),
            },
          },
        ],
        paypal_request_id: idempotencyKey,
      },
    };
  }
}
