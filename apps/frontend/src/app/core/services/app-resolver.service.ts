import { Injectable } from '@angular/core';
import { DomainDetectorService } from './domain-detector.service';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';

export interface AppConfig {
  environment: AppEnvironment;
  publicRoutes: RouteConfig[];
  privateRoutes: RouteConfig[];
  layouts: LayoutConfig[];
  modules: ModuleConfig[];
  features: string[];
}

export interface RouteConfig {
  path: string;
  component: string;
  layout?: string;
  guards?: string[];
  data?: any;
}

export interface LayoutConfig {
  name: string;
  component: string;
  allowedEnvironments: AppEnvironment[];
  allowedRoles: string[];
}

export interface ModuleConfig {
  name: string;
  path: string;
  allowedEnvironments: AppEnvironment[];
  allowedRoles: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AppResolverService {

  constructor(private domainDetector: DomainDetectorService) {}

  /**
   * Resuelve la configuración completa de la aplicación basada en el dominio
   */
  async resolveAppConfiguration(): Promise<AppConfig> {
    const domainConfig = await this.domainDetector.detectDomain();
    
    return {
      environment: domainConfig.environment,
      publicRoutes: this.resolvePublicRoutes(domainConfig),
      privateRoutes: this.resolvePrivateRoutes(domainConfig),
      layouts: this.resolveLayouts(domainConfig),
      modules: this.resolveModules(domainConfig),
      features: this.resolveFeatures(domainConfig)
    };
  }

  /**
   * Resuelve las rutas públicas para el entorno detectado
   */
  private resolvePublicRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return [
          { 
            path: '/', 
            component: 'VendixLandingComponent',
            layout: 'public'
          },
          { 
            path: '/auth/login', 
            component: 'VendixAuthLoginComponent',
            layout: 'auth'
          },
          { 
            path: '/auth/register', 
            component: 'VendixAuthRegisterComponent',
            layout: 'auth'
          },
          { 
            path: '/auth/forgot-password', 
            component: 'VendixAuthForgotPasswordComponent',
            layout: 'auth'
          }
        ];

      case AppEnvironment.ORG_LANDING:
        return [
          { 
            path: '/', 
            component: 'OrgLandingComponent',
            layout: 'public'
          },
          { 
            path: '/auth/login', 
            component: 'OrgAuthLoginComponent',
            layout: 'auth'
          },
          { 
            path: '/shop', 
            component: 'OrgEcommerceComponent',
            layout: 'storefront'
          }
        ];

      case AppEnvironment.STORE_ECOMMERCE:
        return [
          { 
            path: '/', 
            component: 'StoreEcommerceComponent',
            layout: 'storefront'
          },
          { 
            path: '/auth/login', 
            component: 'StoreAuthLoginComponent',
            layout: 'auth'
          },
          { 
            path: '/auth/register', 
            component: 'StoreAuthRegisterComponent',
            layout: 'auth'
          }
        ];

      default:
        return [
          { 
            path: '/', 
            component: 'LandingComponent',
            layout: 'public'
          },
          { 
            path: '/auth/login', 
            component: 'AuthLoginComponent',
            layout: 'auth'
          }
        ];
    }
  }

  /**
   * Resuelve las rutas privadas para el entorno detectado
   */
  private resolvePrivateRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_ADMIN:
        return [
          { 
            path: '/superadmin', 
            component: 'SuperAdminDashboardComponent',
            layout: 'super-admin',
            guards: ['SuperAdminGuard', 'LayoutAccessGuard']
          },
          { 
            path: '/superadmin/tenants', 
            component: 'TenantListComponent',
            layout: 'super-admin',
            guards: ['SuperAdminGuard']
          }
        ];

      case AppEnvironment.ORG_ADMIN:
        return [
          { 
            path: '/admin', 
            component: 'OrgAdminDashboardComponent',
            layout: 'organization-admin',
            guards: ['AdminGuard', 'LayoutAccessGuard']
          },
          { 
            path: '/admin/stores', 
            component: 'StoreManagementComponent',
            layout: 'organization-admin',
            guards: ['AdminGuard']
          },
          { 
            path: '/admin/users', 
            component: 'UserManagementComponent',
            layout: 'organization-admin',
            guards: ['AdminGuard']
          }
        ];

      case AppEnvironment.STORE_ADMIN:
        return [
          { 
            path: '/admin', 
            component: 'StoreAdminDashboardComponent',
            layout: 'store-admin',
            guards: ['AdminGuard', 'LayoutAccessGuard']
          },
          { 
            path: '/admin/products', 
            component: 'ProductManagementComponent',
            layout: 'store-admin',
            guards: ['AdminGuard']
          },
          { 
            path: '/admin/orders', 
            component: 'OrderManagementComponent',
            layout: 'store-admin',
            guards: ['AdminGuard']
          },
          { 
            path: '/pos', 
            component: 'POSComponent',
            layout: 'pos',
            guards: ['POSGuard']
          }
        ];

      case AppEnvironment.STORE_ECOMMERCE:
        return [
          { 
            path: '/account', 
            component: 'CustomerAccountComponent',
            layout: 'store-ecommerce',
            guards: ['AuthGuard']
          },
          { 
            path: '/orders', 
            component: 'CustomerOrdersComponent',
            layout: 'store-ecommerce',
            guards: ['AuthGuard']
          }
        ];

      default:
        return [];
    }
  }

  /**
   * Resuelve los layouts disponibles para el entorno
   */
  private resolveLayouts(domainConfig: DomainConfig): LayoutConfig[] {
    const baseLayouts: LayoutConfig[] = [
      {
        name: 'auth',
        component: 'AuthLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_LANDING, AppEnvironment.ORG_LANDING, AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: []
      },
      {
        name: 'public',
        component: 'PublicLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_LANDING, AppEnvironment.ORG_LANDING],
        allowedRoles: []
      },
      {
        name: 'storefront',
        component: 'StorefrontLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_LANDING, AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: ['customer']
      }
    ];

    const privateLayouts: LayoutConfig[] = [
      {
        name: 'super-admin',
        component: 'SuperAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_ADMIN],
        allowedRoles: ['super_admin']
      },
      {
        name: 'organization-admin',
        component: 'OrganizationAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager']
      },
      {
        name: 'store-admin',
        component: 'StoreAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'supervisor']
      },
      {
        name: 'org-ecommerce',
        component: 'OrgEcommerceLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN, AppEnvironment.STORE_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'customer']
      },
      {
        name: 'store-ecommerce',
        component: 'StoreEcommerceLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: ['customer', 'employee']
      },
      {
        name: 'pos',
        component: 'POSLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ADMIN],
        allowedRoles: ['supervisor', 'employee']
      }
    ];

    return [...baseLayouts, ...privateLayouts].filter(layout => 
      layout.allowedEnvironments.includes(domainConfig.environment)
    );
  }

  /**
   * Resuelve los módulos disponibles para el entorno
   */
  private resolveModules(domainConfig: DomainConfig): ModuleConfig[] {
    const modules: ModuleConfig[] = [
      // Módulos públicos
      {
        name: 'vendix-landing',
        path: 'public/landing',
        allowedEnvironments: [AppEnvironment.VENDIX_LANDING],
        allowedRoles: []
      },
      {
        name: 'org-landing',
        path: 'public/dynamic-landing',
        allowedEnvironments: [AppEnvironment.ORG_LANDING],
        allowedRoles: []
      },
      {
        name: 'ecommerce',
        path: 'public/ecommerce',
        allowedEnvironments: [AppEnvironment.STORE_ECOMMERCE, AppEnvironment.ORG_LANDING],
        allowedRoles: []
      },
      
      // Módulos privados
      {
        name: 'super-admin',
        path: 'private/super-admin',
        allowedEnvironments: [AppEnvironment.VENDIX_ADMIN],
        allowedRoles: ['super_admin']
      },
      {
        name: 'organization-admin',
        path: 'private/organization-admin',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager']
      },
      {
        name: 'store-admin',
        path: 'private/store-admin',
        allowedEnvironments: [AppEnvironment.STORE_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'supervisor']
      },
      {
        name: 'org-ecommerce',
        path: 'private/org-ecommerce',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'customer']
      },
      {
        name: 'store-ecommerce',
        path: 'private/store-ecommerce',
        allowedEnvironments: [AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: ['customer', 'employee']
      }
    ];

    return modules.filter(module => 
      module.allowedEnvironments.includes(domainConfig.environment)
    );
  }

  /**
   * Resuelve las características disponibles para el entorno
   */
  resolveFeatures(domainConfig: DomainConfig): string[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return ['registration', 'login', 'marketing', 'onboarding'];

      case AppEnvironment.VENDIX_ADMIN:
        return ['tenant-management', 'system-analytics', 'user-management', 'billing'];

      case AppEnvironment.ORG_LANDING:
        return ['company-info', 'contact', 'login', 'ecommerce'];

      case AppEnvironment.ORG_ADMIN:
        return ['store-management', 'user-management', 'analytics', 'billing', 'ecommerce'];

      case AppEnvironment.STORE_ADMIN:
        return ['inventory', 'sales', 'customer-management', 'pos', 'ecommerce'];

      case AppEnvironment.STORE_ECOMMERCE:
        return ['catalog', 'shopping-cart', 'checkout', 'account', 'reviews'];

      default:
        return [];
    }
  }

  /**
   * Obtiene la URL de redirección post-login basada en el entorno y roles
   */
  getPostLoginRedirect(environment: AppEnvironment, userRoles: string[]): string {
    const adminRoles = ['super_admin', 'admin', 'owner', 'manager'];
    const posRoles = ['supervisor', 'employee'];
    const customerRoles = ['customer'];

    // Prioridad: super-admin > admin > pos > customer
    if (userRoles.includes('super_admin')) return '/superadmin';
    if (userRoles.some(role => adminRoles.includes(role))) return '/admin';
    if (userRoles.some(role => posRoles.includes(role))) return '/pos';
    if (userRoles.some(role => customerRoles.includes(role))) return '/account';

    // Fallback basado en entorno
    switch(environment) {
      case AppEnvironment.VENDIX_ADMIN:
        return '/superadmin';
      case AppEnvironment.ORG_ADMIN:
      case AppEnvironment.STORE_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ECOMMERCE:
        return '/account';
      default:
        return '/';
    }
  }

  /**
   * Verifica si un layout está permitido para el entorno y roles dados
   */
  isLayoutAllowed(layoutName: string, environment: AppEnvironment, userRoles: string[]): boolean {
    const layouts = this.resolveLayouts({ environment } as DomainConfig);
    const layout = layouts.find(l => l.name === layoutName);
    
    if (!layout) return false;
    
    // Si no hay roles requeridos, está permitido (layouts públicos)
    if (layout.allowedRoles.length === 0) return true;
    
    // Verificar si alguno de los roles del usuario está permitido
    return userRoles.some(role => layout.allowedRoles.includes(role));
  }
}