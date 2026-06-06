import type { ISODateString, MoneyAmount } from './common.types';

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'SENT' | 'PAID' | 'OVERDUE' | 'VOIDED' | 'CANCELLED';

export interface Invoice {
  id: string;
  invoice_number: string;
  prefix?: string;
  cufe?: string;
  store_id: string;
  store_name: string;
  customer_id?: string;
  customer_name: string;
  customer_tax_id?: string;
  customer_email?: string;
  issue_date: ISODateString;
  due_date?: ISODateString;
  status: InvoiceStatus;
  subtotal: MoneyAmount;
  tax_total: MoneyAmount;
  discount_total: MoneyAmount;
  total: MoneyAmount;
  paid_amount: MoneyAmount;
  balance: MoneyAmount;
  resolution_id?: string;
  resolution_number?: string;
  notes?: string;
  pdf_url?: string;
  xml_url?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface InvoiceResolution {
  id: string;
  resolution_number: string;
  prefix: string;
  from_number: number;
  to_number: number;
  current_number: number;
  start_date: ISODateString;
  end_date: ISODateString;
  status: 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'INACTIVE';
  type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  store_id?: string;
  store_name?: string;
  notes?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface DianConfig {
  id: string;
  organization_id: string;
  nit: string;
  dv?: string;
  name: string;
  regime?: string;
  software_id?: string;
  software_pin?: string;
  test_mode: boolean;
  environment: 'TEST' | 'PRODUCTION';
  certificate_id?: string;
  certificate_status?: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  certificate_expires_at?: ISODateString;
  resolution_id?: string;
  pin_code?: string;
  technical_key?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface DianCertificateStatus {
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PROCESSING';
  request_id?: string;
  expires_at?: ISODateString;
  issued_at?: ISODateString;
  message?: string;
}
