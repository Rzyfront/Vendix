import { payments_state_enum } from '@prisma/client';

export interface PaymentData {
  orderId: number;
  customerId?: number;
  amount: number;
  currency: string;
  paymentMethodId: number;
  storeId: number;
  metadata?: Record<string, any>;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  status: payments_state_enum;
  message?: string;
  gatewayResponse?: any;
  nextAction?: {
    type: 'redirect' | '3ds' | 'await' | 'none';
    url?: string;
    data?: any;
  };
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  amount: number;
  status: 'succeeded' | 'failed' | 'pending';
  message?: string;
  gatewayResponse?: any;
}

export interface PaymentStatus {
  status: payments_state_enum;
  transactionId?: string;
  amount?: number;
  paidAt?: Date;
  gatewayResponse?: any;
}

export interface WebhookEvent {
  processor: string;
  eventType: string;
  data: any;
  signature?: string;
  rawBody?: string;
}

export interface PaymentProcessorConfig {
  enabled: boolean;
  testMode: boolean;
  credentials: Record<string, any>;
  settings: Record<string, any>;
}

export interface OrderValidationResult {
  valid: boolean;
  order?: any;
  errors?: string[];
  warnings?: string[];
}
