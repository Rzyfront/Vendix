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
        loadComponent: () => import('../../private/modules/super-admin/organizations/organizations.component').then(c => c.OrganizationsComponent)
      },
      {
        path: 'users',
        loadComponent: () => import('../../private/modules/super-admin/users/users.component').then(c => c.UsersComponent)
      },
      {
        path: 'roles',
        loadComponent: () => import('../../private/modules/super-admin/roles/roles.component').then(c => c.RolesComponent)
      },
      {
        path: 'stores',
        loadComponent: () => import('../../private/modules/super-admin/stores/stores.component').then(c => c.StoresComponent)
      }
    ]
  }
];