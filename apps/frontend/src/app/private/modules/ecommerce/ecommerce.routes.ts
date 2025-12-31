import { Routes } from '@angular/router';
import { StoreEcommerceLayoutComponent } from '../../layouts/store-ecommerce/store-ecommerce-layout.component';

export const ECOMMERCE_ROUTES: Routes = [
    {
        path: '',
        component: StoreEcommerceLayoutComponent,
        children: [
            {
                path: '',
                loadComponent: () =>
                    import('./pages/home/home.component').then((m) => m.HomeComponent),
            },
            {
                path: 'catalog',
                loadComponent: () =>
                    import('./pages/catalog/catalog.component').then((m) => m.CatalogComponent),
            },
            {
                path: 'catalog/:slug',
                loadComponent: () =>
                    import('./pages/product-detail/product-detail.component').then(
                        (m) => m.ProductDetailComponent,
                    ),
            },
            {
                path: 'cart',
                loadComponent: () =>
                    import('./pages/cart/cart.component').then((m) => m.CartComponent),
            },
            {
                path: 'checkout',
                loadComponent: () =>
                    import('./pages/checkout/checkout.component').then((m) => m.CheckoutComponent),
            },
            {
                path: 'account',
                loadComponent: () =>
                    import('./pages/account/account.component').then((m) => m.AccountComponent),
            },
            {
                path: 'account/orders',
                loadComponent: () =>
                    import('./pages/account/orders/orders.component').then((m) => m.OrdersComponent),
            },
            {
                path: 'account/orders/:id',
                loadComponent: () =>
                    import('./pages/account/order-detail/order-detail.component').then(
                        (m) => m.OrderDetailComponent,
                    ),
            },
        ],
    },
];
