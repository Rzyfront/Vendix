import { Routes } from '@angular/router';

/**
 * Store-admin PQR routes. Loaded lazily from `store_admin.routes.ts` at
 * `path: 'admin/pqrs'`. Uses the shared store-admin layout (sidebar +
 * header) defined by the parent route, so we only declare page children.
 */
export const pqrRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/pqr-list-page/pqr-list-page.component').then(
        (m) => m.PqrListPageComponent,
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./pages/pqr-detail-page/pqr-detail-page.component').then(
        (m) => m.PqrDetailPageComponent,
      ),
  },
];