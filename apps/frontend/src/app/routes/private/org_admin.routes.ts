import type { RouteConfig } from '../../core/services/app-config.service';

export const orgAdminRoutes: RouteConfig[] = [
  {
    path: 'admin',
    component: 'OrgAdminDashboardComponent',
    layout: 'organization-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'admin/stores',
    component: 'StoreManagementComponent',
    layout: 'organization-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'admin/users',
    component: 'UserManagementComponent',
    layout: 'organization-admin',
    guards: ['AuthGuard']
  }
];
