// ── Chart of Accounts ──────────────────────────────────────────────
export interface ChartAccount {
  id: number;
  organization_id: number;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  parent_id?: number;
  level: number;
  is_active: boolean;
  accepts_entries: boolean;
  children?: ChartAccount[];
  created_at: string;
  updated_at: string;
}

export interface CreateAccountDto {
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  parent_id?: number;
  is_active?: boolean;
  accepts_entries?: boolean;
}

export interface UpdateAccountDto {
  name?: string;
  account_type?: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature?: 'debit' | 'credit';
  parent_id?: number;
  is_active?: boolean;
  accepts_entries?: boolean;
}

// ── Journal Entries ────────────────────────────────────────────────
export interface JournalEntry {
  id: number;
  entry_number: string;
  entry_type: string;
  status: 'draft' | 'posted' | 'voided';
  fiscal_period_id: number;
  entry_date: string;
  description?: string;
  source_type?: string;
  source_id?: number;
  total_debit: number;
  total_credit: number;
  lines?: EntryLine[];
  fiscal_period?: FiscalPeriod;
  created_at: string;
  updated_at: string;
}

export interface EntryLine {
  id: number;
  journal_entry_id?: number;
  account_id: number;
  account?: ChartAccount;
  description?: string;
  debit_amount: number;
  credit_amount: number;
}

export interface CreateEntryLineDto {
  account_id: number;
  description?: string;
  debit_amount: number;
  credit_amount: number;
}

export interface CreateJournalEntryDto {
  entry_type: string;
  fiscal_period_id: number;
  entry_date: string;
  description?: string;
  lines: CreateEntryLineDto[];
}

export interface UpdateJournalEntryDto {
  entry_type?: string;
  fiscal_period_id?: number;
  entry_date?: string;
  description?: string;
  lines?: CreateEntryLineDto[];
}

// ── Fiscal Periods ─────────────────────────────────────────────────
export interface FiscalPeriod {
  id: number;
  organization_id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closing' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface CreateFiscalPeriodDto {
  name: string;
  start_date: string;
  end_date: string;
}

// ── Reports ────────────────────────────────────────────────────────
export interface ReportQueryDto {
  fiscal_period_id?: number;
  start_date?: string;
  end_date?: string;
}

export interface TrialBalanceRow {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_total: number;
  credit_total: number;
  balance: number;
}

export interface TrialBalanceReport {
  rows: TrialBalanceRow[];
  total_debit: number;
  total_credit: number;
}

export interface BalanceSheetGroup {
  account_type: string;
  accounts: TrialBalanceRow[];
  total: number;
}

export interface BalanceSheetReport {
  assets: BalanceSheetGroup;
  liabilities: BalanceSheetGroup;
  equity: BalanceSheetGroup;
  total_assets: number;
  total_liabilities_equity: number;
}

export interface IncomeStatementReport {
  revenue: BalanceSheetGroup;
  expenses: BalanceSheetGroup;
  total_revenue: number;
  total_expenses: number;
  net_income: number;
}

export interface GeneralLedgerEntry {
  entry_date: string;
  entry_number: string;
  description: string;
  debit_amount: number;
  credit_amount: number;
  running_balance: number;
}

export interface GeneralLedgerAccount {
  account_id: number;
  account_code: string;
  account_name: string;
  entries: GeneralLedgerEntry[];
  opening_balance: number;
  closing_balance: number;
}

export interface GeneralLedgerReport {
  accounts: GeneralLedgerAccount[];
}

// ── Query / List ───────────────────────────────────────────────────
export interface QueryJournalEntryDto {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: string;
  fiscal_period_id?: number;
  date_from?: string;
  date_to?: string;
}

export interface AccountingListResponse<T> {
  data: T[];
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
