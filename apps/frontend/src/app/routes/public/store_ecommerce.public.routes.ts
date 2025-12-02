import { Routes } from '@angular/router';

export const storeEcommercePublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../public/ecommerce/components/storefront/storefront.component'
      ).then((c) => c.StorefrontComponent),
  },
];
