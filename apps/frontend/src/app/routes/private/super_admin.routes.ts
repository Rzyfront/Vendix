import type { RouteConfig } from '../../core/services/app-config.service';

export const superAdminRoutes: RouteConfig[] = [
  {
    path: 'superadmin',
    component: 'SuperAdminDashboardComponent',
    layout: 'super-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'superadmin/tenants',
    component: 'TenantListComponent',
    layout: 'super-admin',
    guards: ['AuthGuard']
  }
];
