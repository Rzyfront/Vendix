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
      import('../../private/layouts/store-ecommerce/store-ecommerce-layout.component').then(
        (c) => c.StoreEcommerceLayoutComponent,
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/home/home.component').then(
            (c) => c.HomeComponent,
          ),
      },
      {
        path: 'catalog',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
      },
      {
        path: 'products',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
      },
      {
        path: 'productos',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
      },
      {
        path: 'catalog/:slug',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
            (c) => c.ProductDetailComponent,
          ),
      },
      {
        path: 'products/:slug',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
            (c) => c.ProductDetailComponent,
          ),
      },
      {
        path: 'productos/:slug',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
            (c) => c.ProductDetailComponent,
          ),
      },
      {
        path: 'novedades',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
        data: {
          title: 'Novedades',
          defaultFilters: { sort_by: 'newest' },
        },
      },
      {
        path: 'new',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
        data: {
          title: 'Novedades',
          defaultFilters: { sort_by: 'newest' },
        },
      },
      {
        path: 'ofertas',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
        data: {
          title: 'Ofertas',
          defaultFilters: { has_discount: true, sort_by: 'price_asc' },
        },
      },
      {
        path: 'sale',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/catalog/catalog.component').then(
            (c) => c.CatalogComponent,
          ),
        data: {
          title: 'Ofertas',
          defaultFilters: { has_discount: true, sort_by: 'price_asc' },
        },
      },
      {
        path: 'cart',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/cart/cart.component').then(
            (c) => c.CartComponent,
          ),
      },
      {
        path: 'wishlist',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/wishlist/wishlist.component').then(
            (c) => c.WishlistComponent,
          ),
      },
      {
        path: 'checkout',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/checkout/checkout.component').then(
            (c) => c.CheckoutComponent,
          ),
      },
      {
        path: 'account',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/account/account.component').then(
            (c) => c.AccountComponent,
          ),
      },
      {
        path: 'account/orders',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/account/orders/orders.component').then(
            (c) => c.OrdersComponent,
          ),
      },
      {
        path: 'pedido/:token',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component').then(
            (c) => c.GuestOrderSummaryComponent,
          ),
      },
      {
        path: 'order/:token',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component').then(
            (c) => c.GuestOrderSummaryComponent,
          ),
      },
      {
        path: 'account/orders/:id',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/account/order-detail/order-detail.component').then(
            (c) => c.OrderDetailComponent,
          ),
      },
      {
        path: 'book/:productId',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/booking/booking.component').then(
            (c) => c.BookingComponent,
          ),
      },
      {
        path: 'fila',
        loadComponent: () =>
          import('../../public/ecommerce/pages/queue-register/queue-register.component').then(
            (c) => c.QueueRegisterComponent,
          ),
      },
      {
        path: 'factura/:token',
        loadComponent: () =>
          import('../../public/ecommerce/pages/invoice-data/invoice-data.component').then(
            (c) => c.InvoiceDataComponent,
          ),
      },
      {
        path: 'preconsulta/:token',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/data-collection-form/data-collection-form.component').then(
            (c) => c.DataCollectionFormComponent,
          ),
      },
      {
        path: 'account/reservations',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/my-reservations/my-reservations.component').then(
            (c) => c.MyReservationsComponent,
          ),
      },
    ],
  },
];
