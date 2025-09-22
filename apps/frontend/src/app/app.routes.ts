import { Routes } from '@angular/router';
import { AdminGuard } from './core/guards/admin.guard';
import { POSGuard } from './core/guards/pos.guard';
import { SuperAdminGuard } from './core/guards/super-admin.guard';

// Layouts
import { AuthLayoutComponent } from './layouts/AuthLayout/auth-layout.component';
import { AdminLayoutComponent } from './layouts/AdminLayout/admin-layout.component';
import { POSLayoutComponent } from './layouts/POSLayout/pos-layout.component';
import { StorefrontLayoutComponent } from './layouts/StorefrontLayout/storefront-layout.component';
import { SuperAdminLayoutComponent } from './layouts/SuperAdminLayout/super-admin-layout.component';

// Placeholder views
import { LoginPageComponent } from './views/auth/login-page.component';
import { DashboardPageComponent } from './views/admin/dashboard-page.component';
import { RegisterSalePageComponent } from './views/pos/register-sale-page.component';
import { HomePageComponent } from './views/storefront/home-page.component';
import { TenantListPageComponent } from './views/superadmin/tenant-list-page.component';

export const routes: Routes = [
  // Public Storefront routes
  {
    path: '',
    component: StorefrontLayoutComponent,
    children: [
      { path: '', component: HomePageComponent },
      // Add more storefront routes here
    ]
  },
  {
    path: 'shop',
    component: StorefrontLayoutComponent,
    children: [
      { path: '', component: HomePageComponent },
      // Store routes can be added here
    ]
  },

  // Authentication routes
  {
    path: 'auth',
    component: AuthLayoutComponent,
    children: [
      { path: 'login', component: LoginPageComponent },
      // Other auth routes
    ]
  },

  // Admin routes
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [AdminGuard],
    loadChildren: () => import('./modules/admin/admin.routes').then(r => r.adminRoutes)
  },

  // POS routes
  {
    path: 'pos',
    component: POSLayoutComponent,
    canActivate: [POSGuard],
    children: [
      { path: '', component: RegisterSalePageComponent },
      // Other POS routes
    ]
  },

  // Super Admin routes
  {
    path: 'superadmin',
    component: SuperAdminLayoutComponent,
    canActivate: [SuperAdminGuard],
    children: [
      { path: '', component: TenantListPageComponent },
      // Other super admin routes
    ]
  },

  // Organization routes (if needed)
  {
    path: 'organization',
    loadChildren: () => import('./modules/organization/organization.routes').then(r => r.organizationRoutes)
  },

  // Playground (UI demos)
  {
    path: 'playground',
    loadComponent: () => import('./modules/playground/playground.component').then(c => c.PlaygroundComponent)
  },

  // Wildcard route - 404 page
  {
    path: '**',
    redirectTo: '/'
  }
];
