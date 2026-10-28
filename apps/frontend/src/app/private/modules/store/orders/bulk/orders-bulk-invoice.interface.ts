/**
 * Contract of the bulk e-invoicing endpoints (mirror of the backend DTOs):
 *
 *  - `POST store/orders/bulk/invoice/preview` (read-only holder/payment preview)
 *  - `POST store/orders/bulk/invoice` (executes up to 5 orders per request)
 *
 * Both answer inside the standard `{ success, data }` envelope.
 */

/** Documento de identificación del Consumidor final (sentinel DIAN). */
export const FINAL_CONSUMER_DOCUMENT = '222222222222';

/** Orders per execute request. The backend caps it with `@ArrayMaxSize(5)`. */
export const BULK_INVOICE_CHUNK_SIZE = 5;

export type BulkInvoicePayment =
  | 'paid'
  | 'credit_existing'
  | 'to_credit'
  | 'blocked';

export type BulkInvoiceBlockedCode =
  | 'partial_payment'
  | 'customer_required'
  | 'order_state'
  | 'already_invoiced'
  | 'split_active'
  | 'not_found'
  | 'in_process';

export type BulkInvoiceHolderIssueCode =
  | 'missing_document_number'
  | 'missing_name'
  | 'final_consumer_sentinel'
  | 'document_type_required';

export interface BulkInvoiceHolder {
  rail: 'nominative' | 'final_consumer';
  source: 'customer' | 'guest_request' | 'none';
  name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
}

export interface BulkInvoiceHolderIssue {
  code: BulkInvoiceHolderIssueCode;
  missing_fields: string[];
  message: string;
}

export interface BulkInvoicePreviewRow {
  id: number;
  order_number: string;
  /** Decimal string, as every money value of the API. */
  grand_total: string;
  payment: BulkInvoicePayment;
  blocked_code: BulkInvoiceBlockedCode | null;
  holder: BulkInvoiceHolder;
  holder_issue: BulkInvoiceHolderIssue | null;
  cf_overridable: boolean;
  will_emit: boolean;
  skip_reason: string | null;
}

export interface BulkInvoicePreviewSummary {
  total: number;
  paid: number;
  credit_existing: number;
  to_credit: number;
  final_consumer: number;
  blocked: number;
  cf_overridable: number;
  will_emit: number;
}

export interface BulkInvoicePreviewResult {
  store_eligible: boolean;
  store_blocker: string | null;
  summary: BulkInvoicePreviewSummary;
  results: BulkInvoicePreviewRow[];
}

export interface BulkInvoiceItem {
  order_id: number;
  expected_holder_document: string;
  allow_final_consumer?: boolean;
}

export interface BulkInvoiceCredit {
  due_date: string;
  payment_means_code?: string;
}

export interface BulkInvoiceRequest {
  items: BulkInvoiceItem[];
  credit?: BulkInvoiceCredit;
}

export interface BulkInvoiceResultItem {
  id: number;
  status: 'ok' | 'error';
  code?: string;
  message?: string;
  invoice_number?: string;
  invoice_status?: string;
}

/** Outcome of ONE chunk request, emitted as soon as that chunk returns. */
export interface BulkInvoiceChunkOutcome {
  /** Order ids that were sent in this chunk. */
  ids: number[];
  results: BulkInvoiceResultItem[];
}
