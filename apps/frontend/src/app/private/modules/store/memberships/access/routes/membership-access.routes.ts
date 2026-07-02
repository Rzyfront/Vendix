import { Routes } from '@angular/router';

/**
 * Membership Suite — Ola 1. Membership access control routes.
 *
 * Mounted under `/admin/memberships/access` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `memberships_access`.
 *
 * Backend permission enforcement (store/memberships/access):
 *   - GET /logs, GET /credentials → store:gym_access:read
 *   - POST /credentials           → store:gym_access:create
 *   - PATCH / DELETE /credentials → store:gym_access:update
 */
export const membershipAccessRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/access-page/access-page.component').then(
        (c) => c.MembershipAccessPageComponent,
      ),
    data: { permission: 'store:gym_access:read' },
  },
];
