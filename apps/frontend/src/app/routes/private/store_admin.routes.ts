import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const storeAdminRoutes: Routes = [
  {
    path: 'admin',
    loadComponent: () => import('../../private/layouts/store-admin/store-admin-layout.component').then(c => c.StoreAdminLayoutComponent),
    canActivate: [AuthGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('../../private/modules/store/dashboard/dashboard.component').then(c => c.DashboardComponent)
      }
      // Aquí se añadirían más rutas de admin de tienda como /admin/products, etc.
    ]
  }
];