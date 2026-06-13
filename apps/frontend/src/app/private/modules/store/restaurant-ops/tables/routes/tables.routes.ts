import { Routes } from '@angular/router';

/**
 * Store-admin Tables (Restaurant Suite — Phase E) routes.
 *
 * Mounted under `/admin/restaurant-ops/tables` from
 * `routes/private/store_admin.routes.ts`.
 *
 * Backend permission enforcement:
 *   - GET floor-map / list  → store:tables:read
 *   - POST open session     → store:table_sessions:create
 *   - POST add-items/close  → store:table_sessions:update
 *   - POST split            → store:table_sessions:update
 */
export const tablesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/tables-floor-page/tables-floor-page.component'
      ).then((c) => c.TablesFloorPageComponent),
    data: { permission: 'store:tables:read' },
  },
  {
    path: 'session/:id',
    loadComponent: () =>
      import(
        '../pages/table-session-page/table-session-page.component'
      ).then((c) => c.TableSessionPageComponent),
    data: { permission: 'store:table_sessions:read' },
  },
];
