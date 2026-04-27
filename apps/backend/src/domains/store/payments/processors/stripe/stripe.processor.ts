import * as crypto from 'crypto';
import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';

export class StripeProcessor extends BasePaymentProcessor {
  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_STRIPE_PAYMENT', paymentData);

      const transactionId = this.generateTransactionId();

      // Stripe SDK accepts `{ idempotencyKey }` as second arg of every
      // write call (e.g. `stripe.paymentIntents.create(data, { idempotencyKey })`).
      // Fall back to a fresh UUID for back-compat with legacy callers.
      const idempotencyKey =
        paymentData.idempotencyKey && paymentData.idempotencyKey.length > 0
          ? paymentData.idempotencyKey
          : crypto.randomUUID();

      if (this.isTestMode()) {
        return this.simulateTestPayment(paymentData, transactionId, idempotencyKey);
      }

      // NOTE: When the real Stripe SDK is wired up here, pass the key as the
      // second argument: stripe.paymentIntents.create(intentParams, { idempotencyKey })
      return {
        success: true,
        transactionId,
        status: 'succeeded',
        message: 'Stripe payment processed successfully',
        gatewayResponse: {
          id: transactionId,
          object: 'payment_intent',
          status: 'succeeded',
          amount: this.formatAmount(paymentData.amount),
          currency: paymentData.currency.toLowerCase(),
          idempotency_key: idempotencyKey,
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
      this.logTransaction('REFUND_STRIPE_PAYMENT', { paymentId, amount });

      const refundId = `re_${Date.now()}`;

      return {
        success: true,
        refundId,
        amount: amount || 0,
        status: 'succeeded',
        message: 'Stripe refund processed successfully',
        gatewayResponse: {
          id: refundId,
          object: 'refund',
          payment_intent: paymentId,
          amount: amount ? this.formatAmount(amount) : 0,
          status: 'succeeded',
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
          this.config.credentials?.secretKey,
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
        status: 'succeeded',
      },
    };
  }

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    if (!this.config.credentials?.webhookSecret) {
      return false;
    }

    try {
      const crypto = require('crypto');
      const webhookSecret = this.config.credentials.webhookSecret;
      const hash = crypto
        .createHmac('sha256', webhookSecret)
        .update(body, 'utf8')
        .digest('hex');

      return signature === `sha256=${hash}`;
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
        message: 'Test payment failed',
        gatewayResponse: {
          error: {
            message: 'Your card was declined.',
            type: 'card_error',
          },
          idempotency_key: idempotencyKey,
        },
      };
    }

    const requiresAction = Math.random() < 0.2;

    if (requiresAction) {
      return {
        success: true,
        transactionId,
        status: 'authorized',
        message: 'Payment requires 3D Secure authentication',
        nextAction: {
          type: '3ds',
          url: `https://js.stripe.com/v3/${transactionId}/authenticate`,
          data: {
            clientSecret: `pi_${transactionId}_secret_${Math.random().toString(36).substring(2, 15)}`,
          },
        },
        gatewayResponse: {
          id: transactionId,
          status: 'requires_action',
          next_action: {
            type: 'use_stripe_sdk',
            use_stripe_sdk: {
              type: 'three_d_secure_redirect',
              return_url: paymentData.returnUrl,
            },
          },
          idempotency_key: idempotencyKey,
        },
      };
    }

    return {
      success: true,
      transactionId,
      status: 'succeeded',
      message: 'Test payment succeeded',
      gatewayResponse: {
        id: transactionId,
        status: 'succeeded',
        amount: this.formatAmount(paymentData.amount),
        currency: paymentData.currency.toLowerCase(),
        idempotency_key: idempotencyKey,
      },
    };
  }
}
