import { Routes } from '@angular/router';

/**
 * STORE_HOME public routes (Apps · Fase 5): the entry page of the store's
 * `{tienda}-store` domain once the owner publishes the store home. Only `/`;
 * `/auth/login` is the shared static auth route, unchanged.
 */
export const storeHomePublicRoutes: Routes = [
  {
    path: 'pagar/:token',
    loadComponent: () =>
      import('../../public/payment-request/payment-request-page.component').then(
        (c) => c.PaymentRequestPageComponent,
      ),
  },
  {
    path: '',
    loadComponent: () =>
      import('../../public/store-home/store-home.component').then(
        (c) => c.StoreHomeComponent,
      ),
  },
];
