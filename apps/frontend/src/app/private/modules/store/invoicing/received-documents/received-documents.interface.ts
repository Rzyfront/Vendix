export type ReceivedDocumentsScope = 'store' | 'organization';
export type ReceivedDocumentType = 'invoice' | 'credit_note' | 'debit_note' | 'non_electronic';

export interface ReceivedDocumentQuery {
  page?: number;
  limit?: number;
  search?: string;
  processing_status?: string;
  validation_status?: string;
  review_status?: string;
  fiscal_status?: string;
  source_channel?: string;
  /** Organization scope only. Store scope resolves from authenticated context. */
  store_id?: number;
}

export interface ReceivedDocumentTax {
  id?: number;
  tax_type: string | null;
  scheme_code?: string | null;
  tax_name: string;
  rate: string | null;
  base_amount: string;
  amount: string;
  eligible_amount?: string;
  treatment?: string;
  metadata?: unknown;
  item_id?: number | null;
  line_number?: number | null;
}

export interface ReceivedDocumentItem {
  id?: number;
  line_number: number;
  external_code?: string | null;
  description: string;
  quantity: string;
  unit_code?: string | null;
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  total_amount: string;
  taxes?: ReceivedDocumentTax[];
}

export interface ReceivedDocumentFile {
  id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  role: string;
  created_at: string;
}

export interface ReceivedDocumentEvent {
  id: number;
  event_type: string;
  status: string;
  created_at: string;
  result?: unknown;
}

export interface ReceivedDocument {
  id: number;
  store_id: number | null;
  document_type: ReceivedDocumentType;
  source_channel: string;
  issuer_tax_id: string;
  issuer_name: string;
  receiver_tax_id: string;
  receiver_name: string;
  invoice_number: string;
  document_key: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  processing_status: string;
  validation_status: string;
  review_status: string;
  matching_status: string;
  fiscal_status: string;
  posting_status: string;
  validation_summary?: {
    errors?: Array<{ code?: string; message: string }>;
    warnings?: Array<{ code?: string; message: string }>;
  } | null;
  raw_payload?: unknown;
  metadata?: Record<string, unknown> | null;
  version: number;
  created_at: string;
  updated_at: string;
  files?: ReceivedDocumentFile[];
  items?: ReceivedDocumentItem[];
  taxes?: ReceivedDocumentTax[];
  events?: ReceivedDocumentEvent[];
  links?: Array<Record<string, unknown>>;
}

export interface ReceivedDocumentsPage {
  data: ReceivedDocument[];
  meta: { total: number; page: number; limit: number; totalPages?: number };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ManualReceivedDocumentTaxInput {
  tax_type: string;
  scheme_code?: string;
  tax_name: string;
  rate: string;
  base_amount: string;
  amount: string;
}

export interface ManualReceivedDocumentItemInput {
  external_code?: string;
  description: string;
  quantity: string;
  unit_code?: string;
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  total_amount: string;
  taxes?: ManualReceivedDocumentTaxInput[];
}

export interface ManualReceivedDocumentInput {
  document_type: ReceivedDocumentType;
  invoice_number: string;
  document_key?: string;
  reference_key?: string;
  reference_number?: string;
  issuer_tax_id: string;
  issuer_name: string;
  receiver_tax_id: string;
  receiver_name: string;
  issue_date: string;
  due_date?: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  charge_amount?: string;
  tax_exclusive_amount?: string;
  tax_inclusive_amount?: string;
  tax_amount: string;
  total_amount: string;
  prepaid_amount?: string;
  payable_rounding_amount?: string;
  withholding_amount?: string;
  reviewer_note?: string;
  items: ManualReceivedDocumentItemInput[];
  taxes?: ManualReceivedDocumentTaxInput[];
}

export interface ReceivedDocumentReviewInput {
  expected_version: number;
  reviewer_note?: string;
  facts?: ManualReceivedDocumentInput;
}

export interface ReceivedDocumentScanEnqueueResponse {
  document_id: number;
  job_id: string | null;
  already_processed: boolean;
}

export interface ReceivedDocumentScanJobResult {
  document_id: number;
  version: number;
  validation_status: string;
  review_required: true;
  page_count: number;
}

export type ReceivedDocumentScanJobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed';

export interface ReceivedDocumentScanStatus {
  status: ReceivedDocumentScanJobState;
  result?: ReceivedDocumentScanJobResult;
  error?: string;
  error_code?: string;
}
