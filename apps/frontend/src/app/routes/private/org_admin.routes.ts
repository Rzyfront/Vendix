import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const orgAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () =>
      import(
        '../../private/layouts/organization-admin/organization-admin-layout.component'
      ).then((c) => c.OrganizationAdminLayoutComponent),
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
            '../../private/modules/organization/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      {
        path: 'stores',
        loadComponent: () =>
          import(
            '../../private/modules/organization/stores/stores.component'
          ).then((c) => c.StoresComponent),
      },
      {
        path: 'users',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/users/users.component'
              ).then((c) => c.UsersComponent),
          },
        ],
      },
      {
        path: 'orders',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/orders/orders-list.component'
              ).then((c) => c.OrdersListComponent),
          },
          {
            path: ':id',
            loadComponent: () =>
              import(
                '../../private/modules/organization/orders/components/order-details.component'
              ).then((c) => c.OrderDetailsComponent),
          },
        ],
      },
      {
        path: 'audit',
        loadChildren: () =>
          import('../../private/modules/organization/audit/audit.routes').then(
            (m) => m.AuditRoutingModule,
          ),
      },
      {
        path: 'config',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import(
                '../../private/modules/organization/config/config.component'
              ).then((c) => c.ConfigComponent),
          },
          {
            path: 'payments-methods',
            loadComponent: () =>
              import(
                '../../private/modules/organization/payment-methods/payment-methods.component'
              ).then((c) => c.PaymentMethodsComponent),
          },
        ],
      },
    ],
  },
];
