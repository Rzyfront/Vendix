import { Routes } from '@angular/router';
import { AdminGuard } from './core/guards/admin.guard';
import { POSGuard } from './core/guards/pos.guard';
import { SuperAdminGuard } from './core/guards/super-admin.guard';
import { DomainAppGuard } from './core/guards/domain-app.guard';
import { EnvMatchGuard } from './core/guards/env-match.guard';
import { PostLoginLayoutGuard } from './core/guards/post-login-layout.guard';
import { LayoutAccessGuard } from './core/guards/layout-access.guard';

// Layouts
import { AuthLayoutComponent } from './layouts/AuthLayout/auth-layout.component';
import { AdminLayoutComponent } from './layouts/AdminLayout/admin-layout.component';
import { POSLayoutComponent } from './layouts/POSLayout/pos-layout.component';
import { StorefrontLayoutComponent } from './layouts/StorefrontLayout/storefront-layout.component';
import { SuperAdminLayoutComponent } from './layouts/SuperAdminLayout/super-admin-layout.component';

// Placeholder views
import { DashboardPageComponent } from './views/admin/dashboard-page.component';
import { RegisterSalePageComponent } from './views/pos/register-sale-page.component';
import { HomePageComponent } from './views/storefront/home-page.component';
import { TenantListPageComponent } from './views/superadmin/tenant-list-page.component';
import { LandingComponent } from './modules/landing/landing.component';

export const routes: Routes = [
  // Root path adapts to environment
  // Vendix Landing → LandingComponent at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['vendix_landing'] },
    component: LandingComponent,
  },
  // Storefront e-commerce → StorefrontLayout with HomePage at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['store_ecommerce', 'org_landing'] },
    component: StorefrontLayoutComponent,
    children: [
      { path: '', component: HomePageComponent },
    ]
  },
  // Organization/Store Admin → Admin layout dashboard at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['org_admin', 'store_admin'] },
    component: AdminLayoutComponent,
    // Lazy admin module routes could provide dashboard as default child
    loadChildren: () => import('./modules/admin/admin.routes').then(r => r.adminRoutes)
  },
  // Fallback root route: when environment is not yet resolved, avoid wildcard '/' loop
  // and show a safe landing shell. DomainAppGuard can also redirect to '/shop' or '/admin'
  // once domain info is available.
  {
    path: '',
    canMatch: [DomainAppGuard],
    component: LandingComponent,
  },
  {
    path: 'shop',
    component: StorefrontLayoutComponent,
    children: [
      { path: '', component: HomePageComponent },
      // Store routes can be added here
    ]
  },

  // Post-login redirection route
  {
    path: 'post-login',
    canActivate: [PostLoginLayoutGuard],
    component: AuthLayoutComponent
  },

  // Authentication routes (use full-featured Auth Module directly, no wrapper layout)
  {
    path: 'auth',
    loadChildren: () => import('./modules/auth/auth.routes').then(r => r.authRoutes)
  },

  // Admin routes
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [AdminGuard, LayoutAccessGuard],
    data: { layout: 'admin' },
    loadChildren: () => import('./modules/admin/admin.routes').then(r => r.adminRoutes)
  },

  // POS routes
  {
    path: 'pos',
    component: POSLayoutComponent,
    canActivate: [POSGuard, LayoutAccessGuard],
    data: { layout: 'pos' },
    children: [
      { path: '', component: RegisterSalePageComponent },
      // Other POS routes
    ]
  },

  // Super Admin routes
  {
    path: 'superadmin',
    component: SuperAdminLayoutComponent,
    canActivate: [SuperAdminGuard, LayoutAccessGuard],
    data: { layout: 'superadmin' },
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
    redirectTo: ''
  }
];
