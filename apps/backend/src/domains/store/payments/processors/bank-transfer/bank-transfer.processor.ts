import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
  ResolvedBankAccount,
} from '../../interfaces';

/**
 * Processor de transferencia bancaria.
 *
 * QUI-728 — Multi-cuenta bancaria para transferencia. Antes este processor
 * leía `this.config.settings?.bankAccount` para las instrucciones de pago, pero
 * `config` era `undefined` en runtime (el módulo `BankTransferModule` lo
 * proveía plano, sin `useFactory`/`inject`), así que SIEMPRE caía al fallback
 * por defecto.
 *
 * QUI-727 (F.1) / ADR-3 — el processor NO resuelve la cuenta por id. Ese
 * fallback consultaba `bank_accounts` sólo por `status:'active'`, sin
 * comprobación de organización ni de tienda (StorePrismaService es org-scoped
 * pero NO store-scoped), saltando la validación `store_id === null || === storeId`
 * que el gateway impone en `processPayment`. La cuenta SIEMPRE la resuelve y
 * valida el gateway ANTES de invocar al processor y se la pasa en
 * `paymentData.bankAccount`. Si el objeto no llega (llamador sin validación
 * previa), se usa el placeholder legacy genérico sin tocar la tabla. El
 * processor ya no inyecta `StorePrismaService`.
 */
export class BankTransferProcessor extends BasePaymentProcessor {
  constructor() {
    super({ enabled: true, testMode: false, credentials: {}, settings: {} });
  }

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_BANK_TRANSFER', paymentData);

      const transactionId = this.generateTransactionId();
      const reference = this.generateReference();
      const bankAccount = await this.resolveBankAccount(paymentData);

      return {
        success: true,
        transactionId,
        status: 'pending',
        message: 'Bank transfer initiated',
        nextAction: {
          type: 'await',
          data: {
            reference,
            bankAccount,
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

  /**
   * Devuelve la cuenta bancaria de destino.
   *  1. Si el gateway ya resolvió y validó la cuenta (SIEMPRE lo hace en
   *     `processPayment`), la usa tal cual — no hay round-trip ni se confía en
   *     un id sin validar.
   *  2. Si no llegó (llamador sin validación previa), NO se consulta la tabla:
   *     ADR-3 prohíbe que el processor re-resuelva la cuenta saltando el scope
   *     de tienda. Se cae al placeholder legacy genérico.
   */
  private async resolveBankAccount(
    paymentData: PaymentData,
  ): Promise<ResolvedBankAccount> {
    if (paymentData.bankAccount) {
      return paymentData.bankAccount;
    }

    // Fallback legacy (config plana sin accounts) — QUI-728 no debe romper una
    // config que todavía no se migró. `config.settings` viene de `super()`.
    const legacy = (this.config.settings as any)?.bankAccount as
      | { bank?: string; accountNumber?: string; accountHolder?: string }
      | undefined;
    return {
      id: 0,
      name: legacy?.accountHolder || 'Empresa',
      bank_name: legacy?.bank || 'Banco',
      account_number: legacy?.accountNumber || '****',
      currency: 'COP',
    };
  }

  private generateReference(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `TRF${timestamp}${random}`;
  }
}
