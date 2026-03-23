export const BANK_BATCH_BUILDER_REGISTRY = 'BANK_BATCH_BUILDER_REGISTRY';

export interface BankBatchEmployee {
  employee_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  document_type: string;
  document_number: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_type: string; // 'savings' | 'checking'
  net_pay: number;
}

export interface BankBatchMetadata {
  payroll_run_id: number;
  payroll_number: string;
  company_name: string;
  company_nit: string;
  payment_date: Date;
  total_amount: number;
  record_count: number;
  source_account: string;
  source_account_type: string; // 'savings' | 'checking'
}

export interface BankBatchResult {
  file_content: Buffer;
  file_name: string;
  mime_type: string;
  record_count: number;
  total_amount: number;
}

export interface BankBatchBuilder {
  bankCode: string;
  bankName: string;
  build(metadata: BankBatchMetadata, employees: BankBatchEmployee[]): BankBatchResult;
  validate(employees: BankBatchEmployee[]): string[];
}
