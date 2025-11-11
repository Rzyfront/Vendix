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
        path: 'users',
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
                '../../private/modules/organization/users/users.component'
              ).then((c) => c.UsersComponent),
            data: {
              title: 'Users',
              icon: 'fas fa-users',
              breadcrumb: {
                parent: { label: 'Organización', url: '/organization' },
                current: { label: 'Users' },
              },
            },
          },
        ],
      },
    ],
  },
];
