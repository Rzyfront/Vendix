import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AccountingState } from '../accounting.state';
import { ChartAccount } from '../../interfaces/accounting.interface';

export const selectAccountingState =
  createFeatureSelector<AccountingState>('accounting');

// ── Chart of Accounts ──────────────────────────────────────────────
export const selectAccounts = createSelector(
  selectAccountingState,
  (state) => state.accounts,
);

export const selectAccountsLoading = createSelector(
  selectAccountingState,
  (state) => state.accounts_loading,
);

export const selectLeafAccounts = createSelector(
  selectAccounts,
  (accounts) => flattenAccounts(accounts).filter((a) => a.accepts_entries),
);

// ── Journal Entries ────────────────────────────────────────────────
export const selectEntries = createSelector(
  selectAccountingState,
  (state) => state.entries,
);

export const selectEntriesLoading = createSelector(
  selectAccountingState,
  (state) => state.entries_loading,
);

export const selectEntriesMeta = createSelector(
  selectAccountingState,
  (state) => state.entries_meta,
);

export const selectCurrentEntry = createSelector(
  selectAccountingState,
  (state) => state.current_entry,
);

export const selectCurrentEntryLoading = createSelector(
  selectAccountingState,
  (state) => state.current_entry_loading,
);

// ── Fiscal Periods ─────────────────────────────────────────────────
export const selectFiscalPeriods = createSelector(
  selectAccountingState,
  (state) => state.fiscal_periods,
);

export const selectFiscalPeriodsLoading = createSelector(
  selectAccountingState,
  (state) => state.fiscal_periods_loading,
);

export const selectOpenFiscalPeriods = createSelector(
  selectFiscalPeriods,
  (periods) => periods.filter((p) => p.status === 'open'),
);

// ── Reports ────────────────────────────────────────────────────────
export const selectTrialBalance = createSelector(
  selectAccountingState,
  (state) => state.trial_balance,
);

export const selectBalanceSheet = createSelector(
  selectAccountingState,
  (state) => state.balance_sheet,
);

export const selectIncomeStatement = createSelector(
  selectAccountingState,
  (state) => state.income_statement,
);

export const selectGeneralLedger = createSelector(
  selectAccountingState,
  (state) => state.general_ledger,
);

export const selectReportLoading = createSelector(
  selectAccountingState,
  (state) => state.report_loading,
);

// ── Account Mappings ──────────────────────────────────────────────
export const selectAccountMappings = createSelector(
  selectAccountingState,
  (state) => state.account_mappings,
);

export const selectAccountMappingsLoading = createSelector(
  selectAccountingState,
  (state) => state.account_mappings_loading,
);

// ── Filters ────────────────────────────────────────────────────────
export const selectSearch = createSelector(
  selectAccountingState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectAccountingState,
  (state) => state.page,
);

export const selectError = createSelector(
  selectAccountingState,
  (state) => state.error,
);

// ── Helper ─────────────────────────────────────────────────────────
function flattenAccounts(accounts: ChartAccount[]): ChartAccount[] {
  const result: ChartAccount[] = [];
  for (const account of accounts) {
    result.push(account);
    if (account.children && account.children.length > 0) {
      result.push(...flattenAccounts(account.children));
    }
  }
  return result;
}
