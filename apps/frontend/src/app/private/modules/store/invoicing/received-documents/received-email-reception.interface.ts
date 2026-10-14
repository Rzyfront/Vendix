export const RECEIVED_EMAIL_REASON_CODES = [
  'RECEIVER_MISMATCH', 'FINAL_CONSUMER', 'MISSING_FISCAL_XML', 'PROVIDER_SENT_LINK',
  'CORRUPT_OR_ENCRYPTED_FILE', 'TEST_DOCUMENT', 'INVALID_ENVIRONMENT', 'SUPPORT_DOCUMENT_NOT_RECEIVABLE',
  'UNSUPPORTED_DOCUMENT_TYPE', 'INVALID_FISCAL_XML', 'RECEIVER_ID_AMBIGUOUS', 'UNSUPPORTED_ENCODING',
  'DUPLICATE', 'DUPLICATE_OTHER_STORE', 'DOCUMENT_KEY_CONFLICT', 'NOT_AN_INVOICE', 'VIRUS_BLOCKED',
  'SECURITY_SCAN_UNAVAILABLE', 'SUSPICIOUS_EMAIL', 'TNEF_UNSUPPORTED', 'ARCHIVE_FORMAT_UNSUPPORTED',
  'LIMIT_EXCEEDED', 'NESTING_LIMIT_EXCEEDED', 'PDF_ASSOCIATION_AMBIGUOUS', 'EMAIL_RECEPTION_PAUSED',
  'FISCAL_GATE_BLOCKED', 'SUBSCRIPTION_BLOCKED', 'DAILY_QUOTA_EXCEEDED', 'GMAIL_VERIFICATION_CODE',
  'GMAIL_CODE_UNAVAILABLE', 'TECHNICAL_PROCESSING_ERROR', 'RAW_EXPIRED',
] as const;
export type ReceivedEmailReasonCode = typeof RECEIVED_EMAIL_REASON_CODES[number];
export type ReceivedEmailState = 'received' | 'processing' | 'processed' | 'partial' | 'not_processed' | 'failed' | 'ignored';
export type ReceivedEmailWarning = 'DIAN_RECEIPT_MISSING' | 'DIAN_RECEIPT_REFERENCE_MISMATCH' | 'RECEIVER_DV_ATTACHED' | 'COMPLEMENT_ARCHIVE_NOT_EXPANDED';
export type ReceivedEmailProvider = 'gmail' | 'outlook' | 'microsoft365' | 'suppliers';

/** HTTP timestamps are ISO strings, not backend Date instances. */
export interface ReceivedEmailStatus {
  pilot_available: boolean;
  configured: boolean;
  enabled: boolean;
  active_inboxes: number;
  state: 'inactive' | 'waiting' | 'working' | 'paused' | 'attention';
  first_valid_received_at: string | null;
  last_email_at: string | null;
  last_valid_received_at: string | null;
  last_error_code: ReceivedEmailReasonCode | null;
  not_processed_count: number;
}

export interface ReceivedEmailConfiguration {
  configured: boolean;
  address: string | null;
  version: number | null;
  enabled: boolean;
  policy_version: string;
}
export interface ReceivedEmailGmailCode { available: boolean; code: string | null; expires_at: string | null }
export interface ReceivedEmailReasonDetails { receiver_tax_id?: string; expected_receiver_tax_id?: string }
export interface ReceivedEmailMessagePart {
  message_index: number;
  ordinal: number;
  filename: string;
  kind: 'xml' | 'zip' | 'pdf' | 'eml' | 'other';
  role?: 'container' | 'commercial' | 'dian_receipt' | 'representation' | 'complement';
  status: ReceivedEmailState;
  reason_code?: ReceivedEmailReasonCode;
  reason_details?: ReceivedEmailReasonDetails;
  warnings?: ReceivedEmailWarning[];
  document_id?: number;
}
/** No raw body, HTML, pointer, alias, code, facts or checkpoint are part of history. */
export interface ReceivedEmailMessage {
  id: number;
  version: number;
  received_at: string;
  processed_at: string | null;
  status: ReceivedEmailState;
  reason_code: ReceivedEmailReasonCode | null;
  retryable: boolean;
  can_retry: boolean;
  archived_at: string | null;
  sender: string | null;
  subject: string | null;
  parts: ReceivedEmailMessagePart[];
}
export interface ReceivedEmailMessagesPage {
  data: ReceivedEmailMessage[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}
export interface ReceivedEmailMessagesQuery { page?: number; limit?: number; view?: 'history' | 'not_processed'; archived?: boolean }
export interface ActivateReceivedEmailInput { consent: true; policy_version: string }
export interface UpdateReceivedEmailInput { expected_version: number; enabled: boolean }
export interface RotateReceivedEmailInput { expected_version: number; confirmed: true }
export interface DiscardReceivedEmailInput { expected_version: number; reason?: string }
export interface ReceivedEmailRetry { id: number; version: number; requested: true }
export type ReceivedEmailReasonAction = 'supplier' | 'manual' | 'history' | 'configure' | 'subscription' | 'support' | 'retry' | 'forwarding' | 'limits' | 'administrator' | 'document';
export interface ReceivedEmailReasonCopy { title: string; description: string; action: ReceivedEmailReasonAction; actionLabel: string }
