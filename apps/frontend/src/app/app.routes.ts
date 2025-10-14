import { Routes } from '@angular/router';
import { DomainGuard } from './core/guards/domain.guard';
import { AuthGuard } from './core/guards/auth.guard';
import { RoleGuard } from './core/guards/role.guard';

// Importaciones de componentes para referencia estática
import { VendixLandingComponent } from './public/landing/vendix-landing/vendix-landing.component';
import { OrgLandingComponent } from './public/dynamic-landing/components/org-landing/org-landing.component';
import { StoreLandingComponent } from './public/dynamic-landing/components/store-landing/store-landing.component';
import { StorefrontComponent } from './public/ecommerce/components/storefront/storefront.component';
import { SuperAdminDashboardComponent } from './private/super-admin/components/dashboard/super-admin-dashboard.component';
import { OrganizationsManagementComponent } from './private/super-admin/components/organizations/organizations-management.component';
import { OrganizationDashboardComponent } from './private/organization-admin/components/dashboard/organization-dashboard.component';
import { StoreDashboardComponent } from './private/store-admin/components/dashboard/store-dashboard.component';
import { StoreEcommerceDashboardComponent } from './private/store-ecommerce/components/dashboard/store-ecommerce-dashboard.component';

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

  // Rutas de administración con guards específicos
  {
    path: 'superadmin',
    canActivate: [AuthGuard, RoleGuard],
    data: {
      roles: ['super_admin'],
      redirectTo: '/'
    },
    children: [
      {
        path: '',
        component: SuperAdminDashboardComponent
      },
      {
        path: 'organizations',
        component: OrganizationsManagementComponent
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
    children: [
      {
        path: '',
        component: OrganizationDashboardComponent
      },
      {
        path: 'store',
        component: StoreDashboardComponent
      }
    ]
  },

  // Rutas públicas de e-commerce
  {
    path: 'shop',
    component: StorefrontComponent,
    data: { isPublic: true }
  },

  {
    path: 'store-ecommerce',
    component: StoreEcommerceDashboardComponent,
    data: { isPublic: true }
  },

  // Wildcard route - 404 page
  {
    path: '**',
    redirectTo: ''
  }
];
