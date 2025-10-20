import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const superAdminRoutes: Routes = [
  {
    path: 'superadmin',
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
        path: 'tenants',
        loadComponent: () => import('../../private/modules/super-admin/organizations/organizations.component').then(c => c.OrganizationsComponent)
      }
    ]
  }
];