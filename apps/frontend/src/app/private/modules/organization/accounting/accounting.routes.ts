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
    ],
  },
];
