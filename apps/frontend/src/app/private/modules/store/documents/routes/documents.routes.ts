import { Routes } from '@angular/router';

/**
 * Documents routes (expedientes). Mounted under `/admin/documents` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `documents`
 * (industry `administration`, always enforced).
 *
 * Backend permission: `store:documents:read` on `store/documents/dossiers`.
 */
export const documentsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/documents-page/documents-page.component').then(
        (c) => c.DocumentsPageComponent,
      ),
    data: { permission: 'store:documents:read' },
  },
];
