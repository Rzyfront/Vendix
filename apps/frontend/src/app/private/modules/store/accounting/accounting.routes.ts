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
        path: 'fixed-assets',
        loadComponent: () =>
          import('./components/fixed-assets/fixed-assets.component').then(
            (c) => c.FixedAssetsComponent,
          ),
      },
      {
        path: 'consolidation',
        loadComponent: () =>
          import('./components/consolidation/consolidation.component').then(
            (c) => c.ConsolidationComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./components/consolidation/consolidation-sessions/consolidation-sessions.component').then(
                (c) => c.ConsolidationSessionsComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./components/consolidation/session-detail/session-detail.component').then(
                (c) => c.SessionDetailComponent,
              ),
          },
        ],
      },
      {
        path: 'bank-reconciliation',
        loadComponent: () =>
          import('./components/bank-reconciliation/bank-reconciliation.component').then(
            (c) => c.BankReconciliationComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./components/bank-reconciliation/bank-accounts.component').then(
                (c) => c.BankAccountsComponent,
              ),
          },
          {
            path: 'reconciliations',
            loadComponent: () =>
              import('./components/bank-reconciliation/reconciliation-list.component').then(
                (c) => c.ReconciliationListComponent,
              ),
          },
          {
            path: 'reconciliations/:id',
            loadComponent: () =>
              import('./components/bank-reconciliation/reconciliation-workspace.component').then(
                (c) => c.ReconciliationWorkspaceComponent,
              ),
          },
        ],
      },
      {
        path: 'budgets',
        loadComponent: () =>
          import('./components/budgets/budgets.component').then(
            (c) => c.BudgetsComponent,
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./components/budgets/budget-list/budget-list.component').then(
                (c) => c.BudgetListComponent,
              ),
          },
          {
            path: ':budgetId/editor',
            loadComponent: () =>
              import('./components/budgets/budget-editor/budget-editor.component').then(
                (c) => c.BudgetEditorComponent,
              ),
          },
          {
            path: ':budgetId/variance',
            loadComponent: () =>
              import('./components/budgets/budget-variance/budget-variance.component').then(
                (c) => c.BudgetVarianceComponent,
              ),
          },
        ],
      },
      {
        path: 'receivables',
        loadComponent: () =>
          import('./components/receivables/receivables.component').then(
            (c) => c.ReceivablesComponent,
          ),
      },
      {
        path: 'payables',
        loadComponent: () =>
          import('./components/payables/payables.component').then(
            (c) => c.PayablesComponent,
          ),
      },
      {
        path: 'cartera-dashboard',
        loadComponent: () =>
          import('./components/cartera-dashboard/cartera-dashboard.component').then(
            (c) => c.CarteraDashboardComponent,
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
