import type { RouteConfig } from '../core/services/app-config.service';

export const storeAdminRoutes: RouteConfig[] = [
  {
    path: 'admin',
    component: 'StoreAdminDashboardComponent',
    layout: 'store-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'admin/products',
    component: 'ProductManagementComponent',
    layout: 'store-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'admin/orders',
    component: 'OrderManagementComponent',
    layout: 'store-admin',
    guards: ['AuthGuard']
  },
  {
    path: 'pos',
    component: 'POSComponent',
    layout: 'pos',
    guards: ['AuthGuard']
  }
];
