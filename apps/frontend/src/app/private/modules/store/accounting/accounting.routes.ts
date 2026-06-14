import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { accountingReducer } from './state/reducers/accounting.reducer';
import { AccountingEffects } from './state/effects/accounting.effects';
import type { AccountingSubTab } from './components/sub-tabs-shell/sub-tabs-shell.component';

const CONFIGURATION_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'mappings',
    label: 'Mapeos',
    icon: 'arrow-left-right',
    route: '/admin/accounting/configuration/mappings',
  },
  {
    id: 'flows',
    label: 'Flujos',
    icon: 'activity',
    route: '/admin/accounting/configuration/flows',
  },
];

const CARTERA_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'layout-dashboard',
    route: '/admin/accounting/cartera/dashboard',
  },
  {
    id: 'receivables',
    label: 'CxC',
    icon: 'arrow-down-circle',
    route: '/admin/accounting/cartera/receivables',
  },
  {
    id: 'payables',
    label: 'CxP',
    icon: 'arrow-up-circle',
    route: '/admin/accounting/cartera/payables',
  },
  {
    id: 'aging',
    label: 'Vencimientos',
    icon: 'clock',
    route: '/admin/accounting/cartera/aging',
  },
];

const TAXES_SUB_TABS: AccountingSubTab[] = [
  {
    id: 'withholding',
    label: 'Retenciones',
    icon: 'percent',
    route: '/admin/accounting/taxes/withholding',
  },
  {
    id: 'exogenous',
    label: 'Exógena',
    icon: 'file-spreadsheet',
    route: '/admin/accounting/taxes/exogenous',
  },
  {
    id: 'ica',
    label: 'Tarifas ICA',
    icon: 'landmark',
    route: '/admin/accounting/taxes/ica',
  },
];

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
      // Configuración — super-tab grouping account mappings + accounting flows.
      {
        path: 'configuration',
        loadComponent: () =>
          import('./components/sub-tabs-shell/sub-tabs-shell.component').then(
            (c) => c.AccountingSubTabsShellComponent,
          ),
        data: {
          subTabs: CONFIGURATION_SUB_TABS,
          subTabsAriaLabel: 'Configuración contable',
        },
        children: [
          {
            path: '',
            redirectTo: 'mappings',
            pathMatch: 'full',
          },
          {
            path: 'mappings',
            loadComponent: () =>
              import('./components/account-mappings/account-mappings.component').then(
                (c) => c.AccountMappingsComponent,
              ),
          },
          {
            path: 'flows',
            loadComponent: () =>
              import('./components/accounting-flows/accounting-flows.component').then(
                (c) => c.AccountingFlowsComponent,
              ),
          },
        ],
      },
      // Cartera — super-tab grouping dashboard + CxC + CxP + aging.
      {
        path: 'cartera',
        loadComponent: () =>
          import('./components/sub-tabs-shell/sub-tabs-shell.component').then(
            (c) => c.AccountingSubTabsShellComponent,
          ),
        data: {
          subTabs: CARTERA_SUB_TABS,
          subTabsAriaLabel: 'Gestión de cartera',
        },
        children: [
          {
            path: '',
            redirectTo: 'dashboard',
            pathMatch: 'full',
          },
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./components/cartera-dashboard/cartera-dashboard.component').then(
                (c) => c.CarteraDashboardComponent,
              ),
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
            path: 'aging',
            loadComponent: () =>
              import('./components/aging-report/aging-report.component').then(
                (c) => c.AgingReportComponent,
              ),
          },
        ],
      },
      // Impuestos — super-tab mounting the lazy tax sub-modules
      // (retenciones / exógena / tarifas ICA) without rewriting them.
      {
        path: 'taxes',
        loadComponent: () =>
          import('./components/sub-tabs-shell/sub-tabs-shell.component').then(
            (c) => c.AccountingSubTabsShellComponent,
          ),
        data: {
          subTabs: TAXES_SUB_TABS,
          subTabsAriaLabel: 'Gestión de impuestos',
        },
        children: [
          {
            path: '',
            redirectTo: 'withholding',
            pathMatch: 'full',
          },
          {
            path: 'withholding',
            loadChildren: () =>
              import('../withholding-tax/withholding-tax.routes').then(
                (m) => m.withholdingTaxRoutes,
              ),
          },
          {
            path: 'exogenous',
            loadChildren: () =>
              import('../exogenous/exogenous.routes').then(
                (m) => m.exogenousRoutes,
              ),
          },
          {
            path: 'ica',
            loadChildren: () =>
              import('../taxes/ica/ica.routes').then((m) => m.icaRoutes),
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
        path: 'fixed-assets',
        loadComponent: () =>
          import('./components/fixed-assets/fixed-assets.component').then(
            (c) => c.FixedAssetsComponent,
          ),
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
      // ── Legacy redirects ─────────────────────────────────────────────
      // Old flat tab routes were regrouped under the configuration /
      // cartera / taxes super-tabs. Keep redirects so bookmarks, sidebar
      // entries and deep links keep working.
      {
        path: 'account-mappings',
        redirectTo: 'configuration/mappings',
        pathMatch: 'full',
      },
      {
        path: 'flows',
        redirectTo: 'configuration/flows',
        pathMatch: 'full',
      },
      {
        path: 'receivables',
        redirectTo: 'cartera/receivables',
        pathMatch: 'full',
      },
      {
        path: 'payables',
        redirectTo: 'cartera/payables',
        pathMatch: 'full',
      },
      {
        path: 'aging',
        redirectTo: 'cartera/aging',
        pathMatch: 'full',
      },
      {
        path: 'withholding-tax',
        redirectTo: 'taxes/withholding',
        pathMatch: 'full',
      },
      {
        path: 'exogenous',
        redirectTo: 'taxes/exogenous',
        pathMatch: 'full',
      },
      {
        path: 'ica',
        redirectTo: 'taxes/ica',
        pathMatch: 'full',
      },
    ],
  },
];
