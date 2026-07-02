import { Routes } from '@angular/router';

/**
 * Membership Plans routes.
 *
 * Mounted under `/admin/memberships/plans` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `memberships_plans`.
 *
 * Backend permission enforcement (store/memberships/plans):
 *   - GET list/detail  → store:gym_plans:read
 *   - POST create      → store:gym_plans:create
 *   - PATCH update     → store:gym_plans:update
 *   - DELETE           → store:gym_plans:delete
 */
export const membershipPlansRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/plans-list-page/plans-list-page.component').then(
        (c) => c.MembershipPlansListPageComponent,
      ),
    data: { permission: 'store:gym_plans:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.MembershipPlanFormPageComponent,
      ),
    data: { permission: 'store:gym_plans:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.MembershipPlanFormPageComponent,
      ),
    data: { permission: 'store:gym_plans:update' },
  },
];
