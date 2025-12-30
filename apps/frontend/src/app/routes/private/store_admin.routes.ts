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
      // POS Routes
      {
        path: 'pos',
        loadComponent: () =>
          import('../../private/modules/store/pos/pos.component').then(
            (c) => c.PosComponent,
          ),
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
                '../../private/modules/store/products/products.component'
              ).then((c) => c.ProductsComponent),
          },
          {
            path: 'create',
            loadComponent: () =>
              import(
                '../../private/modules/store/products/pages/product-create-page/product-create-page.component'
              ).then((c) => c.ProductCreatePageComponent),
          },
          {
            path: 'edit/:id',
            loadComponent: () =>
              import(
                '../../private/modules/store/products/pages/product-create-page/product-create-page.component'
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
      // Inventory Routes
      {
        path: 'inventory',
        loadComponent: () =>
          import('../../private/modules/store/inventory/inventory.component').then(
            (c) => c.InventoryComponent
          ),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('../../private/modules/store/inventory/inventory-dashboard.component').then(
                (c) => c.InventoryDashboardComponent
              ),
          },
          // Punto de Compra (POP) - Creating purchase orders
          {
            path: 'pop',
            loadComponent: () => {
              console.log('Attempting to load PopComponent for /pop');
              return import('../../private/modules/store/inventory/pop/pop.component').then(
                (c) => c.PopComponent
              );
            },
          },
          {
            path: 'pop/:id',
            loadComponent: () => {
              console.log('Attempting to load PopComponent for /pop/:id');
              return import('../../private/modules/store/inventory/pop/pop.component').then(
                (c) => c.PopComponent
              );
            },
          },
          {
            path: 'suppliers',
            loadComponent: () =>
              import('../../private/modules/store/inventory/suppliers/suppliers.component').then(
                (c) => c.SuppliersComponent
              ),
          },
          /* Orders removed (moved to Orders module) */
          {
            path: 'locations',
            loadComponent: () =>
              import('../../private/modules/store/inventory/locations/locations.component').then(
                (c) => c.LocationsComponent
              ),
          },
          {
            path: 'adjustments',
            loadComponent: () =>
              import('../../private/modules/store/inventory/operations/stock-adjustments.component').then(
                (c) => c.StockAdjustmentsComponent
              ),
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
            redirectTo: 'sales',
          },
          {
            path: 'sales',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/orders/orders.component'
              ).then((c) => c.OrdersComponent),
          },
          {
            path: 'purchase-orders',
            loadComponent: () =>
              import('../../private/modules/store/orders/purchase-orders/purchase-orders.component').then(
                (c) => c.PurchaseOrdersComponent
              ),
          },
          {
            path: 'purchase-orders',
            loadComponent: () =>
              import('../../private/modules/store/orders/purchase-orders/purchase-orders.component').then(
                (c) => c.PurchaseOrdersComponent
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import(
                '../../private/modules/store/orders/components/order-details'
              ).then((c) => c.OrderDetailsComponent),
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
            redirectTo: 'all',
          },
          {
            path: 'all',
            loadComponent: () =>
              import(
                '../../private/modules/store/customers/customers.component'
              ).then((c) => c.CustomersComponent),
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
            redirectTo: 'promotions',
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
            redirectTo: 'sales',
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
            redirectTo: 'general',
          },
          {
            path: 'general',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/general/general-settings.component'
              ).then((c) => c.GeneralSettingsComponent),
          },
          {
            path: 'payments',
            loadComponent: () =>
              import(
                '../../private/modules/store/settings/payments/payments-settings.component'
              ).then((c) => c.PaymentsSettingsComponent),
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
        ],
      },
    ],
  },
];
