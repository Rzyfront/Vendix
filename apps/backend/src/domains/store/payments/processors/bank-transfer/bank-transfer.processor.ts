import { BasePaymentProcessor } from '../../interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
  ResolvedBankAccount,
} from '../../interfaces';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';

/**
 * Processor de transferencia bancaria.
 *
 * QUI-728 — Multi-cuenta bancaria para transferencia. Antes este processor
 * leía `this.config.settings?.bankAccount` para las instrucciones de pago, pero
 * `config` era `undefined` en runtime (el módulo `BankTransferModule` lo
 * proveía plano, sin `useFactory`/`inject`), así que SIEMPRE cayña al fallback
 * por defecto. Ahora:
 *   - El constructor inyecta `StorePrismaService` (patrón `wompi.processor.ts`).
 *   - El gateway resuelve y valida la cuenta ANTES de invocar el processor y le
 *     pasa el objeto ya resuelto en `paymentData.bankAccount`;
 *   - Como red de seguridad, si el objeto no llegó, el processor resuelve la
 *     cuenta por `paymentData.bankAccountId` vía la tabla `bank_accounts`.
 */
export class BankTransferProcessor extends BasePaymentProcessor {
  constructor(private readonly prisma: StorePrismaService) {
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
   * Resuelve la cuenta bancaria de destino.
   *  1. Si el gateway ya resolvió y validó la cuenta, la usa tal cual (evita un
   *     round-trip y no confía en un id sin validar).
   *  2. Si no, intenta resolverla por id desde la tabla `bank_accounts`
   *     (red de seguridad; el gateway SIEMPRE debería pasarla resuelta).
   *  3. Si nada hay, cae al fallback legacy por compatibilidad (config legacy
   *     sin `bank_account_id`).
   */
  private async resolveBankAccount(
    paymentData: PaymentData,
  ): Promise<ResolvedBankAccount> {
    if (paymentData.bankAccount) {
      return paymentData.bankAccount;
    }

    if (paymentData.bankAccountId) {
      const account = await this.prisma.bank_accounts.findFirst({
        where: {
          id: paymentData.bankAccountId,
          status: 'active',
        },
        select: {
          id: true,
          name: true,
          bank_name: true,
          account_number: true,
          currency: true,
        },
      });
      if (account) {
        return {
          id: account.id,
          name: account.name,
          bank_name: account.bank_name,
          account_number: account.account_number,
          currency: account.currency,
        };
      }
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
