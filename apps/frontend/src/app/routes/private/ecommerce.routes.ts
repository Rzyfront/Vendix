import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

/**
 * E-commerce private routes for authenticated customers.
 * These routes are loaded when environment is STORE_ECOMMERCE.
 */
export const ecommerceRoutes: Routes = [
  {
    path: 'account',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import(
        '../../private/modules/ecommerce/pages/account/account.component'
      ).then((c) => c.AccountComponent),
  },
  {
    path: 'account/orders',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import(
        '../../private/modules/ecommerce/pages/account/orders/orders.component'
      ).then((c) => c.OrdersComponent),
  },
  {
    path: 'account/orders/:id',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import(
        '../../private/modules/ecommerce/pages/account/order-detail/order-detail.component'
      ).then((c) => c.OrderDetailComponent),
  },
  {
    path: 'checkout',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import(
        '../../private/modules/ecommerce/pages/checkout/checkout.component'
      ).then((c) => c.CheckoutComponent),
  },
];
