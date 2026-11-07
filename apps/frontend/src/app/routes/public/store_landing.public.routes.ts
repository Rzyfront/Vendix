import { inject } from '@angular/core';
import { CanMatchFn, Routes } from '@angular/router';
import { map } from 'rxjs/operators';
import { pricingRoutes } from '../../public/pricing/pricing.routes';
import { AuthGuard } from '../../core/guards/auth.guard';
import { mesaCartGuard } from '../../core/guards/mesa-cart.guard';
import { LandingPageService } from '../../public/landing-page/landing-page.service';

/**
 * Purchase pages of the landing on its own domain (Apps · landing page, Fase 6):
 * the offer product, cart and checkout are the ecommerce pages unchanged, the
 * same composition the product page domain uses. They only add paths the
 * landing never had, so `/` and the station pages stay as they are.
 */
/** Only on the landing's own domain; `{tienda}-store` keeps no purchase pages. */
const ownLandingDomain: CanMatchFn = () =>
    inject(LandingPageService)
        .load()
        .pipe(map((page) => page !== null));
const productDetail = () =>
    import('../../private/modules/ecommerce/pages/product-detail/product-detail.component').then(
        (c) => c.ProductDetailComponent,
    );
const guestOrderSummary = () =>
    import(
        '../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component'
    ).then((c) => c.GuestOrderSummaryComponent);

export const storeLandingPublicRoutes: Routes = [
    {
        path: '',
        loadComponent: () =>
            import(
                '../../public/dynamic-landing/components/store-landing/store-landing.component'
            ).then((c) => c.StoreLandingComponent),
    },
    // Estaciones de servicio: el enlace de seguimiento y el QR de la estación deben
    // abrir también en tiendas que solo tienen landing (sin tienda en línea).
    {
        path: 'pagar/:token',
        loadComponent: () =>
            import('../../public/payment-request/payment-request-page.component').then(
                (c) => c.PaymentRequestPageComponent,
            ),
    },
    {
        path: 'estacion/:publicId',
        loadComponent: () =>
            import('../../public/ecommerce/pages/service-station-status/service-station-status.component').then(
                (c) => c.ServiceStationStatusComponent,
            ),
    },
    {
        path: 'seguimiento-servicio/:token',
        loadComponent: () =>
            import('../../public/ecommerce/pages/service-session-progress/service-session-progress.component').then(
                (c) => c.ServiceSessionProgressComponent,
            ),
    },
    {
        // Flujos: public request form by link (no login; store from the domain).
        path: 'flujos/:token',
        loadComponent: () =>
          import('../../public/ecommerce/pages/workflow-public-form/workflow-public-form.component').then(
            (c) => c.WorkflowPublicFormComponent,
          ),
    },
    ...pricingRoutes,
    {
        path: '',
        canMatch: [ownLandingDomain],
        loadComponent: () =>
            import('../../public/landing-page/landing-shop-layout.component').then(
                (c) => c.LandingShopLayoutComponent,
            ),
        children: [
            // The detail's "back to catalog" link lands on the landing.
            { path: 'catalog', pathMatch: 'full', redirectTo: '/' },
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
