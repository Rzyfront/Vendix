import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { mesaCartGuard } from '../../core/guards/mesa-cart.guard';

/**
 * STORE_BOOKING public routes (Apps · Fase 4): the hotel's booking and
 * online check-in on their own domain, with a secondary amenities block.
 *
 * Same pattern as the service page: the home and the reservation wrapper are
 * new, everything else is the ecommerce as it is (no ecommerce file is
 * modified). The PMS booking engine screens (search, reservation status,
 * online check-in, stay rating), product detail, cart and checkout are the
 * ecommerce components; the paths mirror the ones they navigate to — the
 * payment returns to `/hotel/reserva/:id`, the status links to `/hotel` —
 * which is what lets them run unchanged here.
 */
const layout = () =>
  import('../../public/booking-page/booking-page-layout.component').then(
    (c) => c.BookingPageLayoutComponent,
  );
const productDetail = () =>
  import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
    (c) => c.ProductDetailComponent,
  );
const guestOrderSummary = () =>
  import(
    '../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component'
  ).then((c) => c.GuestOrderSummaryComponent);

export const storeBookingPublicRoutes: Routes = [
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
          import('../../public/booking-page/booking-page-home.component').then(
            (c) => c.BookingPageHomeComponent,
          ),
      },
      // "Buscar otra habitación" of the status page, and old storefront links.
      { path: 'hotel', pathMatch: 'full', redirectTo: '' },
      {
        path: 'hotel/reserva/:id',
        loadComponent: () =>
          import('../../public/booking-page/booking-reservation-page.component').then(
            (c) => c.BookingReservationPageComponent,
          ),
      },
      {
        // H8.1 — PMS online check-in (token link, no login).
        path: 'pre-registro/:token',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/hotel-booking/hotel-precheckin.component').then(
            (c) => c.HotelPrecheckinComponent,
          ),
      },
      {
        // H8.5 — PMS stay rating (token link, no login).
        path: 'calificar-estadia/:token',
        loadComponent: () =>
          import('../../private/modules/ecommerce/pages/hotel-booking/hotel-stay-review.component').then(
            (c) => c.HotelStayReviewComponent,
          ),
      },
      // The detail's "back to catalog" link lands on the booking home.
      { path: 'catalog', pathMatch: 'full', redirectTo: '' },
      { path: 'producto/:slug', loadComponent: productDetail },
      { path: 'products/:slug', loadComponent: productDetail },
      { path: 'catalog/:slug', loadComponent: productDetail },
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
    ],
  },
];
