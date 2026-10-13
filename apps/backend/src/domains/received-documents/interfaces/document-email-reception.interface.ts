import type { TenantFiscalIdentity } from '../../../common/helpers/fiscal-identity.helper';
import type { OrganizationFiscalScope } from '../../../common/services/fiscal-scope.service';

export const DOCUMENT_EMAIL_STATES = ['received', 'processing', 'processed', 'partial', 'not_processed', 'failed', 'ignored'] as const;
export type DocumentEmailState = typeof DOCUMENT_EMAIL_STATES[number];
export const DOCUMENT_EMAIL_REASON_CODES = [
  'RECEIVER_MISMATCH',
  'FINAL_CONSUMER',
  'MISSING_FISCAL_XML',
  'PROVIDER_SENT_LINK',
  'CORRUPT_OR_ENCRYPTED_FILE',
  'TEST_DOCUMENT',
  'INVALID_ENVIRONMENT',
  'SUPPORT_DOCUMENT_NOT_RECEIVABLE',
  'UNSUPPORTED_DOCUMENT_TYPE',
  'INVALID_FISCAL_XML',
  'RECEIVER_ID_AMBIGUOUS',
  'UNSUPPORTED_ENCODING',
  'DUPLICATE',
  'DUPLICATE_OTHER_STORE',
  'DOCUMENT_KEY_CONFLICT',
  'NOT_AN_INVOICE',
  'VIRUS_BLOCKED',
  'SECURITY_SCAN_UNAVAILABLE',
  'SUSPICIOUS_EMAIL',
  'TNEF_UNSUPPORTED',
  'ARCHIVE_FORMAT_UNSUPPORTED',
  'LIMIT_EXCEEDED',
  'NESTING_LIMIT_EXCEEDED',
  'PDF_ASSOCIATION_AMBIGUOUS',
  'EMAIL_RECEPTION_PAUSED',
  'FISCAL_GATE_BLOCKED',
  'SUBSCRIPTION_BLOCKED',
  'DAILY_QUOTA_EXCEEDED',
  'GMAIL_VERIFICATION_CODE',
  'GMAIL_CODE_UNAVAILABLE',
  'TECHNICAL_PROCESSING_ERROR',
  'RAW_EXPIRED',
] as const;
export type DocumentEmailReasonCode = typeof DOCUMENT_EMAIL_REASON_CODES[number];
export const DOCUMENT_EMAIL_WARNINGS = ['DIAN_RECEIPT_MISSING', 'DIAN_RECEIPT_REFERENCE_MISMATCH', 'RECEIVER_DV_ATTACHED', 'COMPLEMENT_ARCHIVE_NOT_EXPANDED'] as const;
export type DocumentEmailWarning = typeof DOCUMENT_EMAIL_WARNINGS[number];

/** Metadata-only durable result. Never store bytes/body/HTML or a hidden document ID here. */
export interface DocumentEmailPartResult {
  message_index: number;
  ordinal: number;
  filename: string;
  sha256?: string;
  kind: 'xml' | 'zip' | 'pdf' | 'eml' | 'other';
  role?: 'container' | 'commercial' | 'dian_receipt' | 'representation' | 'complement';
  status: DocumentEmailState;
  reason_code?: DocumentEmailReasonCode;
  warnings?: DocumentEmailWarning[];
  originals_checkpoint?: Array<{ sha256: string; stored: boolean }>;
  /** Only populated for a document readable in the same operational store. */
  document_id?: number;
}

export interface DocumentEmailSnapshot {
  inbox_id: number;
  organization_id: number;
  store_id: number;
  accounting_entity_id: number;
  local_part: string;
  domain: string;
  environment: string;
}

/** System identity: intentionally has no actor_id, user impersonation or normalized client input. */
export interface DocumentEmailProcessingContext extends DocumentEmailSnapshot {
  recipient_alias: string;
  fiscal_scope: OrganizationFiscalScope;
  fiscal_identity: TenantFiscalIdentity;
}

/** Bytes belong only to an internal transient package, never to parts JSON or HTTP DTOs. */
export interface DocumentEmailInternalPart {
  message_index: number;
  ordinal: number;
  filename: string;
  content_type: string;
  bytes: Buffer;
}

export interface DocumentEmailStatus {
  pilot_available: boolean;
  configured: boolean;
  enabled: boolean;
  active_inboxes: number;
  state: 'inactive' | 'waiting' | 'working' | 'paused' | 'attention';
  first_valid_received_at: Date | null;
  last_email_at: Date | null;
  last_valid_received_at: Date | null;
  last_error_code: DocumentEmailReasonCode | null;
  not_processed_count: number;
}

export interface DocumentEmailConfiguration {
  configured: boolean;
  address: string | null;
  version: number | null;
  enabled: boolean;
  policy_version: string;
}
