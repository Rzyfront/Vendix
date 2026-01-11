import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const superAdminRoutes: Routes = [
  {
    path: 'super-admin',
    loadComponent: () =>
      import(
        '../../private/layouts/super-admin/super-admin-layout.component'
      ).then((c) => c.SuperAdminLayoutComponent),
    canActivate: [AuthGuard], // O un guardia específico para Super Admin
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
            '../../private/modules/super-admin/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      {
        path: 'organizations',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/organizations/organizations.component'
          ).then((c) => c.OrganizationsComponent),
      },
      {
        path: 'users',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/users/users.component'
          ).then((c) => c.UsersComponent),
      },
      {
        path: 'roles',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/roles/roles.component'
          ).then((c) => c.RolesComponent),
      },
      {
        path: 'payment-methods',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/payment-methods/payment-methods.component'
          ).then((c) => c.PaymentMethodsComponent),
      },
      {
        path: 'stores',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/stores/stores.component'
          ).then((c) => c.StoresComponent),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/audit/audit.component'
          ).then((c) => c.AuditComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/domains/domains.component'
          ).then((c) => c.DomainsComponent),
      },
    ],
  },
];
