// Phase 2 normalization: `PaymentMethod` now points to the canonical, cross-app
// model in `shared/models`. This is a structural superset of the legacy POS
// shape, so existing POS/table consumers keep compiling unchanged.
import type { PaymentMethod } from '../../../../../shared/models/payment-method.model';

export type { PaymentMethod } from '../../../../../shared/models/payment-method.model';
export { PaymentMethodType } from '../../../../../shared/models/payment-method.model';

export interface PaymentRequest {
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  cashReceived?: number;
  customerEmail?: string;
  customerPhone?: string;
  customerId?: number | string;
  customerName?: string;
  isAnonymousSale?: boolean;
  /**
   * QUI-728 (E.1) — id de `bank_accounts` elegido por el cajero en el selector
   * del payment-collector cuando el método es `bank_transfer`. Viaja en
   * snake_case porque es el nombre del campo en `CreatePosPaymentDto` /
   * `CreatePaymentDto`; el backend lo valida (existe + activa + organización +
   * `store_id`) y lo persiste en `payments.bank_account_id`. Sin él, el pago
   * cae en la pantalla "Pagos sin asignar" de E.2.
   */
  bank_account_id?: number;
  metadata?: {
    wompiPaymentMethod?: any;
    walletId?: number;
  };
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  message: string;
  change?: number;
  receiptUrl?: string;
  nextAction?: {
    type: 'redirect' | '3ds' | 'await' | 'none';
    url?: string;
    data?: any;
  };
}

export interface CashPaymentDetails {
  amountReceived: number;
  change: number;
  denominations?: CashDenomination[];
}

export interface CashDenomination {
  value: number;
  count: number;
  total: number;
}

export interface CardPaymentDetails {
  last4Digits: string;
  cardType: string;
  authCode: string;
  transactionId: string;
}

export interface Transaction {
  id: string;
  orderId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  createdAt: Date;
  reference?: string;
  details?: CashPaymentDetails | CardPaymentDetails;
}
