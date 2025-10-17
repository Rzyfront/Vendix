import { Routes } from '@angular/router';
import { DomainGuard } from './core/guards/domain.guard';
import { AuthGuard } from './core/guards/auth.guard';
import { RoleGuard } from './core/guards/role.guard';

// Importaciones de componentes para referencia estática
import { VendixLandingComponent } from './public/landing/vendix-landing/vendix-landing.component';
import { OrgLandingComponent } from './public/dynamic-landing/components/org-landing/org-landing.component';
import { StoreLandingComponent } from './public/dynamic-landing/components/store-landing/store-landing.component';
import { StorefrontComponent } from './public/ecommerce/components/storefront/storefront.component';
import { SuperAdminLayoutComponent } from './private/layouts/super-admin/super-admin-layout.component';
import { OrganizationAdminLayoutComponent } from './private/layouts/organization-admin/organization-admin-layout.component';
import { StoreAdminLayoutComponent } from './private/layouts/store-admin/store-admin-layout.component';

/**
 * Configuración de rutas base de la aplicación
 *
 * NOTA: Las rutas principales se configuran dinámicamente a través del RouteManager
 * basándose en el dominio y configuración del tenant. Este archivo solo contiene
 * las rutas estáticas esenciales y la configuración de fallback.
 */
export const routes: Routes = [
  // Ruta raíz - gestionada dinámicamente por DomainGuard
  {
    path: '',
    canActivate: [DomainGuard],
    component: VendixLandingComponent // Componente placeholder, será reemplazado dinámicamente
  },
  // Rutas de autenticación contextual
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () => import('./public/auth/components/contextual-login/contextual-login.component').then(c => c.ContextualLoginComponent),
        data: { isPublic: true }
      },
      {
        path: 'register',
        loadComponent: () => import('./public/auth/components/register-owner/register-owner.component').then(c => c.RegisterOwnerComponent),
        data: { isPublic: true }
      },
      {
        path: 'forgot-owner-password',
        loadComponent: () => import('./public/auth/components/forgot-owner-password/forgot-owner-password').then(c => c.ForgotOwnerPasswordComponent),
        data: { isPublic: true }
      },
      {
        path: 'reset-owner-password',
        loadComponent: () => import('./public/auth/components/reset-owner-password/reset-owner-password').then(c => c.ResetOwnerPasswordComponent),
        data: { isPublic: true }
      },
      {
        path: 'verify-email',
        loadComponent: () => import('./public/auth/components/email-verification/email-verification.component').then(c => c.EmailVerificationComponent),
        data: { isPublic: true }
      },
    ]
  },

  // Rutas de administración con guards específicos y layouts
  {
    path: 'superadmin',
    canActivate: [AuthGuard, RoleGuard],
    data: {
      roles: ['super_admin'],
      redirectTo: '/'
    },
    component: SuperAdminLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('./private/modules/super-admin/dashboard/dashboard.component').then(c => c.DashboardComponent)
      },
      {
        path: 'organizations',
        loadComponent: () => import('./private/modules/super-admin/organizations/organizations.component').then(c => c.OrganizationsComponent)
      },
      {
        path: 'organizations/create',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'organizations/settings',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users/roles',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users/permissions',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'system/settings',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'system/logs',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'system/backups',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'analytics/platform',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'analytics/users',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'analytics/performance',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'billing',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'support',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      }
    ]
  },

  {
    path: 'admin',
    canActivate: [AuthGuard, RoleGuard],
    data: {
      roles: ['owner', 'admin', 'manager'],
      anyRole: true,
      redirectTo: '/'
    },
    component: OrganizationAdminLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () => import('./private/modules/organization/dashboard/dashboard.component').then(c => c.DashboardComponent)
      },
      {
        path: 'store',
        loadComponent: () => import('./private/modules/store/dashboard/dashboard.component').then(c => c.DashboardComponent)
      },
      {
        path: 'analytics/reports',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'analytics/statistics',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'analytics/insights',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users/all',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users/roles',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'users/permissions',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'products/all',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'products/categories',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'products/inventory',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'orders',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'settings/general',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'settings/security',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      },
      {
        path: 'settings/notifications',
        loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent)
      }
    ]
  },

  // Rutas públicas de e-commerce
  {
    path: 'shop',
    component: StorefrontComponent,
    data: { isPublic: true }
  },

  // Wildcard route - 404 page
  {
    path: '**',
    redirectTo: ''
  }
];
