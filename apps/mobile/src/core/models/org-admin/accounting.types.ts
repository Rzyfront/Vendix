import type { ISODateString, MoneyAmount } from './common.types';

export interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  parent_id: string | null;
  is_active: boolean;
  level: number;
  description?: string;
  created_at?: ISODateString;
  updated_at?: ISODateString;
  children?: ChartOfAccount[];
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  date: ISODateString;
  description: string;
  reference?: string;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  total_debit: number;
  total_credit: number;
  fiscal_period_id?: string;
  source?: string;
  lines?: JournalEntryLine[];
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface JournalEntryLine {
  id?: string;
  account_id: string;
  account_code?: string;
  account_name?: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface FiscalPeriod {
  id: string;
  name: string;
  year: number;
  month?: number;
  start_date: ISODateString;
  end_date: ISODateString;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closed_at?: ISODateString | null;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface AccountMapping {
  id: string;
  source_account: string;
  source_name: string;
  target_account_id: string;
  target_account_code?: string;
  target_account_name?: string;
  operation: 'DEBIT' | 'CREDIT' | 'BOTH';
  is_active: boolean;
  description?: string;
  created_at?: ISODateString;
  updated_at?: ISODateString;
}

export interface AccountingStats {
  total_accounts: number;
  total_journal_entries: number;
  open_periods: number;
  closed_periods: number;
  trial_balance?: MoneyAmount;
}
