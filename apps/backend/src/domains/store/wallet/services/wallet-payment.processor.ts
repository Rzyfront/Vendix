import { BasePaymentProcessor } from '../../payments/interfaces/base-processor.interface';
import {
  PaymentData,
  PaymentResult,
  RefundResult,
  PaymentStatus,
} from '../../payments/interfaces';
import { WalletBalanceService } from './wallet-balance.service';

export class WalletPaymentProcessor extends BasePaymentProcessor {
  private balanceService: WalletBalanceService;

  constructor(balanceService: WalletBalanceService) {
    super({
      enabled: true,
      testMode: false,
      credentials: {},
      settings: {},
    });
    this.balanceService = balanceService;
  }

  async processPayment(paymentData: PaymentData): Promise<PaymentResult> {
    try {
      this.logTransaction('PROCESS_WALLET_PAYMENT', paymentData);

      const walletId = paymentData.metadata?.walletId as number;
      if (!walletId) {
        return {
          success: false,
          status: 'failed',
          message: 'Wallet ID is required in metadata.walletId',
        };
      }

      const transactionId = this.generateTransactionId();

      const result = await this.balanceService.debit(
        walletId,
        paymentData.amount,
        {
          reference_type: 'order_payment',
          reference_id: paymentData.orderId,
          description: `Payment for order #${paymentData.orderId}`,
          created_by: paymentData.customerId,
        },
      );

      return {
        success: true,
        transactionId,
        status: 'succeeded',
        message: 'Wallet payment processed successfully',
        gatewayResponse: {
          wallet_transaction_id: result.transaction.id,
          balance_after: result.balance_after,
        },
        nextAction: { type: 'none' },
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
      this.logTransaction('REFUND_WALLET_PAYMENT', { paymentId, amount });

      // Refund to wallet = credit back. The walletId needs to come from the original payment.
      // This is handled by the PaymentGatewayService which looks up the payment record.
      return {
        success: true,
        refundId: `wallet_refund_${Date.now()}`,
        amount: amount || 0,
        status: 'succeeded',
        message: 'Wallet refund will be credited back to wallet',
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
    return Boolean(paymentData.amount > 0 && paymentData.metadata?.walletId);
  }

  async getPaymentStatus(transactionId: string): Promise<PaymentStatus> {
    return {
      status: 'succeeded',
      transactionId,
      paidAt: new Date(),
    };
  }

  async validateWebhook(_signature: string, _body: string): Promise<boolean> {
    return true; // Wallet doesn't use external webhooks
  }
}
