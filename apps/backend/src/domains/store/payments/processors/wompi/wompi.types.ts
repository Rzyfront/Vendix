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
  BANCOLOMBIA_QR = 'BANCOLOMBIA_QR',
  DAVIPLATA = 'DAVIPLATA',
  BANCOLOMBIA_BNPL = 'BANCOLOMBIA_BNPL',
  SU_PLUS = 'SU_PLUS',
  PCOL = 'PCOL',
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

export interface WompiBancolombiaQrPaymentMethod {
  type: 'BANCOLOMBIA_QR';
  payment_description?: string;
  sandbox_status?: WompiTransactionStatus;
}

export interface WompiDaviplataPaymentMethod {
  type: 'DAVIPLATA';
  user_legal_id: string;
  user_legal_id_type: string;
  payment_description?: string;
}

export interface WompiBancolombiaBnplPaymentMethod {
  type: 'BANCOLOMBIA_BNPL';
  name: string;
  last_name: string;
  user_legal_id_type: string;
  user_legal_id: string;
  phone_number: string;
  phone_code: string;
  redirect_url: string;
  payment_description?: string;
}

export interface WompiSuPlusPaymentMethod {
  type: 'SU_PLUS';
  user_legal_id_type: string;
  user_legal_id: string;
}

export interface WompiPcolPaymentMethod {
  type: 'PCOL';
}

export type WompiPaymentMethodData =
  | WompiCardPaymentMethod
  | WompiNequiPaymentMethod
  | WompiPsePaymentMethod
  | WompiBancolombiaTransferPaymentMethod
  | WompiBancolombiaCollectPaymentMethod
  | WompiBancolombiaQrPaymentMethod
  | WompiDaviplataPaymentMethod
  | WompiBancolombiaBnplPaymentMethod
  | WompiSuPlusPaymentMethod
  | WompiPcolPaymentMethod;

// ── Request / Response ──────────────────────

export interface WompiCreateTransactionRequest {
  acceptance_token: string;
  accept_personal_auth: string;
  amount_in_cents: number;
  currency: string;
  customer_email: string;
  reference: string;
  payment_method: WompiPaymentMethodData;
  redirect_url?: string;
  signature?: string;
  customer_data?: {
    phone_number?: string;
    full_name?: string;
  };
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
    presigned_personal_data_auth: {
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

// ── Payment Links ─────────────────────────────

export interface WompiCreatePaymentLinkRequest {
  name: string;
  description: string;
  single_use: boolean;
  collect_shipping: boolean;
  amount_in_cents?: number | null;
  currency?: string;
  expires_at?: string;
  redirect_url?: string;
  image_url?: string;
  sku?: string;
  customer_data?: {
    customer_references?: Array<{ label: string; is_required: boolean }>;
  };
}

export interface WompiPaymentLinkData {
  id: string;
  name: string;
  description: string;
  single_use: boolean;
  collect_shipping: boolean;
  active: boolean;
  amount_in_cents: number | null;
  currency: string;
  expires_at: string | null;
  redirect_url: string | null;
  image_url: string | null;
  sku: string | null;
  created_at: string;
  updated_at: string;
}

export interface WompiPaymentLinkResponse {
  data: WompiPaymentLinkData;
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
