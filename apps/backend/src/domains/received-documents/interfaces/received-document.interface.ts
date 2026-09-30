import type { tax_type_enum } from '@prisma/client';

export type ReceivedDocumentType =
  | 'invoice'
  | 'credit_note'
  | 'debit_note'
  | 'non_electronic';

export interface ReceivedDocumentTax {
  tax_type: tax_type_enum | 'unclassified';
  scheme_code: string;
  tax_name: string;
  /** DIAN percentage as written (19 means 19%, not 0.19). */
  rate: string;
  base_amount: string;
  amount: string;
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
