import { Routes } from '@angular/router';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/admin-layout.component').then(c => c.AdminLayoutComponent),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full'
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/admin-dashboard/admin-dashboard.component').then(c => c.AdminDashboardComponent)
      },
      {
        path: 'organizations',
        loadComponent: () => import('./pages/organizations/organizations.component').then(c => c.OrganizationsComponent)
      },
      {
        path: 'stores',
        loadComponent: () => import('./pages/stores/stores.component').then(c => c.StoresComponent)
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/users/users.component').then(c => c.UsersComponent)
      },
      {
        path: 'analytics',
        loadComponent: () => import('./pages/analytics/analytics.component').then(c => c.AnalyticsComponent)
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.component').then(c => c.SettingsComponent),
        children: [
          {
            path: '',
            redirectTo: 'general',
            pathMatch: 'full'
          },
          {
            path: 'general',
            loadComponent: () => import('./pages/settings/general-settings.component').then(c => c.GeneralSettingsComponent)
          },
          {
            path: 'roles',
            loadComponent: () => import('./pages/roles/roles.component').then(c => c.RolesComponent)
          },
          {
            path: 'roles/:id/permissions',
            loadComponent: () => import('./pages/permissions/permissions.component').then(c => c.PermissionsComponent)
          }
        ]
      },
      {
        path: '**',
        redirectTo: 'dashboard'
      }
    ]
  }
];
