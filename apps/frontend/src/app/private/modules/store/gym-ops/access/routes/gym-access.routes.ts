import { Routes } from '@angular/router';

/**
 * Gym Suite — Ola 1. Gym Access control routes.
 *
 * Mounted under `/admin/gym-ops/access` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `gym_ops_access`.
 *
 * Backend permission enforcement (store/gym/access):
 *   - GET /logs, GET /credentials → store:gym_access:read
 *   - POST /credentials           → store:gym_access:create
 *   - PATCH / DELETE /credentials → store:gym_access:update
 */
export const gymAccessRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/access-page/access-page.component').then(
        (c) => c.GymAccessPageComponent,
      ),
    data: { permission: 'store:gym_access:read' },
  },
];
