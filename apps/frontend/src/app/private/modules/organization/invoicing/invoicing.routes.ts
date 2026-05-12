import { Routes } from '@angular/router';

export const orgInvoicingRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./invoicing.component').then((c) => c.OrgInvoicingComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'invoices',
      },
      {
        path: 'invoices',
        loadComponent: () =>
          import('./pages/invoices/org-invoice-list.component').then(
            (c) => c.OrgInvoiceListComponent,
          ),
      },
      {
        path: 'resolutions',
        loadComponent: () =>
          import('./pages/resolutions/org-invoice-resolutions.component').then(
            (c) => c.OrgInvoiceResolutionsComponent,
          ),
      },
      {
        path: 'dian-config',
        loadComponent: () =>
          import('./pages/dian-config/org-dian-config.component').then(
            (c) => c.OrgDianConfigComponent,
          ),
      },
    ],
  },
];
