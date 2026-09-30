import { Routes } from '@angular/router';

export const orgInvoicingRoutes: Routes = [
  {
    // Full-page detail owns its header, so keep it outside the legacy wrapper.
    path: 'received-documents/:id',
    data: { receivedDocumentsScope: 'organization' },
    loadComponent: () =>
      import('../../store/invoicing/received-documents/received-document-detail.component').then(
        (m) => m.ReceivedDocumentDetailComponent,
      ),
  },
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
        path: 'received-documents',
        data: { receivedDocumentsScope: 'organization' },
        loadComponent: () =>
          import('../../store/invoicing/received-documents/received-documents-page.component').then(
            (m) => m.ReceivedDocumentsPageComponent,
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
