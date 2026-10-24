import type { tax_type_enum } from '@prisma/client';
import type { DocumentEmailWarning } from './document-email-reception.interface';

export type ReceivedDocumentType =
  | 'invoice'
  | 'credit_note'
  | 'debit_note'
  | 'non_electronic';

export type ReceivedDocumentPaymentCondition = 'cash' | 'credit' | 'unknown';
export type StructuralValidationStatus = 'pending' | 'valid' | 'needs_review' | 'invalid';
export type SignatureValidationStatus = 'unsigned' | 'not_verified';
export type DianValidationStatus = 'not_checked';

export interface ReceivedDocumentXmlUuid {
  value: string | null;
  scheme_id: string | null;
  scheme_name: string | null;
}

/** Raw fiscal attributes for channel-specific preflight; no authenticity is established. */
export interface ReceivedDocumentFiscalMetadata {
  root: string;
  profile_execution_id: string | null;
  document_type_code: string | null;
  uuid: ReceivedDocumentXmlUuid;
  receiver_company_id: {
    value: string | null;
    scheme_name: string | null;
    scheme_id: string | null;
  };
  container?: {
    profile_execution_id: string | null;
    uuid: ReceivedDocumentXmlUuid;
  };
}

export interface DetailedReceivedDocument {
  normalized: NormalizedReceivedDocument;
  fiscal: ReceivedDocumentFiscalMetadata;
  /** Complete decoded source, not a DOM serialization or an extracted substring. */
  commercial_xml: string | null;
  /** Embedded source strings remain unverified evidence. */
  application_responses: string[];
  /** References/codes read from the same validated DOM; never authentication or legal acceptance. */
  application_response_evidence?: Array<{ document_key: string | null; response_code: string | null }>;
}

/** Internal-only package produced after bounded attachment and fiscal preflight. */
export interface PreparedEmailEvidence {
  role: 'container' | 'commercial' | 'dian_receipt' | 'representation' | 'zip';
  bytes: Buffer;
  filename: string;
  mime_type: string;
  sha256: string;
  encoding?: 'utf-8' | 'iso-8859-1';
}

export interface PreparedEmailDocument {
  parsed: DetailedReceivedDocument;
  evidence: PreparedEmailEvidence[];
  email_message_id: number;
  warnings: DocumentEmailWarning[];
  receipt_evidence: {
    included: boolean;
    reference_matches: boolean;
    response_code: string | null;
  };
}

export interface ReceivedDocumentTax {
  tax_type: tax_type_enum | 'unclassified';
  scheme_code: string;
  tax_name: string;
  /** DIAN percentage as written (19 means 19%, not 0.19). */
  rate: string;
  base_amount: string;
  amount: string;
  /** Basis used by DIAN: nominal per-unit taxes preserve quantities separately from money. */
  tax_basis_type?: 'monetary' | 'unit';
  base_quantity?: string;
  base_unit_code?: string;
  per_unit_amount?: string;
  line_number?: number;
}

export interface ReceivedDocumentItem {
  line_number: number;
  external_code?: string;
  description: string;
  quantity: string;
  unit_code?: string;
  unit_price: string;
  discount_amount: string;
  net_amount: string;
  total_amount: string;
  taxes: ReceivedDocumentTax[];
}

export interface ReceivedDocumentValidationIssue {
  code: string;
  message: string;
}

/** Independent evidence axes; none claims a cryptographic or DIAN verification. */
export interface ReceivedDocumentValidationSummary {
  structural: {
    status: StructuralValidationStatus;
    errors: ReceivedDocumentValidationIssue[];
    warnings: ReceivedDocumentValidationIssue[];
  };
  signature: {
    status: SignatureValidationStatus;
    has_signature: boolean;
  };
  dian: {
    status: DianValidationStatus;
    application_response_unverified: boolean;
  };
  /** Compatibility shape retained for existing detail consumers and evidence snapshots. */
  errors: ReceivedDocumentValidationIssue[];
  warnings: ReceivedDocumentValidationIssue[];
  has_signature: boolean;
  document_key_format_valid: boolean;
}

export interface NormalizedReceivedDocument {
  document_type: ReceivedDocumentType;
  invoice_number: string;
  issuer_tax_id: string;
  issuer_name: string;
  receiver_tax_id: string;
  receiver_name: string;
  document_key?: string;
  issue_date: string;
  due_date?: string;
  /** Older non-XML producers may omit this; persistence must conservatively use unknown. */
  payment_condition?: ReceivedDocumentPaymentCondition;
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
  items: ReceivedDocumentItem[];
  taxes: ReceivedDocumentTax[];
  reference_key?: string;
  reference_number?: string;
  validation: {
    errors: ReceivedDocumentValidationIssue[];
    warnings: ReceivedDocumentValidationIssue[];
    has_signature: boolean;
    document_key_format_valid: boolean;
  };
}
