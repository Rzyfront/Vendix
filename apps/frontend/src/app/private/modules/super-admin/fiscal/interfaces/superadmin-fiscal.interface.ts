// ============================================================================
// Super-Admin Fiscal Module — Type Contracts
// ============================================================================
// Mirrors the backend response shapes exposed under `/super-admin/fiscal/*`.
// These types are intentionally permissive (snake_case preserved where the
// API uses it) to keep mapping work isolated to the service layer.
// ============================================================================

// ─── Generic Envelopes ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// ─── Dashboard KPIs ────────────────────────────────────────────────────────

export interface DashboardKpis {
  revenue_month: string;
  partner_payouts_month: string;
  refunds_month: string;
  manual_entries_count: number;
  pending_obligations: number;
  current_period: {
    id: string;
    name: string;
    days_remaining: number;
    closes_at: string;
  } | null;
}

// ─── Chart of Accounts (PUC) ───────────────────────────────────────────────

export type AccountNature = 'DEBIT' | 'CREDIT';
export type ChartAccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE'
  | 'COST'
  | 'MEMO';

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  account_type: ChartAccountType;
  nature: AccountNature;
  parent_code: string | null;
  level: number;
  accepts_entries: boolean;
  is_active: boolean;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateChartAccountDto {
  code: string;
  name: string;
  parent_code: string;
  account_type?: ChartAccountType;
  nature?: AccountNature;
  accepts_entries?: boolean;
  is_active?: boolean;
  description?: string;
}

export interface ChartOfAccountsQuery {
  search?: string;
  account_type?: ChartAccountType;
  page?: number;
  limit?: number;
}

// ─── Journal Entries ───────────────────────────────────────────────────────

export type JournalEntrySourceType =
  | 'saas_revenue'
  | 'saas_refund'
  | 'saas_bad_debt'
  | 'saas_partner_payout'
  | 'saas_partner_payout_paid'
  | 'manual_journal_entry'
  | string;

export interface JournalEntryLine {
  id?: string;
  account_code: string;
  account_name?: string;
  description?: string;
  debit_amount: string | number;
  credit_amount: string | number;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  source_type: JournalEntrySourceType;
  source_id?: string | number | null;
  total_debit: string | number;
  total_credit: string | number;
  lines_count: number;
  fiscal_period_id: string;
  fiscal_period_name?: string;
  lines?: JournalEntryLine[];
  created_by_user_id?: string | number | null;
  created_at?: string;
  voided?: boolean;
}

export interface JournalEntryQuery {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  source_type?: JournalEntrySourceType | 'all';
  fiscal_period_id?: string;
  search?: string;
}

export interface CreateManualJournalEntryLineDto {
  account_code: string;
  description?: string;
  debit_amount: number;
  credit_amount: number;
}

export interface CreateManualJournalEntryDto {
  entry_date: string;
  fiscal_period_id: string;
  description: string;
  lines: CreateManualJournalEntryLineDto[];
}

// ─── Account Mappings ──────────────────────────────────────────────────────

export type AccountMappingSource = 'default' | 'organization' | 'partner';

export interface AccountMapping {
  id: string;
  mapping_key: string;
  account_code: string;
  account_name?: string;
  source: AccountMappingSource;
  override_account_code?: string | null;
  override_account_name?: string | null;
  description?: string;
  updated_at?: string;
}

// ─── Fiscal Periods ────────────────────────────────────────────────────────

export type FiscalPeriodState = 'open' | 'closed' | 'reopened';

export interface FiscalPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  state: FiscalPeriodState;
  closed_at?: string | null;
  closed_by_user_id?: string | number | null;
  notes?: string | null;
}

// ─── Reports ───────────────────────────────────────────────────────────────

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: ChartAccountType;
  total_debit: string | number;
  total_credit: string | number;
  net_balance: string | number;
}

export interface BalanceSheetGroup {
  account_type: ChartAccountType;
  label: string;
  total: string | number;
  accounts: Array<{
    account_code: string;
    account_name: string;
    balance: string | number;
  }>;
}

export interface BalanceSheetReport {
  as_of: string;
  assets: BalanceSheetGroup;
  liabilities: BalanceSheetGroup;
  equity: BalanceSheetGroup;
  total_assets: string | number;
  total_liabilities_equity: string | number;
}

export interface IncomeStatementReport {
  from: string;
  to: string;
  revenue: BalanceSheetGroup;
  expenses: BalanceSheetGroup;
  cost: BalanceSheetGroup;
  total_revenue: string | number;
  total_expenses: string | number;
  total_cost: string | number;
  net_income: string | number;
}

export interface GeneralLedgerRow {
  entry_number: string;
  entry_date: string;
  description: string;
  source_type: JournalEntrySourceType;
  account_code: string;
  debit_amount: string | number;
  credit_amount: string | number;
  balance: string | number;
}

// ─── Obligations ───────────────────────────────────────────────────────────

export type ObligationFormType = 'iva' | 'retefuente' | 'ica' | 'exogena' | 'other';
export type ObligationStatus =
  | 'pending'
  | 'due_soon'
  | 'filed'
  | 'submitted'
  | 'overdue'
  | 'not_applicable';

export interface Obligation {
  id: string;
  name: string;
  form_type: ObligationFormType;
  period: string;
  due_date: string;
  status: ObligationStatus;
  amount: string | number;
  currency?: string;
  notes?: string | null;
  filed_at?: string | null;
  filed_by_user_id?: string | number | null;
}
