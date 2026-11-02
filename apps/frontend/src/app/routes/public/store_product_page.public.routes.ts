import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';
import { mesaCartGuard } from '../../core/guards/mesa-cart.guard';

/**
 * STORE_PRODUCT_PAGE public routes: a single-product storefront on its own
 * domain. It composes the ecommerce layout, product detail, cart and checkout
 * exactly as they are (no ecommerce file is modified), so cart, taxes,
 * shipping and payment rules stay in one place. The paths mirror the ones the
 * ecommerce components navigate to (`/cart`, `/checkout`, `/products/:id`,
 * `/pedido/:token`), which is what lets them run unchanged on this domain.
 */
const layout = () =>
  import('../../private/layouts/store-ecommerce/store-ecommerce-layout.component').then(
    (c) => c.StoreEcommerceLayoutComponent,
  );
const productDetail = () =>
  import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
    (c) => c.ProductDetailComponent,
  );
const guestOrderSummary = () =>
  import(
    '../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component'
  ).then((c) => c.GuestOrderSummaryComponent);

export const storeProductPagePublicRoutes: Routes = [
  {
    path: '',
    loadComponent: layout,
    children: [
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
