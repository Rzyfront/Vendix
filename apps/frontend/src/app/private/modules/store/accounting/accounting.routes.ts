import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { accountingReducer } from './state/reducers/accounting.reducer';
import { AccountingEffects } from './state/effects/accounting.effects';

export const accountingRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState({ name: 'accounting', reducer: accountingReducer }),
      provideEffects(AccountingEffects),
    ],
    loadComponent: () =>
      import('./accounting.component').then((c) => c.AccountingComponent),
    children: [
      {
        path: '',
        redirectTo: 'chart-of-accounts',
        pathMatch: 'full',
      },
      {
        path: 'chart-of-accounts',
        loadComponent: () =>
          import('./components/chart-of-accounts/chart-of-accounts.component').then(
            (c) => c.ChartOfAccountsComponent,
          ),
      },
      {
        path: 'journal-entries',
        loadComponent: () =>
          import('./components/journal-entries/journal-entries.component').then(
            (c) => c.JournalEntriesComponent,
          ),
      },
      {
        path: 'fiscal-periods',
        loadComponent: () =>
          import('./components/fiscal-periods/fiscal-periods.component').then(
            (c) => c.FiscalPeriodsComponent,
          ),
      },
      {
        path: 'account-mappings',
        loadComponent: () =>
          import('./components/account-mappings/account-mappings.component').then(
            (c) => c.AccountMappingsComponent,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./components/reports/reports.component').then(
            (c) => c.ReportsComponent,
          ),
        children: [
          {
            path: '',
            redirectTo: 'trial-balance',
            pathMatch: 'full',
          },
          {
            path: 'trial-balance',
            loadComponent: () =>
              import('./components/reports/trial-balance/trial-balance.component').then(
                (c) => c.TrialBalanceComponent,
              ),
          },
          {
            path: 'balance-sheet',
            loadComponent: () =>
              import('./components/reports/balance-sheet/balance-sheet.component').then(
                (c) => c.BalanceSheetComponent,
              ),
          },
          {
            path: 'income-statement',
            loadComponent: () =>
              import('./components/reports/income-statement/income-statement.component').then(
                (c) => c.IncomeStatementComponent,
              ),
          },
          {
            path: 'general-ledger',
            loadComponent: () =>
              import('./components/reports/general-ledger/general-ledger.component').then(
                (c) => c.GeneralLedgerComponent,
              ),
          },
        ],
      },
    ],
  },
];
