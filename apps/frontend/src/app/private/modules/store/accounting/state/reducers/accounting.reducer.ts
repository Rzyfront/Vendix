import { createReducer, on } from '@ngrx/store';
import { AccountingState, initialAccountingState } from '../accounting.state';
import * as AccountingActions from '../actions/accounting.actions';

export const accountingReducer = createReducer(
  initialAccountingState,

  // ── Chart of Accounts ────────────────────────────────────────────
  on(AccountingActions.loadAccounts, (state) => ({
    ...state,
    accounts_loading: true,
    error: null,
  })),
  on(AccountingActions.loadAccountsSuccess, (state, { accounts }) => ({
    ...state,
    accounts,
    accounts_loading: false,
    error: null,
  })),
  on(AccountingActions.loadAccountsFailure, (state, { error }) => ({
    ...state,
    accounts_loading: false,
    error,
  })),

  on(AccountingActions.createAccount, (state) => ({
    ...state,
    accounts_loading: true,
    error: null,
  })),
  on(AccountingActions.createAccountSuccess, (state) => ({
    ...state,
    accounts_loading: false,
    error: null,
  })),
  on(AccountingActions.createAccountFailure, (state, { error }) => ({
    ...state,
    accounts_loading: false,
    error,
  })),

  on(AccountingActions.updateAccount, (state) => ({
    ...state,
    accounts_loading: true,
    error: null,
  })),
  on(AccountingActions.updateAccountSuccess, (state) => ({
    ...state,
    accounts_loading: false,
    error: null,
  })),
  on(AccountingActions.updateAccountFailure, (state, { error }) => ({
    ...state,
    accounts_loading: false,
    error,
  })),

  on(AccountingActions.deleteAccount, (state) => ({
    ...state,
    accounts_loading: true,
    error: null,
  })),
  on(AccountingActions.deleteAccountSuccess, (state) => ({
    ...state,
    accounts_loading: false,
    error: null,
  })),
  on(AccountingActions.deleteAccountFailure, (state, { error }) => ({
    ...state,
    accounts_loading: false,
    error,
  })),

  // ── Journal Entries ──────────────────────────────────────────────
  on(AccountingActions.loadEntries, (state) => ({
    ...state,
    entries_loading: true,
    error: null,
  })),
  on(AccountingActions.loadEntriesSuccess, (state, { entries, meta }) => ({
    ...state,
    entries,
    entries_meta: meta,
    entries_loading: false,
    error: null,
  })),
  on(AccountingActions.loadEntriesFailure, (state, { error }) => ({
    ...state,
    entries_loading: false,
    error,
  })),

  on(AccountingActions.loadEntry, (state) => ({
    ...state,
    current_entry_loading: true,
    error: null,
  })),
  on(AccountingActions.loadEntrySuccess, (state, { entry }) => ({
    ...state,
    current_entry: entry,
    current_entry_loading: false,
    error: null,
  })),
  on(AccountingActions.loadEntryFailure, (state, { error }) => ({
    ...state,
    current_entry_loading: false,
    error,
  })),

  on(AccountingActions.createEntry, (state) => ({
    ...state,
    entries_loading: true,
    error: null,
  })),
  on(AccountingActions.createEntrySuccess, (state) => ({
    ...state,
    entries_loading: false,
    error: null,
  })),
  on(AccountingActions.createEntryFailure, (state, { error }) => ({
    ...state,
    entries_loading: false,
    error,
  })),

  on(AccountingActions.updateEntry, (state) => ({
    ...state,
    entries_loading: true,
    error: null,
  })),
  on(AccountingActions.updateEntrySuccess, (state, { entry }) => ({
    ...state,
    current_entry: entry,
    entries_loading: false,
    error: null,
  })),
  on(AccountingActions.updateEntryFailure, (state, { error }) => ({
    ...state,
    entries_loading: false,
    error,
  })),

  on(AccountingActions.deleteEntry, (state) => ({
    ...state,
    entries_loading: true,
    error: null,
  })),
  on(AccountingActions.deleteEntrySuccess, (state, { id }) => ({
    ...state,
    current_entry: state.current_entry?.id === id ? null : state.current_entry,
    entries_loading: false,
    error: null,
  })),
  on(AccountingActions.deleteEntryFailure, (state, { error }) => ({
    ...state,
    entries_loading: false,
    error,
  })),

  // Post / Void
  on(AccountingActions.postEntry, AccountingActions.voidEntry, (state) => ({
    ...state,
    entries_loading: true,
    error: null,
  })),
  on(AccountingActions.postEntrySuccess, AccountingActions.voidEntrySuccess, (state, { entry }) => ({
    ...state,
    current_entry: entry,
    entries_loading: false,
    error: null,
  })),
  on(AccountingActions.postEntryFailure, AccountingActions.voidEntryFailure, (state, { error }) => ({
    ...state,
    entries_loading: false,
    error,
  })),

  // ── Fiscal Periods ───────────────────────────────────────────────
  on(AccountingActions.loadFiscalPeriods, (state) => ({
    ...state,
    fiscal_periods_loading: true,
    error: null,
  })),
  on(AccountingActions.loadFiscalPeriodsSuccess, (state, { fiscal_periods }) => ({
    ...state,
    fiscal_periods,
    fiscal_periods_loading: false,
    error: null,
  })),
  on(AccountingActions.loadFiscalPeriodsFailure, (state, { error }) => ({
    ...state,
    fiscal_periods_loading: false,
    error,
  })),

  on(AccountingActions.createFiscalPeriod, (state) => ({
    ...state,
    fiscal_periods_loading: true,
    error: null,
  })),
  on(AccountingActions.createFiscalPeriodSuccess, (state, { fiscal_period }) => ({
    ...state,
    fiscal_periods: [...state.fiscal_periods, fiscal_period],
    fiscal_periods_loading: false,
    error: null,
  })),
  on(AccountingActions.createFiscalPeriodFailure, (state, { error }) => ({
    ...state,
    fiscal_periods_loading: false,
    error,
  })),

  on(AccountingActions.closeFiscalPeriod, (state) => ({
    ...state,
    fiscal_periods_loading: true,
    error: null,
  })),
  on(AccountingActions.closeFiscalPeriodSuccess, (state, { fiscal_period }) => ({
    ...state,
    fiscal_periods: state.fiscal_periods.map((fp) =>
      fp.id === fiscal_period.id ? fiscal_period : fp,
    ),
    fiscal_periods_loading: false,
    error: null,
  })),
  on(AccountingActions.closeFiscalPeriodFailure, (state, { error }) => ({
    ...state,
    fiscal_periods_loading: false,
    error,
  })),

  // ── Reports ──────────────────────────────────────────────────────
  on(
    AccountingActions.loadTrialBalance,
    AccountingActions.loadBalanceSheet,
    AccountingActions.loadIncomeStatement,
    AccountingActions.loadGeneralLedger,
    (state) => ({
      ...state,
      report_loading: true,
      error: null,
    }),
  ),
  on(AccountingActions.loadTrialBalanceSuccess, (state, { report }) => ({
    ...state,
    trial_balance: report,
    report_loading: false,
  })),
  on(AccountingActions.loadBalanceSheetSuccess, (state, { report }) => ({
    ...state,
    balance_sheet: report,
    report_loading: false,
  })),
  on(AccountingActions.loadIncomeStatementSuccess, (state, { report }) => ({
    ...state,
    income_statement: report,
    report_loading: false,
  })),
  on(AccountingActions.loadGeneralLedgerSuccess, (state, { report }) => ({
    ...state,
    general_ledger: report,
    report_loading: false,
  })),
  on(
    AccountingActions.loadTrialBalanceFailure,
    AccountingActions.loadBalanceSheetFailure,
    AccountingActions.loadIncomeStatementFailure,
    AccountingActions.loadGeneralLedgerFailure,
    (state, { error }) => ({
      ...state,
      report_loading: false,
      error,
    }),
  ),

  // ── Filters ──────────────────────────────────────────────────────
  on(AccountingActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(AccountingActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(AccountingActions.setSort, (state, { sort_by, sort_order }) => ({
    ...state,
    sort_by,
    sort_order,
    page: 1,
  })),
  on(AccountingActions.setStatusFilter, (state, { status_filter }) => ({
    ...state,
    status_filter,
    page: 1,
  })),
  on(AccountingActions.setPeriodFilter, (state, { period_filter }) => ({
    ...state,
    period_filter,
    page: 1,
  })),
  on(AccountingActions.setDateRange, (state, { date_from, date_to }) => ({
    ...state,
    date_from,
    date_to,
    page: 1,
  })),
  on(AccountingActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    status_filter: '',
    period_filter: null,
    date_from: '',
    date_to: '',
  })),

  // ── Clear State ──────────────────────────────────────────────────
  on(AccountingActions.clearAccountingState, () => initialAccountingState),
);
