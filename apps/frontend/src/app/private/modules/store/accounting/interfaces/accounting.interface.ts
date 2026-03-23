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

// ── Account Mappings ──────────────────────────────────────────────
export interface AccountMapping {
  mapping_key: string;
  account_code: string;
  account_id?: number;
  description: string;
  source: 'store' | 'organization' | 'default';
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

// ── Bank Reconciliation ─────────────────────────────────────────
export interface BankAccount {
  id: number;
  name: string;
  account_number: string;
  bank_name: string;
  bank_code?: string;
  currency: string;
  opening_balance: number;
  current_balance: number;
  status: 'active' | 'inactive' | 'closed';
  chart_account_id?: number;
  chart_account?: ChartAccount;
  column_mapping?: ColumnMappingConfig;
  unreconciled_count?: number;
  created_at: string;
}

export interface ColumnMappingConfig {
  date_column: string;
  description_column: string;
  amount_column?: string;
  debit_column?: string;
  credit_column?: string;
  reference_column?: string;
  external_id_column?: string;
  date_format?: string;
  decimal_separator?: '.' | ',';
  skip_rows?: number;
}

export interface BankTransaction {
  id: number;
  bank_account_id: number;
  transaction_date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  reference?: string;
  external_id?: string;
  counterparty?: string;
  is_reconciled: boolean;
}

export interface BankReconciliation {
  id: number;
  bank_account_id: number;
  bank_account?: BankAccount;
  period_start: string;
  period_end: string;
  opening_balance: number;
  statement_balance: number;
  reconciled_balance: number;
  difference: number;
  status: 'draft' | 'in_progress' | 'completed';
  total_matches?: number;
  unmatched_bank?: number;
  unmatched_accounting?: number;
  created_at: string;
}

export interface ReconciliationMatch {
  id: number;
  bank_transaction_id: number;
  accounting_entry_id?: number;
  match_type: 'auto' | 'manual';
  confidence_score?: number;
  bank_transaction?: BankTransaction;
  accounting_entry?: JournalEntry;
}

export interface ImportStatementResult {
  imported: number;
  duplicates_skipped: number;
  errors: string[];
}

export interface AutoMatchResult {
  total_matched: number;
  remaining_unmatched_bank: number;
  remaining_unmatched_accounting: number;
}

// ── Fixed Assets ────────────────────────────────────────────────
export interface FixedAssetCategory {
  id: number;
  name: string;
  default_useful_life_months: number;
  default_depreciation_method: 'straight_line' | 'declining_balance';
  default_salvage_percentage: number;
  depreciation_account_code?: string;
  expense_account_code?: string;
  is_active: boolean;
}

export interface FixedAsset {
  id: number;
  category_id?: number;
  category?: FixedAssetCategory;
  asset_number: string;
  name: string;
  description?: string;
  acquisition_date: string;
  acquisition_cost: number;
  salvage_value: number;
  useful_life_months: number;
  depreciation_method: 'straight_line' | 'declining_balance';
  status: 'active' | 'fully_depreciated' | 'retired' | 'disposed';
  accumulated_depreciation: number;
  book_value?: number;
  depreciation_start_date?: string;
  retirement_date?: string;
  disposal_date?: string;
  disposal_amount?: number;
  notes?: string;
  created_at: string;
}

export interface DepreciationEntry {
  id: number;
  fixed_asset_id: number;
  period_date: string;
  depreciation_amount: number;
  accumulated_total: number;
  book_value: number;
  accounting_entry_id?: number;
  status: 'pending' | 'posted';
  created_at: string;
}

export interface DepreciationScheduleEntry {
  month: number;
  period_date: string;
  depreciation_amount: number;
  accumulated_total: number;
  book_value: number;
}

export interface AssetReportRow {
  id: number;
  asset_number: string;
  name: string;
  category_name?: string;
  acquisition_cost: number;
  accumulated_depreciation: number;
  book_value: number;
  status: string;
  useful_life_months: number;
}

// ── Budgets ─────────────────────────────────────────────────────
export interface Budget {
  id: number;
  fiscal_period_id: number;
  fiscal_period?: FiscalPeriod;
  name: string;
  description?: string;
  status: 'draft' | 'approved' | 'active' | 'closed';
  variance_threshold?: number;
  store_id?: number;
  budget_lines?: BudgetLine[];
  approved_at?: string;
  created_at: string;
}

export interface BudgetLine {
  id: number;
  budget_id: number;
  account_id: number;
  account?: ChartAccount;
  month_01: number;
  month_02: number;
  month_03: number;
  month_04: number;
  month_05: number;
  month_06: number;
  month_07: number;
  month_08: number;
  month_09: number;
  month_10: number;
  month_11: number;
  month_12: number;
  total_budgeted: number;
}

export interface VarianceRow {
  account_id: number;
  account_code: string;
  account_name: string;
  budgeted: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

export interface MonthlyTrendData {
  month: number;
  budgeted_total: number;
  actual_total: number;
}

export interface VarianceAlert {
  account_id: number;
  account_code: string;
  account_name: string;
  budgeted: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

// ── Consolidation ───────────────────────────────────────────────
export interface ConsolidationSession {
  id: number;
  fiscal_period_id: number;
  fiscal_period?: FiscalPeriod;
  name: string;
  session_date: string;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  notes?: string;
  completed_at?: string;
  adjustments_count?: number;
  intercompany_count?: number;
  created_at: string;
}

export interface IntercompanyTransaction {
  id: number;
  session_id: number;
  from_store_id: number;
  from_store?: { id: number; name: string };
  to_store_id: number;
  to_store?: { id: number; name: string };
  entry_id: number;
  account_id: number;
  account?: ChartAccount;
  amount: number;
  eliminated: boolean;
  eliminated_at?: string;
}

export interface ConsolidationAdjustment {
  id: number;
  session_id: number;
  account_id: number;
  account?: ChartAccount;
  type: 'elimination' | 'reclassification' | 'adjustment';
  debit_amount: number;
  credit_amount: number;
  description: string;
  store_id?: number;
}

export interface ConsolidatedReport {
  stores?: Array<{ store: { id: number; name: string }; balance: any }>;
  combined: any;
  adjustments: ConsolidationAdjustment[];
  consolidated: any;
}

export interface CreateConsolidationSessionDto {
  fiscal_period_id: number;
  name: string;
  notes?: string;
}

export interface CreateConsolidationAdjustmentDto {
  account_id: number;
  type: 'elimination' | 'reclassification' | 'adjustment';
  debit_amount: number;
  credit_amount: number;
  description: string;
}
