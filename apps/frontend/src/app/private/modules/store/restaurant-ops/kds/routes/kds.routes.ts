import { Routes } from '@angular/router';

/**
 * Store-admin KDS (Restaurant Suite — Phase F) routes.
 *
 * Mounted under `/admin/restaurant-ops/kds` from
 * `routes/private/store_admin.routes.ts` (wire-up done in this phase).
 *
 * Backend permission enforcement:
 *   - All KDS actions → store:kitchen_fire:read / :update
 */
export const kdsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        '../pages/kds-board-page/kds-board-page.component'
      ).then((c) => c.KdsBoardPageComponent),
    data: { permission: 'store:kitchen_fire:read' },
  },
  {
    // Configuración de estaciones y turnos. Permiso propio (`store:kds:read`) y
    // no el del fire: configurar estaciones es una acción distinta de cocinar.
    path: 'configuracion',
    loadComponent: () =>
      import(
        '../pages/kds-manage-page/kds-manage-page.component'
      ).then((c) => c.KdsManagePageComponent),
    data: { permission: 'store:kds:read' },
  },
];
