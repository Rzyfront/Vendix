import type { RouteConfig } from '../../core/services/app-config.service';

export const ecommerceRoutes: RouteConfig[] = [
  {
    path: 'account',
    component: 'CustomerAccountComponent',
    layout: 'store-ecommerce',
    guards: ['AuthGuard']
  },
  {
    path: 'orders',
    component: 'CustomerOrdersComponent',
    layout: 'store-ecommerce',
    guards: ['AuthGuard']
  }
];
