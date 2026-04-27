import * as crypto from 'crypto';
import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../interfaces';
import {
  WompiClient,
} from './wompi.client';
import {
  WompiConfig,
  WompiEnvironment,
  WompiTransactionStatus,
  WompiTransactionData,
  WompiPaymentMethodData,
  WompiCreateTransactionRequest,
} from './wompi.types';

export class WompiProcessor extends BasePaymentProcessor {
  private client: WompiClient;

  constructor(client: WompiClient) {
    super({ enabled: true, testMode: false, credentials: {}, settings: {} });
    this.client = client;
  }

  // ── Proceso de pago ─────────────────────────

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_WOMPI_PAYMENT', paymentData);

      // Configurar client con credenciales del metadata del store
      const wompiConfig = this.resolveConfig(paymentData);
      this.client.configure(wompiConfig);

      // Obtener acceptance tokens
      const { acceptance_token: acceptanceToken, personal_auth_token } = await this.client.getAcceptanceTokens();

      // Construir payment method data desde metadata
      const paymentMethodData = paymentData.metadata?.paymentMethod as WompiPaymentMethodData;
      if (!paymentMethodData) {
        return {
          success: false,
          status: 'failed',
          message: 'Payment method data is required in metadata.paymentMethod',
        };
      }

      // SaaS billing path injects a `reference` string in metadata so the
      // platform-level transaction can be distinguished from per-store/POS/
      // eCommerce flows in Wompi reports. eCommerce/POS callers omit it and
      // we generate the legacy `vendix_<storeId>_<orderId>_<ts>` shape.
      const reference =
        typeof paymentData.metadata?.reference === 'string' &&
        paymentData.metadata.reference.length > 0
          ? paymentData.metadata.reference
          : `vendix_${paymentData.storeId}_${paymentData.orderId}_${Date.now()}`;

      const integritySignature = this.client.generateIntegritySignature(
        reference,
        this.formatAmount(paymentData.amount),
        paymentData.currency || 'COP',
      );

      const request: WompiCreateTransactionRequest = {
        acceptance_token: acceptanceToken,
        accept_personal_auth: personal_auth_token,
        amount_in_cents: this.formatAmount(paymentData.amount),
        currency: paymentData.currency || 'COP',
        customer_email: paymentData.metadata?.customerEmail || `pos-${paymentData.storeId}@vendix.app`,
        reference,
        payment_method: paymentMethodData,
        redirect_url: paymentData.returnUrl,
        signature: integritySignature,
      };

      // Wompi: Idempotency-Key HTTP header. Fall back to a fresh UUID for
      // back-compat with callers (eCommerce) that have not yet been updated.
      const idempotencyKey =
        paymentData.idempotencyKey && paymentData.idempotencyKey.length > 0
          ? paymentData.idempotencyKey
          : crypto.randomUUID();

      const response = await this.client.createTransaction(request, idempotencyKey);
      const txn = response.data;

      return {
        success: txn.status !== WompiTransactionStatus.ERROR && txn.status !== WompiTransactionStatus.DECLINED,
        transactionId: txn.id,
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

  async refundPayment(paymentId: string, amount?: number): Promise<RefundResult> {
    try {
      this.logTransaction('REFUND_WOMPI_PAYMENT', { paymentId, amount });

      // Wompi soporta void completo, no refund parcial nativo
      const response = await this.client.voidTransaction(paymentId);
      const txn = response.data;

      return {
        success: txn.status === WompiTransactionStatus.VOIDED,
        refundId: `void_${txn.id}`,
        amount: amount || this.parseAmount(txn.amount_in_cents),
        status: txn.status === WompiTransactionStatus.VOIDED ? 'succeeded' : 'failed',
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

      return hasAmount && hasOrder && hasStore && hasPaymentMethod && hasCredentials;
    } catch {
      return false;
    }
  }

  // ── Consulta de estado ──────────────────────

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    try {
      const response = await this.client.getTransaction(transactionId);
      const txn = response.data;

      return {
        status: this.mapWompiStatus(txn.status),
        transactionId: txn.id,
        amount: this.parseAmount(txn.amount_in_cents),
        paidAt: txn.status === WompiTransactionStatus.APPROVED ? new Date(txn.created_at) : undefined,
        gatewayResponse: txn,
      };
    } catch {
      return {
        status: 'failed',
        transactionId,
      };
    }
  }

  // ── Webhook ─────────────────────────────────

  async validateWebhook(signature: string, body: string): Promise<boolean> {
    try {
      const event = JSON.parse(body);
      return this.client.validateWebhookSignature(event);
    } catch {
      return false;
    }
  }

  // ── Helpers privados ────────────────────────

  private resolveConfig(paymentData: PaymentData): WompiConfig {
    // Las credenciales vienen del metadata (inyectadas por PaymentGatewayService)
    // o del config del procesador (store_payment_methods.custom_config)
    const creds = paymentData.metadata?.wompiConfig || this.config.credentials;

    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret || '',
      integrity_secret: creds.integrity_secret || '',
      environment: creds.environment || WompiEnvironment.SANDBOX,
    };
  }

  private mapWompiStatus(status: WompiTransactionStatus): PaymentResult['status'] {
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
    // Si ya fue aprobada o falló, no hay acción siguiente
    if (txn.status === WompiTransactionStatus.APPROVED) {
      return { type: 'none' };
    }
    if (txn.status === WompiTransactionStatus.DECLINED || txn.status === WompiTransactionStatus.ERROR) {
      return { type: 'none' };
    }

    switch (paymentMethodType) {
      case 'NEQUI':
        // El usuario confirma en su celular, Wompi notifica vía webhook
        return { type: 'await' };

      case 'PSE':
        // Redirigir al banco
        return {
          type: 'redirect',
          url: txn.redirect_url,
        };

      case 'BANCOLOMBIA_TRANSFER':
        // Bancolombia devuelve la URL en payment_method.extra.async_payment_url
        return {
          type: 'redirect',
          url: txn.payment_method?.extra?.async_payment_url || txn.redirect_url,
        };

      case 'CARD':
        // Si está PENDING puede requerir 3DS
        return txn.status === WompiTransactionStatus.PENDING
          ? { type: '3ds', url: txn.redirect_url }
          : { type: 'none' };

      case 'BANCOLOMBIA_QR':
        // Bancolombia QR devuelve imagen base64 en payment_method.extra.qr_image
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
      (paymentData.metadata?.paymentMethod as any)?.type || 'CARD';

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

    // En sandbox, los métodos async se auto-aprueban inmediatamente
    // porque no hay webhook real que confirme el pago.
    // En producción, Wompi devuelve PENDING y notifica vía webhook.

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
