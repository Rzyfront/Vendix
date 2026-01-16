import { Routes } from '@angular/router';

/**
 * E-commerce public routes - accessible without authentication.
 * Uses the store-ecommerce layout as the parent component.
 */
export const storeEcommercePublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        '../../private/layouts/store-ecommerce/store-ecommerce-layout.component'
      ).then((c) => c.StoreEcommerceLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/home/home.component'
          ).then((c) => c.HomeComponent),
      },
      {
        path: 'catalog',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
      },
      {
        path: 'catalog/:slug',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/product-detail/product-detail.component'
          ).then((c) => c.ProductDetailComponent),
      },
      {
        path: 'cart',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/cart/cart.component'
          ).then((c) => c.CartComponent),
      },
    ],
  },
];
