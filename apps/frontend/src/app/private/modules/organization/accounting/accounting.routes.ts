import { Routes } from '@angular/router';

export const orgAccountingRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./accounting.component').then((c) => c.OrgAccountingComponent),
    children: [
      {
        path: '',
        redirectTo: 'chart-of-accounts',
        pathMatch: 'full',
      },
      {
        path: 'chart-of-accounts',
        loadComponent: () =>
          import('./pages/chart-of-accounts/chart-of-accounts.component').then(
            (c) => c.OrgChartOfAccountsComponent,
          ),
      },
      {
        path: 'journal-entries',
        loadComponent: () =>
          import('./pages/journal-entries/journal-entries.component').then(
            (c) => c.OrgJournalEntriesComponent,
          ),
      },
      {
        path: 'fiscal-periods',
        loadComponent: () =>
          import('./pages/fiscal-periods/fiscal-periods.component').then(
            (c) => c.OrgFiscalPeriodsComponent,
          ),
      },
      {
        path: 'account-mappings',
        loadComponent: () =>
          import('./pages/account-mappings/account-mappings.component').then(
            (c) => c.OrgAccountMappingsComponent,
          ),
      },
      {
        path: 'cartera',
        loadComponent: () =>
          import('./pages/cartera-dashboard/cartera-dashboard.component').then(
            (c) => c.OrgCarteraDashboardComponent,
          ),
      },
      {
        path: 'receivables',
        loadComponent: () =>
          import('./pages/receivables/receivables.component').then(
            (c) => c.OrgReceivablesComponent,
          ),
      },
      {
        path: 'payables',
        loadComponent: () =>
          import('./pages/payables/payables.component').then(
            (c) => c.OrgPayablesComponent,
          ),
      },
      {
        path: 'aging',
        loadComponent: () =>
          import('./pages/aging/aging.component').then(
            (c) => c.OrgAgingComponent,
          ),
      },
      {
        path: 'withholding-tax',
        loadComponent: () =>
          import('./fiscal/withholding-tax/withholding-tax.component').then(
            (c) => c.OrgWithholdingTaxComponent,
          ),
      },
      {
        path: 'exogenous',
        loadComponent: () =>
          import('./fiscal/exogenous/exogenous.component').then(
            (c) => c.OrgExogenousComponent,
          ),
      },
      {
        path: 'ica',
        loadComponent: () =>
          import('./fiscal/ica/ica.component').then((c) => c.OrgIcaComponent),
      },
    ],
  },
];
