/**
 * Canonical fiscal provider contract for DIAN-facing electronic documents.
 *
 * Production implementations may operate as DIAN own software for the fiscal
 * entity, using that customer's software credentials and digital certificate.
 * A technological provider adapter can exist later, but it is not the default
 * Vendix operating model.
 */
export type FiscalDocumentType =
  | 'invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment';

export type FiscalProviderEnvironment = 'test' | 'production';

export type FiscalProviderOperationMode =
  | 'own_software'
  | 'technological_provider';

export type FiscalProviderStatus =
  | 'queued'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'error';

export interface FiscalProviderAuthorization {
  operation_mode: FiscalProviderOperationMode;
  provider_name: string;
  provider_nit?: string;
  fiscal_entity_nit: string;
  dian_enabled: boolean;
  dian_checked_at: string;
  certificate_issuer?: string;
}

export interface FiscalDocumentPayload<TData = Record<string, unknown>> {
  document_type: FiscalDocumentType;
  document_number: string;
  organization_id: number;
  store_id?: number | null;
  accounting_entity_id: number;
  issue_date: string;
  environment: FiscalProviderEnvironment;
  idempotency_key: string;
  data: TData;
}

export interface FiscalProviderResponse {
  success: boolean;
  status: FiscalProviderStatus;
  tracking_id: string;
  provider_document_id?: string;
  cufe?: string;
  cude?: string;
  cuds?: string;
  cune?: string;
  qr_code?: string;
  xml_document?: string;
  pdf_url?: string;
  message?: string;
  provider_data?: Record<string, unknown>;
}

export interface FiscalProviderAdapter {
  readonly authorization: FiscalProviderAuthorization;

  submitDocument(
    payload: FiscalDocumentPayload,
  ): Promise<FiscalProviderResponse>;

  checkStatus(params: {
    tracking_id: string;
    document_type: FiscalDocumentType;
    accounting_entity_id: number;
  }): Promise<FiscalProviderResponse>;

  downloadEvidence(params: {
    tracking_id: string;
    document_type: FiscalDocumentType;
    accounting_entity_id: number;
  }): Promise<{
    xml_document?: string;
    pdf_url?: string;
    provider_data?: Record<string, unknown>;
  }>;
}
