import { Routes } from '@angular/router';

/**
 * Gym Suite — Ola 1. Gym Plans routes.
 *
 * Mounted under `/admin/gym-ops/plans` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `gym_ops_plans`.
 *
 * Backend permission enforcement (store/gym/plans):
 *   - GET list/detail  → store:gym_plans:read
 *   - POST create      → store:gym_plans:create
 *   - PATCH update     → store:gym_plans:update
 *   - DELETE           → store:gym_plans:delete
 */
export const gymPlansRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/plans-list-page/plans-list-page.component').then(
        (c) => c.GymPlansListPageComponent,
      ),
    data: { permission: 'store:gym_plans:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.GymPlanFormPageComponent,
      ),
    data: { permission: 'store:gym_plans:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.GymPlanFormPageComponent,
      ),
    data: { permission: 'store:gym_plans:update' },
  },
];
