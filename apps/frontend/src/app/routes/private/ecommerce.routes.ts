import { Routes } from '@angular/router';

export const ecommerceRoutes: Routes = [
  // Esta sección es para clientes autenticados en un entorno de e-commerce.
  // Las rutas públicas de la tienda están en 'store_ecommerce.public.routes.ts'
  {
    path: 'account',
    // loadComponent: () => import('../../private/modules/customer/account/account.component').then(c => c.AccountComponent)
  },
  {
    path: 'orders',
    // loadComponent: () => import('../../private/modules/customer/orders/orders.component').then(c => c.OrdersComponent)
  },
];
