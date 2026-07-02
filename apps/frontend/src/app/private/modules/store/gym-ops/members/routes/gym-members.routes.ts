import { Routes } from '@angular/router';

/**
 * Gym Suite — Ola 1. Gym Members / Memberships routes.
 *
 * Mounted under `/admin/gym-ops/members` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `gym_ops_members`.
 *
 * Backend permission enforcement:
 *   - store/gym/memberships  → store:gym_memberships:read | create | update
 *   - store/gym/member-profiles → store:gym_memberships:read | update
 */
export const gymMembersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/members-list-page/members-list-page.component').then(
        (c) => c.GymMembersListPageComponent,
      ),
    data: { permission: 'store:gym_memberships:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/membership-form-page/membership-form-page.component'
      ).then((c) => c.GymMembershipFormPageComponent),
    data: { permission: 'store:gym_memberships:create' },
  },
  {
    // Member profile keyed by customerId (deep-link target from customers).
    // Declared before ':id' so the literal `profile` segment wins.
    path: 'profile/:customerId',
    loadComponent: () =>
      import('../pages/member-profile-page/member-profile-page.component').then(
        (c) => c.GymMemberProfilePageComponent,
      ),
    data: { permission: 'store:gym_memberships:read' },
  },
  {
    path: ':id',
    loadComponent: () =>
      import(
        '../pages/membership-detail-page/membership-detail-page.component'
      ).then((c) => c.GymMembershipDetailPageComponent),
    data: { permission: 'store:gym_memberships:read' },
  },
];
