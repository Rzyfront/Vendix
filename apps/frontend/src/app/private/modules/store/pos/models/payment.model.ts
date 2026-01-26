export interface PaymentMethod {
  id: string;
  name: string;
  type: 'cash' | 'card' | 'transfer' | 'digital_wallet' | string;
  icon: string;
  enabled: boolean;
  requiresReference?: boolean;
  referenceLabel?: string;
}

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
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  message: string;
  change?: number;
  receiptUrl?: string;
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
