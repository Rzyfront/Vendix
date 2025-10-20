import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const orgAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () => import('../../private/layouts/organization-admin/organization-admin-layout.component').then(c => c.OrganizationAdminLayoutComponent),
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('../../private/modules/organization/dashboard/dashboard.component').then(c => c.DashboardComponent)
      }
      // Aquí se añadirían más rutas de admin de organización como /admin/stores, /admin/users, etc.
    ]
  }
];