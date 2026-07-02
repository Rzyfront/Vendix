import { Routes } from '@angular/router';

/**
 * Membership Plans routes.
 *
 * Mounted under `/admin/memberships/plans` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `memberships_plans`.
 *
 * Backend permission enforcement (store/memberships/plans):
 *   - GET list/detail  → store:membership_plans:read
 *   - POST create      → store:membership_plans:create
 *   - PATCH update     → store:membership_plans:update
 *   - DELETE           → store:membership_plans:delete
 */
export const membershipPlansRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/plans-list-page/plans-list-page.component').then(
        (c) => c.MembershipPlansListPageComponent,
      ),
    data: { permission: 'store:membership_plans:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.MembershipPlanFormPageComponent,
      ),
    data: { permission: 'store:membership_plans:create' },
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('../pages/plan-form-page/plan-form-page.component').then(
        (c) => c.MembershipPlanFormPageComponent,
      ),
    data: { permission: 'store:membership_plans:update' },
  },
];
