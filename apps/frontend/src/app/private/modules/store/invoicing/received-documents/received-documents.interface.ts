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
  tax_basis_type?: 'monetary' | 'unit';
  base_quantity?: string | null;
  base_unit_code?: string | null;
  per_unit_amount?: string | null;
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
  accepted_at?: string | null;
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

export type ReceivedDocumentAccountingEvidenceStatus =
  | 'linked' | 'missing' | 'ambiguous' | 'foreign_entity' | 'not_posted' | 'unresolved_entity';

export interface ReceivedDocumentAccountingEvidence {
  ledger_evidence_complete: boolean;
  evidence: Array<{
    reference: { source_type: string; source_id: number; accounting_entity_id: number };
    status: ReceivedDocumentAccountingEvidenceStatus;
    accounting_entry_id?: number;
  }>;
  unresolved_allocation_ids: number[];
  fiscal_eligibility: 'pending';
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ManualReceivedDocumentTaxInput {
  tax_type: string;
  scheme_code?: string;
  tax_basis_type?: 'monetary' | 'unit';
  base_quantity?: string;
  base_unit_code?: string;
  per_unit_amount?: string;
  tax_name: string;
  rate?: string;
  base_amount?: string;
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

export interface ReceivedDocumentMatchCandidateTax {
  tax_name: string;
  tax_type: string;
  tax_rate: string | null;
  calc_mode: string;
  taxable_amount: string;
  tax_amount: string;
}

export interface ReceivedDocumentMatchCandidateLine {
  id: number;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  product_sku: string | null;
  product_barcode: string | null;
  variant_sku: string | null;
  variant_barcode: string | null;
  quantity_ordered: string;
  quantity_received: string;
  allocated_quantity: string;
  remaining_quantity: string;
  unit_cost: string | null;
  unit_price_net: string | null;
  discount_amount: string | null;
  tax_rate: string | null;
  tax_type: string | null;
  purchase_uom_id: number | null;
  purchase_uom_code: string | null;
  product_purchase_uom_code: string | null;
  taxes: ReceivedDocumentMatchCandidateTax[];
  matched_document_item_ids: number[];
  match_reason_codes: string[];
}

export interface ReceivedDocumentMatchCandidate {
  purchase_order_id: number;
  order_number: string;
  status: string;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  order_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  /** PO currency is currently not stored, so the matcher cannot verify it. */
  currency: null;
  supplier: { id: number; name: string; tax_id: string | null };
  location: { id: number; name: string; store_id: number | null; is_central_warehouse: boolean };
  evidence_tier: 'strong' | 'review';
  reason_codes: string[];
  weak_signals: {
    total_difference: string | null;
    invoice_date_matches_po_date: boolean;
    description_matches: number;
  };
  items: ReceivedDocumentMatchCandidateLine[];
  receptions: Array<{
    id: number;
    received_at: string;
    items: Array<{
      id: number;
      purchase_order_item_id: number;
      quantity_received: string;
      allocated_quantity: string;
      remaining_quantity: string;
      note: string | null;
    }>;
  }>;
}

export interface ReceivedDocumentMatchCandidatesResponse {
  candidates: ReceivedDocumentMatchCandidate[];
  warnings: string[];
}

export interface ReceivedDocumentMatchExpenseItem {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  allocated_net_amount: string;
  remaining_net_amount: string;
}

export interface ReceivedDocumentMatchExpense {
  id: number;
  store_id: number | null;
  description: string;
  expense_date: string;
  state: string;
  amount: string;
  currency: string | null;
  allocated_net_amount: string;
  remaining_net_amount: string;
  items: ReceivedDocumentMatchExpenseItem[];
}

export interface ReceivedDocumentMatchExpensesResponse {
  data: ReceivedDocumentMatchExpense[];
  total: number;
  page: number;
  limit: number;
  warnings: string[];
}

export interface ReceivedDocumentMatchAllocationTax {
  id: number;
  allocation_id: number;
  document_tax_id: number;
  allocated_amount: string;
  created_at: string;
}

export interface ReceivedDocumentMatchAllocation {
  id: number;
  organization_id: number;
  accounting_entity_id: number;
  store_id: number | null;
  document_id: number;
  document_item_id: number;
  purchase_order_id: number | null;
  purchase_order_item_id: number | null;
  reception_id: number | null;
  reception_item_id: number | null;
  expense_id: number | null;
  expense_item_id: number | null;
  source_quantity: string;
  target_quantity: string | null;
  source_unit_code: string | null;
  target_unit_code: string | null;
  allocated_net_amount: string;
  currency: string;
  status: 'active' | 'revoked' | string;
  idempotency_key: string;
  created_by: number;
  confirmed_at: string;
  revoked_by: number | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  receipt_state?: 'receipt_not_linked' | 'received' | 'receipt_pending' | null;
  tax_allocations?: ReceivedDocumentMatchAllocationTax[];
  purchase_order_item?: { id: number; quantity_ordered: string; quantity_received: string } | null;
  reception_item?: {
    id: number;
    reception_id: number;
    purchase_order_item_id: number;
    quantity_received: string;
    reception?: { received_at: string } | null;
  } | null;
  expense?: { id: number; amount: string; currency: string | null } | null;
  expense_item?: { id: number; quantity: string; amount: string } | null;
}

export interface ReceivedDocumentMatchLineBalance {
  document_item_id: number;
  line_number: number;
  quantity: string;
  allocated_quantity: string;
  remaining_quantity: string;
  net_amount: string;
  allocated_net_amount: string;
  remaining_net_amount: string;
}

export interface ReceivedDocumentMatchTargetBalance {
  target_type: 'purchase_order_item' | 'expense' | 'expense_item';
  target_id: number;
  allocated_quantity: string;
  current_document_allocated_quantity: string;
  target_quantity?: string;
  remaining_quantity?: string;
  allocated_net_amount: string;
  current_document_allocated_net_amount: string;
  target_net_amount?: string;
  remaining_net_amount?: string;
  quantity_ordered?: string;
  quantity_received?: string;
  receipt_state?: 'receipt_not_linked' | 'received' | 'receipt_pending';
}

export interface ReceivedDocumentMatchReceiptTarget {
  reception_item_id: number;
  reception_id?: number;
  purchase_order_item_id?: number;
  quantity_received: string;
  allocated_quantity: string;
  current_document_allocated_quantity: string;
  remaining_quantity: string;
  receipt_state: 'received' | 'receipt_pending';
}

export interface ReceivedDocumentMatchAllocationsResponse {
  document_id: number;
  document_version: number;
  matching_status: string;
  allocations: ReceivedDocumentMatchAllocation[];
  lines: ReceivedDocumentMatchLineBalance[];
  targets: ReceivedDocumentMatchTargetBalance[];
  receipt_targets: ReceivedDocumentMatchReceiptTarget[];
}

export interface ConfirmReceivedDocumentMatchInput {
  expected_version: number;
  idempotency_key: string;
  document_item_id: number;
  purchase_order_id?: number;
  purchase_order_item_id?: number;
  reception_id?: number;
  reception_item_id?: number;
  expense_id?: number;
  expense_item_id?: number;
  source_quantity: string;
  target_quantity?: string;
  allocated_net_amount: string;
  target_unit_code?: string;
  manual_reason?: string;
}

export interface RevokeReceivedDocumentMatchInput {
  expected_version: number;
  reason: string;
}

export interface ReceivedDocumentMatchMutationResult {
  allocation: ReceivedDocumentMatchAllocation;
  document_version: number;
  matching_status: string;
  duplicate: boolean;
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
