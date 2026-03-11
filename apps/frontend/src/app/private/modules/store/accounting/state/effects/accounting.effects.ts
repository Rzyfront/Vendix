import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, exhaustMap, catchError, withLatestFrom } from 'rxjs/operators';
import { AccountingService } from '../../services/accounting.service';
import * as AccountingActions from '../actions/accounting.actions';
import { selectAccountingState } from '../selectors/accounting.selectors';

@Injectable()
export class AccountingEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private accounting_service = inject(AccountingService);

  // ── Chart of Accounts ────────────────────────────────────────────
  loadAccounts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadAccounts),
      switchMap(() =>
        this.accounting_service.getChartOfAccounts().pipe(
          map((response) =>
            AccountingActions.loadAccountsSuccess({ accounts: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadAccountsFailure({
              error: error.error?.message || error.message || 'Error loading accounts',
            })),
          ),
        ),
      ),
    ),
  );

  createAccount$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.createAccount),
      switchMap(({ account }) =>
        this.accounting_service.createAccount(account).pipe(
          map((response) =>
            AccountingActions.createAccountSuccess({ account: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.createAccountFailure({
              error: error.error?.message || error.message || 'Error creating account',
            })),
          ),
        ),
      ),
    ),
  );

  updateAccount$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.updateAccount),
      switchMap(({ id, account }) =>
        this.accounting_service.updateAccount(id, account).pipe(
          map((response) =>
            AccountingActions.updateAccountSuccess({ account: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.updateAccountFailure({
              error: error.error?.message || error.message || 'Error updating account',
            })),
          ),
        ),
      ),
    ),
  );

  deleteAccount$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.deleteAccount),
      switchMap(({ id }) =>
        this.accounting_service.deleteAccount(id).pipe(
          map(() => AccountingActions.deleteAccountSuccess({ id })),
          catchError((error) =>
            of(AccountingActions.deleteAccountFailure({
              error: error.error?.message || error.message || 'Error deleting account',
            })),
          ),
        ),
      ),
    ),
  );

  // Reload accounts after mutation
  accountMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AccountingActions.createAccountSuccess,
        AccountingActions.updateAccountSuccess,
        AccountingActions.deleteAccountSuccess,
      ),
      map(() => AccountingActions.loadAccounts()),
    ),
  );

  // ── Journal Entries ──────────────────────────────────────────────
  loadEntries$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadEntries),
      withLatestFrom(this.store.select(selectAccountingState)),
      switchMap(([, state]) =>
        this.accounting_service.getJournalEntries({
          page: state.page,
          limit: state.limit,
          search: state.search || undefined,
          sort_by: state.sort_by,
          sort_order: state.sort_order,
          status: state.status_filter || undefined,
          fiscal_period_id: state.period_filter || undefined,
          date_from: state.date_from || undefined,
          date_to: state.date_to || undefined,
        }).pipe(
          map((response) =>
            AccountingActions.loadEntriesSuccess({ entries: response.data, meta: response.meta }),
          ),
          catchError((error) =>
            of(AccountingActions.loadEntriesFailure({
              error: error.error?.message || error.message || 'Error loading entries',
            })),
          ),
        ),
      ),
    ),
  );

  loadEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadEntry),
      switchMap(({ id }) =>
        this.accounting_service.getJournalEntry(id).pipe(
          map((response) =>
            AccountingActions.loadEntrySuccess({ entry: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadEntryFailure({
              error: error.error?.message || error.message || 'Error loading entry',
            })),
          ),
        ),
      ),
    ),
  );

  createEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.createEntry),
      switchMap(({ entry }) =>
        this.accounting_service.createJournalEntry(entry).pipe(
          map((response) =>
            AccountingActions.createEntrySuccess({ entry: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.createEntryFailure({
              error: error.error?.message || error.message || 'Error creating entry',
            })),
          ),
        ),
      ),
    ),
  );

  updateEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.updateEntry),
      switchMap(({ id, entry }) =>
        this.accounting_service.updateJournalEntry(id, entry).pipe(
          map((response) =>
            AccountingActions.updateEntrySuccess({ entry: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.updateEntryFailure({
              error: error.error?.message || error.message || 'Error updating entry',
            })),
          ),
        ),
      ),
    ),
  );

  deleteEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.deleteEntry),
      switchMap(({ id }) =>
        this.accounting_service.deleteJournalEntry(id).pipe(
          map(() => AccountingActions.deleteEntrySuccess({ id })),
          catchError((error) =>
            of(AccountingActions.deleteEntryFailure({
              error: error.error?.message || error.message || 'Error deleting entry',
            })),
          ),
        ),
      ),
    ),
  );

  postEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.postEntry),
      switchMap(({ id }) =>
        this.accounting_service.postJournalEntry(id).pipe(
          map((response) =>
            AccountingActions.postEntrySuccess({ entry: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.postEntryFailure({
              error: error.error?.message || error.message || 'Error posting entry',
            })),
          ),
        ),
      ),
    ),
  );

  voidEntry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.voidEntry),
      switchMap(({ id }) =>
        this.accounting_service.voidJournalEntry(id).pipe(
          map((response) =>
            AccountingActions.voidEntrySuccess({ entry: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.voidEntryFailure({
              error: error.error?.message || error.message || 'Error voiding entry',
            })),
          ),
        ),
      ),
    ),
  );

  // Cascade: filter change reloads entries
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AccountingActions.setSearch,
        AccountingActions.setPage,
        AccountingActions.setSort,
        AccountingActions.setStatusFilter,
        AccountingActions.setPeriodFilter,
        AccountingActions.setDateRange,
        AccountingActions.clearFilters,
      ),
      map(() => AccountingActions.loadEntries()),
    ),
  );

  // After entry mutation success, reload entries
  entryMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AccountingActions.createEntrySuccess,
        AccountingActions.updateEntrySuccess,
        AccountingActions.deleteEntrySuccess,
        AccountingActions.postEntrySuccess,
        AccountingActions.voidEntrySuccess,
      ),
      map(() => AccountingActions.loadEntries()),
    ),
  );

  // ── Fiscal Periods ───────────────────────────────────────────────
  loadFiscalPeriods$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadFiscalPeriods),
      exhaustMap(() =>
        this.accounting_service.getFiscalPeriods().pipe(
          map((response) =>
            AccountingActions.loadFiscalPeriodsSuccess({ fiscal_periods: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadFiscalPeriodsFailure({
              error: error.error?.message || error.message || 'Error loading fiscal periods',
            })),
          ),
        ),
      ),
    ),
  );

  createFiscalPeriod$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.createFiscalPeriod),
      switchMap(({ fiscal_period }) =>
        this.accounting_service.createFiscalPeriod(fiscal_period).pipe(
          map((response) =>
            AccountingActions.createFiscalPeriodSuccess({ fiscal_period: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.createFiscalPeriodFailure({
              error: error.error?.message || error.message || 'Error creating fiscal period',
            })),
          ),
        ),
      ),
    ),
  );

  closeFiscalPeriod$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.closeFiscalPeriod),
      switchMap(({ id }) =>
        this.accounting_service.closeFiscalPeriod(id).pipe(
          map((response) =>
            AccountingActions.closeFiscalPeriodSuccess({ fiscal_period: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.closeFiscalPeriodFailure({
              error: error.error?.message || error.message || 'Error closing fiscal period',
            })),
          ),
        ),
      ),
    ),
  );

  // ── Reports ──────────────────────────────────────────────────────
  loadTrialBalance$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadTrialBalance),
      switchMap(({ query }) =>
        this.accounting_service.getTrialBalance(query).pipe(
          map((response) =>
            AccountingActions.loadTrialBalanceSuccess({ report: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadTrialBalanceFailure({
              error: error.error?.message || error.message || 'Error loading trial balance',
            })),
          ),
        ),
      ),
    ),
  );

  loadBalanceSheet$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadBalanceSheet),
      switchMap(({ query }) =>
        this.accounting_service.getBalanceSheet(query).pipe(
          map((response) =>
            AccountingActions.loadBalanceSheetSuccess({ report: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadBalanceSheetFailure({
              error: error.error?.message || error.message || 'Error loading balance sheet',
            })),
          ),
        ),
      ),
    ),
  );

  loadIncomeStatement$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadIncomeStatement),
      switchMap(({ query }) =>
        this.accounting_service.getIncomeStatement(query).pipe(
          map((response) =>
            AccountingActions.loadIncomeStatementSuccess({ report: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadIncomeStatementFailure({
              error: error.error?.message || error.message || 'Error loading income statement',
            })),
          ),
        ),
      ),
    ),
  );

  loadGeneralLedger$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AccountingActions.loadGeneralLedger),
      switchMap(({ query }) =>
        this.accounting_service.getGeneralLedger(query).pipe(
          map((response) =>
            AccountingActions.loadGeneralLedgerSuccess({ report: response.data }),
          ),
          catchError((error) =>
            of(AccountingActions.loadGeneralLedgerFailure({
              error: error.error?.message || error.message || 'Error loading general ledger',
            })),
          ),
        ),
      ),
    ),
  );
}
