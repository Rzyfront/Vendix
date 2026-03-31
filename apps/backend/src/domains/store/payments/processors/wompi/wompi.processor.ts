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

      const transactionId = this.generateTransactionId();

      if (this.isTestMode() || wompiConfig.environment === WompiEnvironment.SANDBOX) {
        return this.simulateTestPayment(paymentData, transactionId);
      }

      // Obtener acceptance token
      const acceptanceToken = await this.client.getAcceptanceToken();

      // Construir payment method data desde metadata
      const paymentMethodData = paymentData.metadata?.paymentMethod as WompiPaymentMethodData;
      if (!paymentMethodData) {
        return {
          success: false,
          status: 'failed',
          message: 'Payment method data is required in metadata.paymentMethod',
        };
      }

      const reference = `vendix_${paymentData.storeId}_${paymentData.orderId}_${Date.now()}`;

      const request: WompiCreateTransactionRequest = {
        acceptance_token: acceptanceToken,
        amount_in_cents: this.formatAmount(paymentData.amount),
        currency: paymentData.currency || 'COP',
        customer_email: paymentData.metadata?.customerEmail || '',
        reference,
        payment_method: paymentMethodData,
        redirect_url: paymentData.returnUrl,
      };

      const response = await this.client.createTransaction(request);
      const txn = response.data;

      return {
        success: txn.status !== WompiTransactionStatus.ERROR && txn.status !== WompiTransactionStatus.DECLINED,
        transactionId: txn.id,
        status: this.mapWompiStatus(txn.status),
        message: txn.status_message || `Wompi transaction ${txn.status}`,
        gatewayResponse: txn,
        nextAction: this.resolveNextAction(paymentMethodData.type, txn),
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
    txn: { status: WompiTransactionStatus; redirect_url?: string },
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
      case 'BANCOLOMBIA_TRANSFER':
        // Redirigir al banco / Bancolombia
        return {
          type: 'redirect',
          url: txn.redirect_url,
        };

      case 'CARD':
        // Si está PENDING puede requerir 3DS
        return txn.status === WompiTransactionStatus.PENDING
          ? { type: '3ds', url: txn.redirect_url }
          : { type: 'none' };

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

    const simulatedTxn = {
      id: transactionId,
      status: WompiTransactionStatus.APPROVED,
      amount_in_cents: this.formatAmount(paymentData.amount),
      currency: paymentData.currency || 'COP',
      reference: `vendix_test_${paymentData.orderId}_${Date.now()}`,
      payment_method_type: paymentMethodType,
      redirect_url: paymentData.returnUrl,
    };

    // Para métodos asincrónicos, simular PENDING en lugar de APPROVED
    const asyncMethods = ['NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER'];
    if (asyncMethods.includes(paymentMethodType)) {
      simulatedTxn.status = WompiTransactionStatus.PENDING;
    }

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
