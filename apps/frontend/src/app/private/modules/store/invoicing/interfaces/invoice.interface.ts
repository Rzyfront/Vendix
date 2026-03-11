export interface Invoice {
  id: number;
  organization_id: number;
  store_id: number;
  invoice_number: string;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  customer_id?: number;
  supplier_id?: number;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  subtotal_amount: number;
  discount_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  send_status: string;
  issue_date: string;
  due_date?: string;
  notes?: string;
  order_id?: number;
  sales_order_id?: number;
  resolution_id?: number;
  created_at: string;
  updated_at: string;

  // Relations
  items?: InvoiceItem[];
  taxes?: InvoiceTax[];
  resolution?: InvoiceResolution;

  // DIAN fields
  cufe?: string;
  qr_code?: string;
  pdf_url?: string;
  sent_at?: string;
  accepted_at?: string;
}

export type InvoiceType =
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'export_invoice';

export type InvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id?: number;
  product_name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  tax_rate?: number;
}

export interface InvoiceTax {
  id: number;
  invoice_id: number;
  tax_name: string;
  tax_rate: number;
  tax_amount: number;
  taxable_amount: number;
}

export interface InvoiceResolution {
  id: number;
  organization_id: number;
  store_id: number;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  current_number: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  technical_key?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceDto {
  invoice_type: InvoiceType;
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_id?: number;
  supplier_id?: number;
  issue_date: string;
  due_date?: string;
  notes?: string;
  resolution_id?: number;
  items: CreateInvoiceItemDto[];
}

export interface CreateInvoiceItemDto {
  product_id?: number;
  product_name: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_rate?: number;
}

export interface UpdateInvoiceDto {
  customer_name?: string;
  customer_tax_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateCreditNoteDto {
  original_invoice_id: number;
  reason: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateDebitNoteDto {
  original_invoice_id: number;
  reason: string;
  items?: CreateInvoiceItemDto[];
}

export interface CreateResolutionDto {
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: number;
  range_to: number;
  valid_from: string;
  valid_to: string;
  technical_key?: string;
}

export interface UpdateResolutionDto {
  resolution_number?: string;
  resolution_date?: string;
  prefix?: string;
  range_from?: number;
  range_to?: number;
  valid_from?: string;
  valid_to?: string;
  is_active?: boolean;
  technical_key?: string;
}

export interface QueryInvoiceDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  invoice_type?: string;
  date_from?: string;
  date_to?: string;
}

export interface InvoiceStats {
  total_accepted_amount: number;
  total_accepted_count: number;
  total_pending_amount: number;
  total_pending_count: number;
  counts_by_status: Record<string, { count: number; amount: number }>;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  timestamp?: string;
  path?: string;
}

// ── DIAN Configuration ────────────────────────────────────

export interface DianConfig {
  id: number;
  organization_id: number;
  store_id: number;
  nit: string;
  nit_dv: string | null;
  software_id: string;
  software_pin_encrypted: string; // Always '****' from API
  certificate_s3_key: string | null;
  certificate_password_encrypted: string | null; // Always '****' from API
  certificate_expiry: string | null;
  environment: 'test' | 'production';
  enablement_status: 'not_started' | 'testing' | 'enabled' | 'suspended';
  test_set_id: string | null;
  last_test_result: any;
  created_at: string;
  updated_at: string;
}

export interface DianTestResult {
  success: boolean;
  environment: string;
  response_time_ms: number;
  message: string;
  dian_status?: string;
}

export interface DianAuditLog {
  id: number;
  action: string;
  document_type: string | null;
  document_number: string | null;
  status: string;
  error_message: string | null;
  cufe: string | null;
  duration_ms: number | null;
  created_at: string;
}
