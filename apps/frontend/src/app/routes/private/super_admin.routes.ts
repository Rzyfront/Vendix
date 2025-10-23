import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const superAdminRoutes: Routes = [
  {
    path: 'super-admin',
    loadComponent: () => import('../../private/layouts/super-admin/super-admin-layout.component').then(c => c.SuperAdminLayoutComponent),
    canActivate: [AuthGuard], // O un guardia específico para Super Admin
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('../../private/modules/super-admin/dashboard/dashboard.component').then(c => c.DashboardComponent)
      },
      {
        path: 'organizations',
        children: [
          {
            path: '',
            loadComponent: () => import('../../private/modules/super-admin/organizations/organizations.component').then(c => c.OrganizationsComponent)
          },
          {
            path: 'create',
            loadComponent: () => import('../../private/modules/super-admin/organizations/components/create-organization.component').then(c => c.CreateOrganizationComponent)
          },
          {
            path: ':id',
            loadComponent: () => import('../../private/modules/super-admin/organizations/components/organization-details.component').then(c => c.OrganizationDetailsComponent)
          },
          {
            path: ':id/edit',
            loadComponent: () => import('../../private/modules/super-admin/organizations/components/edit-organization.component').then(c => c.EditOrganizationComponent)
          },
          {
            path: 'settings',
            loadComponent: () => import('../../private/modules/super-admin/organizations/components/organization-settings.component').then(c => c.OrganizationSettingsComponent)
          }
        ]
      },
      {
        path: 'users',
        loadChildren: () => import('../../private/modules/super-admin/users/users.routes').then(r => r.USERS_ROUTES)
      }
    ]
  }
];