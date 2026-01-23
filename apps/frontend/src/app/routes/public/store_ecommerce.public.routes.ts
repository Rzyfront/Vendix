import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

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
        path: 'products',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
      },
      {
        path: 'productos',
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
        path: 'products/:slug',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/product-detail/product-detail.component'
          ).then((c) => c.ProductDetailComponent),
      },
      {
        path: 'productos/:slug',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/product-detail/product-detail.component'
          ).then((c) => c.ProductDetailComponent),
      },
      {
        path: 'novedades',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
        data: {
          title: 'Novedades',
          defaultFilters: { sort_by: 'newest' },
        },
      },
      {
        path: 'new',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
        data: {
          title: 'Novedades',
          defaultFilters: { sort_by: 'newest' },
        },
      },
      {
        path: 'ofertas',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
        data: {
          title: 'Ofertas',
          defaultFilters: { has_discount: true, sort_by: 'price_asc' },
        },
      },
      {
        path: 'sale',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/catalog/catalog.component'
          ).then((c) => c.CatalogComponent),
        data: {
          title: 'Ofertas',
          defaultFilters: { has_discount: true, sort_by: 'price_asc' },
        },
      },
      {
        path: 'cart',
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/cart/cart.component'
          ).then((c) => c.CartComponent),
      },
      {
        path: 'checkout',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/checkout/checkout.component'
          ).then((c) => c.CheckoutComponent),
      },
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
    ],
  },
];
