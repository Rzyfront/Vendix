import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const orgAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () =>
      import('../../private/layouts/organization-admin/organization-admin-layout.component').then(
        (c) => c.OrganizationAdminLayoutComponent,
      ),
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
          import('../../private/modules/organization/dashboard/dashboard.component').then(
            (c) => c.DashboardComponent,
          ),
      },
      {
        path: 'stores',
        loadComponent: () =>
          import('../../private/modules/organization/stores/stores.component').then(
            (c) => c.StoresComponent,
          ),
      },
      {
        path: 'users',
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('../../private/modules/organization/users/users.component').then(
                (c) => c.UsersComponent,
              ),
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
              import('../../private/modules/organization/orders/orders-list.component').then(
                (c) => c.OrdersListComponent,
              ),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('../../private/modules/organization/orders/components/order-details.component').then(
                (c) => c.OrderDetailsComponent,
              ),
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
        loadChildren: () =>
          import('../../private/modules/organization/config/config.routes').then(
            (m) => m.ConfigRoutingModule,
          ),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import('../../private/modules/organization/domains/domains.component').then(
            (c) => c.DomainsComponent,
          ),
      },
      {
        path: 'roles',
        loadComponent: () =>
          import('../../private/modules/organization/roles/roles.component').then(
            (c) => c.RolesComponent,
          ),
      },
      // Accounting Routes — ORG_ADMIN consolidated read-only views
      // (Phase 5 operating_scope consolidation). Consumes
      // /api/organization/accounting/* endpoints.
      {
        path: 'accounting',
        loadChildren: () =>
          import('../../private/modules/organization/accounting/accounting.routes').then(
            (m) => m.orgAccountingRoutes,
          ),
      },
      // Inventory Routes — ORG_ADMIN consolidated read-only views
      {
        path: 'inventory',
        loadChildren: () =>
          import('../../private/modules/organization/inventory/inventory.routes').then(
            (m) => m.orgInventoryRoutes,
          ),
      },
      // Reports Routes — ORG_ADMIN consolidated reports
      {
        path: 'reports',
        loadChildren: () =>
          import('../../private/modules/organization/reports/reports.routes').then(
            (m) => m.orgReportsRoutes,
          ),
      },
      // Purchase Orders — ORG_ADMIN CRUD
      {
        path: 'purchase-orders',
        loadChildren: () =>
          import('../../private/modules/organization/purchase-orders/purchase-orders.routes').then(
            (m) => m.orgPurchaseOrdersRoutes,
          ),
      },
      // Payroll Routes (adaptive module — visible at org level)
      {
        path: 'payroll',
        loadChildren: () =>
          import('../../private/modules/store/payroll/payroll.routes').then(
            (m) => m.payrollRoutes,
          ),
      },
      // Subscriptions Routes
      {
        path: 'subscriptions',
        loadChildren: () =>
          import('../../private/modules/organization/subscriptions/subscriptions.routes').then(
            (m) => m.default,
          ),
      },
      // Operating-scope wizard (settings → modo operativo).
      // Phase 4 — operating_scope consolidation. ORG_ADMIN only.
      {
        path: 'settings/operating-scope',
        loadComponent: () =>
          import(
            '../../private/modules/organization/settings/operating-scope/operating-scope.component'
          ).then((c) => c.OperatingScopeComponent),
      },
    ],
  },
];
