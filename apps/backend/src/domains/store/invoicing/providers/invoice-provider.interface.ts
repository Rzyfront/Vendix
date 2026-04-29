/**
 * Contract for electronic invoice providers (e.g., DIAN, mock, third-party).
 */
export interface InvoiceProviderAdapter {
  /**
   * Sends an invoice to the provider for validation and acceptance.
   */
  sendInvoice(invoiceData: ProviderInvoiceData): Promise<ProviderResponse>;

  /**
   * Sends a credit note to the provider.
   */
  sendCreditNote(
    creditNoteData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Checks the status of a previously sent document.
   */
  checkStatus(trackingId: string): Promise<StatusResponse>;

  /**
   * Cancels or voids a previously sent invoice.
   */
  cancelInvoice(invoiceId: string, reason: string): Promise<ProviderResponse>;
}

export interface ProviderInvoiceData {
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  due_date?: string;
  customer_name?: string;
  customer_tax_id?: string;
  customer_address?: any;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  withholding_amount: string;
  total_amount: string;
  currency?: string;
  items: ProviderInvoiceItem[];
  taxes: ProviderInvoiceTax[];
  resolution_number?: string;
  technical_key?: string;
  notes?: string;

  // DIAN-enriched fields (optional — used by DianDirectProvider)
  issuer_nit?: string;
  issuer_legal_name?: string;
  issuer_address?: any;
  customer_email?: string;
  customer_phone?: string;
  customer_document_type?: string;
  customer_regime?: string;
  payment_means?: string;
  payment_form?: string; // DIAN: '1' = contado, '2' = crédito
  payment_method?: string;
  order_reference?: string;
}

export interface ProviderInvoiceItem {
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
}

export interface ProviderInvoiceTax {
  tax_name: string;
  tax_rate: string;
  taxable_amount: string;
  tax_amount: string;
}

export interface ProviderResponse {
  success: boolean;
  tracking_id: string;
  cufe?: string;
  qr_code?: string;
  xml_document?: string;
  pdf_url?: string;
  message?: string;
  provider_data?: any;
}

export interface StatusResponse {
  tracking_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'error';
  message?: string;
  cufe?: string;
  provider_data?: any;
}

export const INVOICE_PROVIDER = 'INVOICE_PROVIDER';
