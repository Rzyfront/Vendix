import * as crypto from 'crypto';
import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { PaymentEncryptionService } from '../../services/payment-encryption.service';
import { WompiClientFactory } from './wompi.factory';
import {
  WompiConfig,
  WompiEnvironment,
  WompiTransactionStatus,
  WompiTransactionData,
  WompiPaymentMethodData,
  WompiCreateTransactionRequest,
} from './wompi.types';

export class WompiProcessor extends BasePaymentProcessor {
  constructor(
    private readonly factory: WompiClientFactory,
    private readonly prisma: StorePrismaService,
    private readonly encryption: PaymentEncryptionService,
  ) {
    super({ enabled: true, testMode: false, credentials: {}, settings: {} });
  }

  // ── Proceso de pago ─────────────────────────

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_WOMPI_PAYMENT', paymentData);

      const wompiConfig = this.resolveConfig(paymentData);
      const client = this.factory.getClient(
        `store-${paymentData.storeId}`,
        wompiConfig,
      );

      const { acceptance_token: acceptanceToken, personal_auth_token } =
        await client.getAcceptanceTokens();

      const paymentMethodData = paymentData.metadata
        ?.paymentMethod as WompiPaymentMethodData;
      if (!paymentMethodData) {
        return {
          success: false,
          status: 'failed',
          message: 'Payment method data is required in metadata.paymentMethod',
        };
      }

      const reference =
        typeof paymentData.metadata?.reference === 'string' &&
        paymentData.metadata.reference.length > 0
          ? paymentData.metadata.reference
          : `vendix_${paymentData.storeId}_${paymentData.orderId}_${Date.now()}`;

      const integritySignature = client.generateIntegritySignature(
        reference,
        this.formatAmount(paymentData.amount),
        paymentData.currency || 'COP',
      );

      const request: WompiCreateTransactionRequest = {
        acceptance_token: acceptanceToken,
        accept_personal_auth: personal_auth_token,
        amount_in_cents: this.formatAmount(paymentData.amount),
        currency: paymentData.currency || 'COP',
        customer_email:
          paymentData.metadata?.customerEmail ||
          `pos-${paymentData.storeId}@vendix.app`,
        reference,
        payment_method: paymentMethodData,
        redirect_url: paymentData.returnUrl,
        signature: integritySignature,
      };

      const idempotencyKey =
        paymentData.idempotencyKey && paymentData.idempotencyKey.length > 0
          ? paymentData.idempotencyKey
          : crypto.randomUUID();

      const response = await client.createTransaction(request, idempotencyKey);
      const txn = response.data;

      return {
        success:
          txn.status !== WompiTransactionStatus.ERROR &&
          txn.status !== WompiTransactionStatus.DECLINED,
        transactionId: txn.id,
        gatewayReference: reference,
        status: this.mapWompiStatus(txn.status),
        message: txn.status_message || `Wompi transaction ${txn.status}`,
        gatewayResponse: txn,
        nextAction: {
          ...this.resolveNextAction(paymentMethodData.type, txn)!,
          data: {
            reference,
            integritySignature,
            publicKey: wompiConfig.public_key,
          },
        },
      };
    } catch (error) {
      return this.handleError(error, 'processPayment');
    }
  }

  // ── Reembolso (void) ────────────────────────

  async refundPayment(
    paymentId: string,
    amount?: number,
  ): Promise<RefundResult> {
    try {
      this.logTransaction('REFUND_WOMPI_PAYMENT', { paymentId, amount });

      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: paymentId },
        include: { store_payment_method: true },
      });

      if (!payment?.store_payment_method) {
        return {
          success: false,
          amount: amount || 0,
          status: 'failed',
          message: 'Payment method not found for refund',
        };
      }

      const config = this.resolveDecryptedConfig(
        payment.store_payment_method.custom_config,
      );
      const client = this.factory.getClient(
        `store-${payment.store_id}`,
        config,
      );

      const response = await client.voidTransaction(paymentId);
      const txn = response.data;

      return {
        success: txn.status === WompiTransactionStatus.VOIDED,
        refundId: `void_${txn.id}`,
        amount: amount || this.parseAmount(txn.amount_in_cents),
        status:
          txn.status === WompiTransactionStatus.VOIDED ? 'succeeded' : 'failed',
        message: txn.status_message || `Transaction ${txn.status}`,
        gatewayResponse: txn,
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

  // ── Validación ──────────────────────────────

  async validatePayment(paymentData: PaymentData): Promise<boolean> {
    try {
      const hasAmount = paymentData.amount > 0;
      const hasOrder = Boolean(paymentData.orderId);
      const hasStore = Boolean(paymentData.storeId);
      const hasPaymentMethod = Boolean(paymentData.metadata?.paymentMethod);
      const hasCredentials = Boolean(
        this.config.credentials?.public_key &&
        this.config.credentials?.private_key,
      );

      return (
        hasAmount && hasOrder && hasStore && hasPaymentMethod && hasCredentials
      );
    } catch {
      return false;
    }
  }

  // ── Consulta de estado ──────────────────────

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const payment = await this.prisma.payments.findFirst({
        where: { transaction_id: transactionId },
        include: { store_payment_method: true },
      });

      if (!payment?.store_payment_method) {
        return { status: 'failed', transactionId };
      }

      const config = this.resolveDecryptedConfig(
        payment.store_payment_method.custom_config,
      );
      const client = this.factory.getClient(
        `store-${payment.store_id}`,
        config,
      );

      const response = await client.getTransaction(transactionId);
      const txn = response.data;

      return {
        status: this.mapWompiStatus(txn.status),
        transactionId: txn.id,
        amount: this.parseAmount(txn.amount_in_cents),
        paidAt:
          txn.status === WompiTransactionStatus.APPROVED
            ? new Date(txn.created_at)
            : undefined,
        gatewayResponse: txn,
      };
    } catch {
      return {
        status: 'failed',
        transactionId,
      };
    }
  }

  /**
   * Fetch the latest Wompi transaction by Vendix-generated reference
   * using store credentials resolved from the payment record.
   */
  async getTransactionByReference(
    reference: string,
  ): Promise<WompiTransactionData | null> {
    try {
      // Attempt to resolve the store from a payment with this reference
      const payment = await this.prisma.payments.findFirst({
        where: { gateway_reference: reference },
        include: { store_payment_method: true },
      });

      if (payment?.store_payment_method) {
        const config = this.resolveDecryptedConfig(
          payment.store_payment_method.custom_config,
        );
        const client = this.factory.getClient(
          `store-${payment.store_id}`,
          config,
        );
        return this.fetchLatestByReference(client, reference);
      }

      // Fallback: no store context, cannot build client — return null
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Same as getTransactionByReference but uses an explicitly provided
   * config (used by PaymentsService.confirmPosWompiPayment to avoid a
   * second DB round-trip after it already decrypted the credentials).
   */
  async getTransactionByReferenceWithConfig(
    reference: string,
    config: WompiConfig,
  ): Promise<WompiTransactionData | null> {
    try {
      const client = this.factory.getClient(`ref-${reference}`, config);
      return this.fetchLatestByReference(client, reference);
    } catch {
      return null;
    }
  }

  /**
   * Same as getPaymentStatus but uses an explicitly provided config.
   */
  async getPaymentStatusWithConfig(
    transactionId: string,
    config: WompiConfig,
  ): Promise<PaymentStatus> {
    try {
      const client = this.factory.getClient(`txn-${transactionId}`, config);
      const response = await client.getTransaction(transactionId);
      const txn = response.data;

      return {
        status: this.mapWompiStatus(txn.status),
        transactionId: txn.id,
        amount: this.parseAmount(txn.amount_in_cents),
        paidAt:
          txn.status === WompiTransactionStatus.APPROVED
            ? new Date(txn.created_at)
            : undefined,
        gatewayResponse: txn,
      };
    } catch {
      return { status: 'failed', transactionId };
    }
  }

  /**
   * Validate a Wompi webhook signature using an explicitly provided config.
   */
  validateWebhookWithConfig(body: string, config: WompiConfig): boolean {
    try {
      const event = JSON.parse(body);
      const client = this.factory.getClient(
        `webhook-${config.public_key}`,
        config,
      );
      return client.validateWebhookSignature(event);
    } catch {
      return false;
    }
  }

  // ── Webhook (legacy interface, kept for compat) ─────────────────

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    try {
      const event = JSON.parse(body);
      // Without a config we cannot validate — callers should use
      // validateWebhookWithConfig instead.
      if (!this.config.credentials?.public_key) {
        return false;
      }
      const client = this.factory.getClient('legacy-webhook', {
        public_key: this.config.credentials.public_key as string,
        private_key: this.config.credentials.private_key as string,
        events_secret: this.config.credentials.events_secret as string,
        integrity_secret: this.config.credentials.integrity_secret as string,
        environment:
          (this.config.credentials.environment as WompiEnvironment) ||
          WompiEnvironment.SANDBOX,
      });
      return client.validateWebhookSignature(event);
    } catch {
      return false;
    }
  }

  // ── Helpers privados ────────────────────────

  private resolveConfig(paymentData: PaymentData): WompiConfig {
    const creds = paymentData.metadata?.wompiConfig || this.config.credentials;

    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret || '',
      integrity_secret: creds.integrity_secret || '',
      environment: creds.environment || WompiEnvironment.SANDBOX,
    };
  }

  private resolveDecryptedConfig(rawConfig: any): WompiConfig {
    const decrypted = this.encryption.decryptConfig(
      (rawConfig || {}) as Record<string, any>,
      'wompi',
    );
    return {
      public_key: decrypted.public_key || '',
      private_key: decrypted.private_key || '',
      events_secret: decrypted.events_secret || '',
      integrity_secret: decrypted.integrity_secret || '',
      environment:
        (decrypted.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };
  }

  private mapWompiStatus(
    status: WompiTransactionStatus,
  ): PaymentResult['status'] {
    const statusMap: Record<WompiTransactionStatus, PaymentResult['status']> = {
      [WompiTransactionStatus.PENDING]: 'pending',
      [WompiTransactionStatus.APPROVED]: 'succeeded',
      [WompiTransactionStatus.DECLINED]: 'failed',
      [WompiTransactionStatus.VOIDED]: 'cancelled',
      [WompiTransactionStatus.ERROR]: 'failed',
    };
    return statusMap[status] || 'pending';
  }

  private resolveNextAction(
    paymentMethodType: string,
    txn: WompiTransactionData,
  ): PaymentResult['nextAction'] {
    if (txn.status === WompiTransactionStatus.APPROVED) {
      return { type: 'none' };
    }
    if (
      txn.status === WompiTransactionStatus.DECLINED ||
      txn.status === WompiTransactionStatus.ERROR
    ) {
      return { type: 'none' };
    }

    switch (paymentMethodType) {
      case 'NEQUI':
        return { type: 'await' };

      case 'PSE':
        return {
          type: 'redirect',
          url: txn.redirect_url,
        };

      case 'BANCOLOMBIA_TRANSFER':
        return {
          type: 'redirect',
          url: txn.payment_method?.extra?.async_payment_url || txn.redirect_url,
        };

      case 'CARD':
        return txn.status === WompiTransactionStatus.PENDING
          ? { type: '3ds', url: txn.redirect_url }
          : { type: 'none' };

      case 'BANCOLOMBIA_QR':
        return {
          type: 'await',
          data: txn.payment_method?.extra?.qr_image
            ? { qrImage: txn.payment_method.extra.qr_image }
            : undefined,
        };

      case 'DAVIPLATA':
        return { type: 'await' };

      case 'BANCOLOMBIA_BNPL':
      case 'SU_PLUS':
      case 'PCOL':
        return { type: 'redirect', url: txn.redirect_url };

      case 'BANCOLOMBIA_COLLECT':
        return { type: 'await' };

      default:
        return { type: 'none' };
    }
  }

  private fetchLatestByReference(
    client: import('./wompi.client').WompiClient,
    reference: string,
  ): Promise<WompiTransactionData | null> {
    return client
      .getTransactionsByReference(reference)
      .then((response: any) => {
        const txns = response?.data ?? [];
        if (txns.length === 0) return null;
        return txns.reduce((latest: any, candidate: any) => {
          if (!latest) return candidate;
          return new Date(candidate.created_at) > new Date(latest.created_at)
            ? candidate
            : latest;
        }, txns[0]);
      })
      .catch(() => null);
  }

  private simulateTestPayment(
    paymentData: PaymentData,
    transactionId: string,
  ): PaymentResult {
    const shouldFail = Math.random() < 0.1;

    if (shouldFail) {
      return {
        success: false,
        status: 'failed',
        message: 'Test Wompi payment failed (simulated)',
        gatewayResponse: {
          status: WompiTransactionStatus.DECLINED,
          status_message: 'Declined by test simulation',
        },
      };
    }

    const paymentMethodType =
      paymentData.metadata?.paymentMethod?.type || 'CARD';

    const simulatedTxn: WompiTransactionData = {
      id: transactionId,
      created_at: new Date().toISOString(),
      status: WompiTransactionStatus.APPROVED,
      amount_in_cents: this.formatAmount(paymentData.amount),
      currency: paymentData.currency || 'COP',
      reference: `vendix_test_${paymentData.orderId}_${Date.now()}`,
      payment_method_type: paymentMethodType,
      payment_method: {},
      redirect_url: paymentData.returnUrl,
    };

    return {
      success: true,
      transactionId,
      status: this.mapWompiStatus(simulatedTxn.status),
      message: `Test Wompi payment ${simulatedTxn.status.toLowerCase()}`,
      gatewayResponse: simulatedTxn,
      nextAction: this.resolveNextAction(paymentMethodType, simulatedTxn),
    };
  }
}
