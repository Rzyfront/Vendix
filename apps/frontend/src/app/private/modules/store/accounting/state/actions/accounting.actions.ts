import { createAction, props } from '@ngrx/store';
import {
  ChartAccount,
  CreateAccountDto,
  UpdateAccountDto,
  JournalEntry,
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
  FiscalPeriod,
  CreateFiscalPeriodDto,
  TrialBalanceReport,
  BalanceSheetReport,
  IncomeStatementReport,
  GeneralLedgerReport,
  ReportQueryDto,
} from '../../interfaces/accounting.interface';

// ── Chart of Accounts ──────────────────────────────────────────────
export const loadAccounts = createAction('[Accounting] Load Accounts');
export const loadAccountsSuccess = createAction(
  '[Accounting] Load Accounts Success',
  props<{ accounts: ChartAccount[] }>(),
);
export const loadAccountsFailure = createAction(
  '[Accounting] Load Accounts Failure',
  props<{ error: string }>(),
);

export const createAccount = createAction(
  '[Accounting] Create Account',
  props<{ account: CreateAccountDto }>(),
);
export const createAccountSuccess = createAction(
  '[Accounting] Create Account Success',
  props<{ account: ChartAccount }>(),
);
export const createAccountFailure = createAction(
  '[Accounting] Create Account Failure',
  props<{ error: string }>(),
);

export const updateAccount = createAction(
  '[Accounting] Update Account',
  props<{ id: number; account: UpdateAccountDto }>(),
);
export const updateAccountSuccess = createAction(
  '[Accounting] Update Account Success',
  props<{ account: ChartAccount }>(),
);
export const updateAccountFailure = createAction(
  '[Accounting] Update Account Failure',
  props<{ error: string }>(),
);

export const deleteAccount = createAction(
  '[Accounting] Delete Account',
  props<{ id: number }>(),
);
export const deleteAccountSuccess = createAction(
  '[Accounting] Delete Account Success',
  props<{ id: number }>(),
);
export const deleteAccountFailure = createAction(
  '[Accounting] Delete Account Failure',
  props<{ error: string }>(),
);

// ── Journal Entries ────────────────────────────────────────────────
export const loadEntries = createAction('[Accounting] Load Entries');
export const loadEntriesSuccess = createAction(
  '[Accounting] Load Entries Success',
  props<{ entries: JournalEntry[]; meta: any }>(),
);
export const loadEntriesFailure = createAction(
  '[Accounting] Load Entries Failure',
  props<{ error: string }>(),
);

export const loadEntry = createAction(
  '[Accounting] Load Entry',
  props<{ id: number }>(),
);
export const loadEntrySuccess = createAction(
  '[Accounting] Load Entry Success',
  props<{ entry: JournalEntry }>(),
);
export const loadEntryFailure = createAction(
  '[Accounting] Load Entry Failure',
  props<{ error: string }>(),
);

export const createEntry = createAction(
  '[Accounting] Create Entry',
  props<{ entry: CreateJournalEntryDto }>(),
);
export const createEntrySuccess = createAction(
  '[Accounting] Create Entry Success',
  props<{ entry: JournalEntry }>(),
);
export const createEntryFailure = createAction(
  '[Accounting] Create Entry Failure',
  props<{ error: string }>(),
);

export const updateEntry = createAction(
  '[Accounting] Update Entry',
  props<{ id: number; entry: UpdateJournalEntryDto }>(),
);
export const updateEntrySuccess = createAction(
  '[Accounting] Update Entry Success',
  props<{ entry: JournalEntry }>(),
);
export const updateEntryFailure = createAction(
  '[Accounting] Update Entry Failure',
  props<{ error: string }>(),
);

export const deleteEntry = createAction(
  '[Accounting] Delete Entry',
  props<{ id: number }>(),
);
export const deleteEntrySuccess = createAction(
  '[Accounting] Delete Entry Success',
  props<{ id: number }>(),
);
export const deleteEntryFailure = createAction(
  '[Accounting] Delete Entry Failure',
  props<{ error: string }>(),
);

export const postEntry = createAction(
  '[Accounting] Post Entry',
  props<{ id: number }>(),
);
export const postEntrySuccess = createAction(
  '[Accounting] Post Entry Success',
  props<{ entry: JournalEntry }>(),
);
export const postEntryFailure = createAction(
  '[Accounting] Post Entry Failure',
  props<{ error: string }>(),
);

export const voidEntry = createAction(
  '[Accounting] Void Entry',
  props<{ id: number }>(),
);
export const voidEntrySuccess = createAction(
  '[Accounting] Void Entry Success',
  props<{ entry: JournalEntry }>(),
);
export const voidEntryFailure = createAction(
  '[Accounting] Void Entry Failure',
  props<{ error: string }>(),
);

// ── Fiscal Periods ─────────────────────────────────────────────────
export const loadFiscalPeriods = createAction('[Accounting] Load Fiscal Periods');
export const loadFiscalPeriodsSuccess = createAction(
  '[Accounting] Load Fiscal Periods Success',
  props<{ fiscal_periods: FiscalPeriod[] }>(),
);
export const loadFiscalPeriodsFailure = createAction(
  '[Accounting] Load Fiscal Periods Failure',
  props<{ error: string }>(),
);

export const createFiscalPeriod = createAction(
  '[Accounting] Create Fiscal Period',
  props<{ fiscal_period: CreateFiscalPeriodDto }>(),
);
export const createFiscalPeriodSuccess = createAction(
  '[Accounting] Create Fiscal Period Success',
  props<{ fiscal_period: FiscalPeriod }>(),
);
export const createFiscalPeriodFailure = createAction(
  '[Accounting] Create Fiscal Period Failure',
  props<{ error: string }>(),
);

export const closeFiscalPeriod = createAction(
  '[Accounting] Close Fiscal Period',
  props<{ id: number }>(),
);
export const closeFiscalPeriodSuccess = createAction(
  '[Accounting] Close Fiscal Period Success',
  props<{ fiscal_period: FiscalPeriod }>(),
);
export const closeFiscalPeriodFailure = createAction(
  '[Accounting] Close Fiscal Period Failure',
  props<{ error: string }>(),
);

// ── Reports ────────────────────────────────────────────────────────
export const loadTrialBalance = createAction(
  '[Accounting] Load Trial Balance',
  props<{ query: ReportQueryDto }>(),
);
export const loadTrialBalanceSuccess = createAction(
  '[Accounting] Load Trial Balance Success',
  props<{ report: TrialBalanceReport }>(),
);
export const loadTrialBalanceFailure = createAction(
  '[Accounting] Load Trial Balance Failure',
  props<{ error: string }>(),
);

export const loadBalanceSheet = createAction(
  '[Accounting] Load Balance Sheet',
  props<{ query: ReportQueryDto }>(),
);
export const loadBalanceSheetSuccess = createAction(
  '[Accounting] Load Balance Sheet Success',
  props<{ report: BalanceSheetReport }>(),
);
export const loadBalanceSheetFailure = createAction(
  '[Accounting] Load Balance Sheet Failure',
  props<{ error: string }>(),
);

export const loadIncomeStatement = createAction(
  '[Accounting] Load Income Statement',
  props<{ query: ReportQueryDto }>(),
);
export const loadIncomeStatementSuccess = createAction(
  '[Accounting] Load Income Statement Success',
  props<{ report: IncomeStatementReport }>(),
);
export const loadIncomeStatementFailure = createAction(
  '[Accounting] Load Income Statement Failure',
  props<{ error: string }>(),
);

export const loadGeneralLedger = createAction(
  '[Accounting] Load General Ledger',
  props<{ query: ReportQueryDto }>(),
);
export const loadGeneralLedgerSuccess = createAction(
  '[Accounting] Load General Ledger Success',
  props<{ report: GeneralLedgerReport }>(),
);
export const loadGeneralLedgerFailure = createAction(
  '[Accounting] Load General Ledger Failure',
  props<{ error: string }>(),
);

// ── Filters ────────────────────────────────────────────────────────
export const setSearch = createAction(
  '[Accounting] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[Accounting] Set Page',
  props<{ page: number }>(),
);
export const setSort = createAction(
  '[Accounting] Set Sort',
  props<{ sort_by: string; sort_order: 'asc' | 'desc' }>(),
);
export const setStatusFilter = createAction(
  '[Accounting] Set Status Filter',
  props<{ status_filter: string }>(),
);
export const setPeriodFilter = createAction(
  '[Accounting] Set Period Filter',
  props<{ period_filter: number | null }>(),
);
export const setDateRange = createAction(
  '[Accounting] Set Date Range',
  props<{ date_from: string; date_to: string }>(),
);
export const clearFilters = createAction('[Accounting] Clear Filters');

// ── Clear State ────────────────────────────────────────────────────
export const clearAccountingState = createAction('[Accounting] Clear State');
