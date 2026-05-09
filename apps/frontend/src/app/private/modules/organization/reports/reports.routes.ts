import { Routes } from '@angular/router';

export const orgReportsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./reports.component').then((c) => c.OrgReportsComponent),
    children: [
      { path: '', redirectTo: 'sales', pathMatch: 'full' },
      {
        path: 'sales',
        loadComponent: () =>
          import('./pages/sales/sales.component').then(
            (c) => c.OrgSalesReportComponent,
          ),
      },
      {
        path: 'inventory',
        loadComponent: () =>
          import('./pages/inventory/inventory.component').then(
            (c) => c.OrgInventoryReportComponent,
          ),
      },
      {
        path: 'financial',
        loadComponent: () =>
          import('./pages/financial/financial.component').then(
            (c) => c.OrgFinancialReportComponent,
          ),
      },
    ],
  },
];
