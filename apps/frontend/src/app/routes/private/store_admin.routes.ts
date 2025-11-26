import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const storeAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () =>
      import(
        '../../private/layouts/store-admin/store-admin-layout.component'
      ).then((c) => c.StoreAdminLayoutComponent),
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            '../../private/modules/store/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      // Products Routes
      {
        path: 'products',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/products/components/product-management.component'
              ).then((c) => c.ProductManagementComponent),
          },
          {
            path: 'create',
            loadComponent: () =>
              import(
                '../../private/modules/store/products/pages/product-create-page.component'
              ).then((c) => c.ProductCreatePageComponent),
          },
          {
            path: ':id',
            loadComponent: () =>
              import(
                '../../private/modules/store/products/components/product-details/product-details.component'
              ).then((c) => c.ProductDetailsComponent),
          },
        ],
      },
      // Orders Routes
      {
        path: 'orders',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/orders.component'
              ).then((c) => c.OrdersComponent),
          },
          {
            path: 'list',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/list/orders-list.component'
              ).then((c) => c.OrdersListComponent),
          },
          {
            path: ':id',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/details/order-details.component'
              ).then((c) => c.OrderDetailsComponent),
          },
          {
            path: 'sales-orders',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/sales-orders/sales-orders.component'
              ).then((c) => c.SalesOrdersComponent),
          },
          {
            path: 'purchase-orders',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/purchase-orders/purchase-orders.component'
              ).then((c) => c.PurchaseOrdersComponent),
          },
          {
            path: 'stock-transfers',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/stock-transfers/stock-transfers.component'
              ).then((c) => c.StockTransfersComponent),
          },
        ],
      },
      // Customers Routes
      {
        path: 'customers',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/customers/customers.component'
              ).then((c) => c.CustomersComponent),
          },
          {
            path: 'all',
            loadComponent: () =>
              import(
                '../../private/modules/store/customers/all/all-customers.component'
              ).then((c) => c.AllCustomersComponent),
          },
          {
            path: ':id',
            loadComponent: () =>
              import(
                '../../private/modules/store/customers/details/customer-details.component'
              ).then((c) => c.CustomerDetailsComponent),
          },
          {
            path: 'reviews',
            loadComponent: () =>
              import(
                '../../private/modules/store/customers/reviews/reviews.component'
              ).then((c) => c.ReviewsComponent),
          },
        ],
      },
      // Marketing Routes
      {
        path: 'marketing',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/marketing/marketing.component'
              ).then((c) => c.MarketingComponent),
          },
          {
            path: 'promotions',
            loadComponent: () =>
              import(
                '../../private/modules/store/marketing/promotions/promotions.component'
              ).then((c) => c.PromotionsComponent),
          },
          {
            path: 'coupons',
            loadComponent: () =>
              import(
                '../../private/modules/store/marketing/coupons/coupons.component'
              ).then((c) => c.CouponsComponent),
          },
        ],
      },
      // Analytics Routes
      {
        path: 'analytics',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/analytics/analytics.component'
              ).then((c) => c.AnalyticsComponent),
          },
          {
            path: 'sales',
            loadComponent: () =>
              import(
                '../../private/modules/store/analytics/sales/sales-analytics.component'
              ).then((c) => c.SalesAnalyticsComponent),
          },
          {
            path: 'traffic',
            loadComponent: () =>
              import(
                '../../private/modules/store/analytics/traffic/traffic-analytics.component'
              ).then((c) => c.TrafficAnalyticsComponent),
          },
          {
            path: 'performance',
            loadComponent: () =>
              import(
                '../../private/modules/store/analytics/performance/performance-analytics.component'
              ).then((c) => c.PerformanceAnalyticsComponent),
          },
        ],
      },
      // Settings Routes
      {
        path: 'settings',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/settings.component'
              ).then((c) => c.SettingsComponent),
          },
          {
            path: 'general',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/general/general-settings.component'
              ).then((c) => c.GeneralSettingsComponent),
          },
          {
            path: 'appearance',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/appearance/appearance-settings.component'
              ).then((c) => c.AppearanceSettingsComponent),
          },
          {
            path: 'security',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/security/security-settings.component'
              ).then((c) => c.SecuritySettingsComponent),
          },
          {
            path: 'payments',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/payments/payments-settings.component'
              ).then((c) => c.PaymentsSettingsComponent),
          },
        ],
      },
      // POS Routes
      {
        path: 'pos',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('../../private/modules/store/pos/pos.component').then(
                (c) => c.PosComponent,
              ),
          },
          {
            path: 'register',
            loadComponent: () =>
              import(
                '../../private/modules/store/pos/register/pos-register.component'
              ).then((c) => c.PosRegisterComponent),
          },
          {
            path: 'cart',
            loadComponent: () =>
              import(
                '../../private/modules/store/pos/cart/pos-cart.component'
              ).then((c) => c.PosCartComponent),
          },
          {
            path: 'payment',
            loadComponent: () =>
              import(
                '../../private/modules/store/pos/payment/pos-payment.component'
              ).then((c) => c.PosPaymentComponent),
          },
        ],
      },
    ],
  },
];
