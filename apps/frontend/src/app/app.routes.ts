import { Routes } from '@angular/router';
import { DomainAppGuard } from './core/guards/domain-app.guard';
import { EnvMatchGuard } from './core/guards/env-match.guard';
import { PostLoginLayoutGuard } from './core/guards/post-login-layout.guard';

// Public Components
import { VendixLandingComponent } from './public/landing/vendix-landing/vendix-landing.component';
import { OrgLandingComponent } from './public/dynamic-landing/components/org-landing/org-landing.component';
import { StoreLandingComponent } from './public/dynamic-landing/components/store-landing/store-landing.component';
import { StorefrontComponent } from './public/ecommerce/components/storefront/storefront.component';

// Super Admin Components
import { SuperAdminDashboardComponent } from './private/super-admin/components/dashboard/super-admin-dashboard.component';
import { OrganizationsManagementComponent } from './private/super-admin/components/organizations/organizations-management.component';

export const routes: Routes = [
  // Root path adapts to environment
  // Vendix Landing → VendixLandingComponent at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['vendix_landing'] },
    component: VendixLandingComponent,
  },
  // Organization Landing → OrgLandingComponent at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['org_landing'] },
    component: OrgLandingComponent,
  },
  // Store Landing → StoreLandingComponent at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['store_landing'] },
    component: StoreLandingComponent,
  },
  // Storefront e-commerce → StorefrontComponent at '/'
  {
    path: '',
    canMatch: [EnvMatchGuard],
    data: { environments: ['store_ecommerce'] },
    component: StorefrontComponent,
  },
  // Fallback root route: when environment is not yet resolved, avoid wildcard '/' loop
  // and show a safe landing shell. DomainAppGuard can also redirect to '/shop' or '/admin'
  // once domain info is available.
  {
    path: '',
    canMatch: [DomainAppGuard],
    component: VendixLandingComponent,
  },

  // Post-login redirection route
  {
    path: 'post-login',
    canActivate: [PostLoginLayoutGuard],
    component: VendixLandingComponent
  },

  // Wildcard route - 404 page
  {
    path: '**',
    redirectTo: ''
  }
];
