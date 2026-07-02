import { Routes } from '@angular/router';

/**
 * Membership Suite. Members / Memberships routes.
 *
 * Mounted under `/admin/memberships/members` from
 * `routes/private/store_admin.routes.ts`. Panel_ui key: `memberships_members`.
 *
 * Backend permission enforcement:
 *   - store/memberships          → store:memberships:read | create | update
 *   - store/memberships/member-profiles → store:memberships:read | update
 */
export const membershipMembersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('../pages/members-list-page/members-list-page.component').then(
        (c) => c.MembershipMembersListPageComponent,
      ),
    data: { permission: 'store:memberships:read' },
  },
  {
    path: 'new',
    loadComponent: () =>
      import(
        '../pages/membership-form-page/membership-form-page.component'
      ).then((c) => c.MembershipFormPageComponent),
    data: { permission: 'store:memberships:create' },
  },
  {
    // Member profile keyed by customerId (deep-link target from customers).
    // Declared before ':id' so the literal `profile` segment wins.
    path: 'profile/:customerId',
    loadComponent: () =>
      import('../pages/member-profile-page/member-profile-page.component').then(
        (c) => c.MembershipMemberProfilePageComponent,
      ),
    data: { permission: 'store:memberships:read' },
  },
  {
    path: ':id',
    loadComponent: () =>
      import(
        '../pages/membership-detail-page/membership-detail-page.component'
      ).then((c) => c.MembershipDetailPageComponent),
    data: { permission: 'store:memberships:read' },
  },
];
