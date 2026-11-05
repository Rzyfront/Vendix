import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { mesaCartGuard } from '../../core/guards/mesa-cart.guard';

/**
 * STORE_SERVICE_PAGE public routes (Apps · Fase 3): the store's services and
 * booking on their own domain, with a secondary product block.
 *
 * Same pattern as the product page: the service list is new, everything else
 * is the ecommerce as it is (no ecommerce file is modified). Service detail,
 * booking (`/book/:productId`: day, slot, hold), cart, checkout and the
 * customer's reservations are the ecommerce components; the paths mirror the
 * ones they navigate to, which is what lets them run unchanged here.
 */
const layout = () =>
  import('../../public/service-page/service-page-layout.component').then(
    (c) => c.ServicePageLayoutComponent,
  );
const productDetail = () =>
  import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
    (c) => c.ProductDetailComponent,
  );
const guestOrderSummary = () =>
  import(
    '../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component'
  ).then((c) => c.GuestOrderSummaryComponent);

export const storeServicePagePublicRoutes: Routes = [
  {
    path: 'pagar/:token',
    loadComponent: () =>
      import('../../public/payment-request/payment-request-page.component').then(
        (c) => c.PaymentRequestPageComponent,
      ),
  },
  {
    path: '',
    loadComponent: layout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('../../public/service-page/service-page-home.component').then(
            (c) => c.ServicePageHomeComponent,
          ),
      },
      // The detail's "back to catalog" link lands on the service list.
      { path: 'catalog', pathMatch: 'full', redirectTo: '' },
      { path: 'producto/:slug', loadComponent: productDetail },
      { path: 'products/:slug', loadComponent: productDetail },
      { path: 'catalog/:slug', loadComponent: productDetail },
      {
        path: 'book/:productId',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/booking/booking.component').then(
            (c) => c.BookingComponent,
          ),
      },
      {
        path: 'cart',
        canActivate: [mesaCartGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/cart/cart.component').then(
            (c) => c.CartComponent,
          ),
      },
      {
        path: 'checkout',
        canActivate: [mesaCartGuard],
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/checkout/checkout.component').then(
            (c) => c.CheckoutComponent,
          ),
      },
      { path: 'pedido/:token', loadComponent: guestOrderSummary },
      { path: 'order/:token', loadComponent: guestOrderSummary },
      {
        path: 'account/orders/:id',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/account/order-detail/order-detail.component'
          ).then((c) => c.OrderDetailComponent),
      },
      {
        path: 'account/reservations',
        canActivate: [AuthGuard],
        loadComponent: () =>
          import(
            '../../private/modules/ecommerce/pages/my-reservations/my-reservations.component'
          ).then((c) => c.MyReservationsComponent),
      },
    ],
  },
];
