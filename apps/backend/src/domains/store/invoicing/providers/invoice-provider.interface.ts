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
   * Sends a debit note to the provider.
   */
  sendDebitNote?(debitNoteData: ProviderInvoiceData): Promise<ProviderResponse>;

  /**
   * Sends a support document for acquisitions from non-obligated suppliers.
   */
  sendSupportDocument?(
    supportDocumentData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Sends an adjustment note for a support document.
   */
  sendSupportAdjustmentNote?(
    supportAdjustmentData: ProviderInvoiceData,
  ): Promise<ProviderResponse>;

  /**
   * Sends a POS electronic equivalent document (Res. 000165/2023).
   *
   * Optional on purpose: a provider that is only habilitado for the factura
   * electrónica de venta must be *detectably* unable to emit a DE, so the flow
   * refuses before consuming a consecutive from the DE range. A mandatory method
   * would force every adapter to fake support it does not have.
   */
  sendEquivalentDocument?(
    documentData: ProviderInvoiceData,
    options?: { document_type_code?: string },
  ): Promise<ProviderResponse>;

  /**
   * Sends an adjustment note ('93' débito / '94' crédito) to an equivalent
   * document. The DE has no credit/debit note of its own.
   */
  sendEquivalentAdjustmentNote?(
    adjustmentData: ProviderInvoiceData,
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
  issue_time?: string;
  due_date?: string;
  customer_name?: string;
  customer_tax_id?: string;
  customer_address?: any;
  /**
   * Set when the document is being (re)transmitted after having been expedited
   * under contingency. Drives `cbc:InvoiceTypeCode`: '04' for DIAN
   * unavailability, '03' for a transcribed paper contingency invoice. Absent on a
   * normal transmission, which keeps emitting '01'.
   */
  contingency_type?: string;
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
  /** DV of `customer_tax_id` — becomes CompanyID/@schemeID for the adquiriente. */
  customer_verification_digit?: string;
  /** '1' Persona Jurídica / '2' Persona Natural (cbc:AdditionalAccountID). */
  customer_person_type?: string;
  /**
   * DIAN fiscal responsibilities of the adquiriente (cbc:TaxLevelCode), e.g.
   * ['O-13','O-15']. Absent means the builder falls back to 'R-99-PN'.
   */
  customer_tax_responsibilities?: string[];
  payment_means?: string;
  payment_form?: string; // DIAN: '1' = contado, '2' = crédito
  payment_method?: string;
  order_reference?: string;
  original_invoice_number?: string;
  original_invoice_cufe?: string;
  original_invoice_issue_date?: string;
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
  /**
   * Persisted fiscal classification ('iva' | 'inc' | 'ica' | ...). When present
   * it is the authoritative source for the DIAN tax scheme code (01/04/03),
   * taking priority over the tax_name heuristic.
   */
  tax_type?: string;
}

export interface ProviderResponse {
  success: boolean;
  tracking_id: string;
  cufe?: string;
  cude?: string;
  cuds?: string;
  cune?: string;
  qr_code?: string;
  xml_document?: string;
  pdf_url?: string;
  message?: string;
  provider_data?: any;
  /**
   * True when the failure is the DIAN being unavailable rather than the document
   * being invalid (Anexo Técnico 1.9 §12.2).
   *
   * This distinction is load-bearing: an unavailability used to be treated the
   * same as a validation rejection, so an outage marked perfectly valid invoices
   * `rejected` with `accounting_status: blocked` — a terminal state the Anexo
   * never intended. When this flag is set, the document must go to contingency
   * (Type 04) instead: valid, deliverable, and owing a transmission within 48 h.
   */
  contingency_eligible?: boolean;
  /** Anexo §12 failure class, when the failure was a transport/availability one. */
  failure_class?: 'dian_error' | 'timeout' | 'non_retriable';
}

export interface StatusResponse {
  tracking_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'error';
  message?: string;
  cufe?: string;
  cude?: string;
  cuds?: string;
  cune?: string;
  provider_data?: any;
}

export const INVOICE_PROVIDER = 'INVOICE_PROVIDER';
