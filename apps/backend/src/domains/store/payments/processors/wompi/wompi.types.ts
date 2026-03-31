// ──────────────────────────────────────────────
// Wompi Colombia – API Types
// ──────────────────────────────────────────────

/** Métodos de pago soportados por Wompi */
export enum WompiPaymentMethod {
  CARD = 'CARD',
  NEQUI = 'NEQUI',
  PSE = 'PSE',
  BANCOLOMBIA_TRANSFER = 'BANCOLOMBIA_TRANSFER',
  BANCOLOMBIA_COLLECT = 'BANCOLOMBIA_COLLECT',
}

/** Estados de transacción en Wompi */
export enum WompiTransactionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED',
  ERROR = 'ERROR',
}

/** Ambiente Wompi */
export enum WompiEnvironment {
  SANDBOX = 'SANDBOX',
  PRODUCTION = 'PRODUCTION',
}

// ── Payment method data por tipo ────────────

export interface WompiCardPaymentMethod {
  type: 'CARD';
  token: string;
  installments: number;
}

export interface WompiNequiPaymentMethod {
  type: 'NEQUI';
  phone_number: string;
}

export interface WompiPsePaymentMethod {
  type: 'PSE';
  /** 0 = persona natural, 1 = persona jurídica */
  user_type: 0 | 1;
  user_legal_id_type: string;
  user_legal_id: string;
  financial_institution_code: string;
  payment_description: string;
}

export interface WompiBancolombiaTransferPaymentMethod {
  type: 'BANCOLOMBIA_TRANSFER';
  sandbox_status?: WompiTransactionStatus;
}

export interface WompiBancolombiaCollectPaymentMethod {
  type: 'BANCOLOMBIA_COLLECT';
  sandbox_status?: WompiTransactionStatus;
}

export type WompiPaymentMethodData =
  | WompiCardPaymentMethod
  | WompiNequiPaymentMethod
  | WompiPsePaymentMethod
  | WompiBancolombiaTransferPaymentMethod
  | WompiBancolombiaCollectPaymentMethod;

// ── Request / Response ──────────────────────

export interface WompiCreateTransactionRequest {
  acceptance_token: string;
  amount_in_cents: number;
  currency: string;
  customer_email: string;
  reference: string;
  payment_method: WompiPaymentMethodData;
  redirect_url?: string;
}

export interface WompiTransactionData {
  id: string;
  created_at: string;
  amount_in_cents: number;
  reference: string;
  currency: string;
  payment_method_type: string;
  payment_method: Record<string, any>;
  status: WompiTransactionStatus;
  status_message?: string;
  redirect_url?: string;
  payment_link_id?: string;
}

export interface WompiTransactionResponse {
  data: WompiTransactionData;
}

export interface WompiMerchantResponse {
  data: {
    id: number;
    name: string;
    presigned_acceptance: {
      acceptance_token: string;
      permalink: string;
      type: string;
    };
  };
}

export interface WompiFinancialInstitution {
  financial_institution_code: string;
  financial_institution_name: string;
}

// ── Webhook ─────────────────────────────────

export interface WompiWebhookSignature {
  properties: string[];
  checksum: string;
}

export interface WompiWebhookEvent {
  event: string;
  data: {
    transaction: {
      id: string;
      status: WompiTransactionStatus;
      amount_in_cents: number;
      reference: string;
      payment_method_type: string;
      currency: string;
    };
  };
  sent_at: string;
  timestamp: number;
  signature: WompiWebhookSignature;
  environment: string;
}

// ── Config ──────────────────────────────────

export interface WompiConfig {
  public_key: string;
  /** prv_test_ o prv_prod_ */
  private_key: string;
  events_secret: string;
  integrity_secret: string;
  environment: WompiEnvironment;
}
