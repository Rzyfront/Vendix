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
      }
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
