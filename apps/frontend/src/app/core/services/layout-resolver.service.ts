import { Injectable, inject } from '@angular/core';
import { DomainConfig, AppEnvironment, DomainType } from '../models/domain-config.interface';
import { TenantConfig } from '../models/tenant-config.interface';

export interface LayoutConfig {
  name: string;
  component: string;
  route: string;
  allowedRoles: string[];
}

@Injectable({
  providedIn: 'root'
})
export class LayoutResolverService {
  /**
   * Resuelve el layout apropiado basado en dominio, roles y contexto del tenant
   */
  resolveLayout(
    domainConfig: DomainConfig,
    userRoles: string[]
  ): LayoutConfig {
    console.log('[LAYOUT RESOLVER] Resolviendo layout para:', {
      domainEnvironment: domainConfig.environment,
      userRoles
    });

    // 1. Prioridad: Super Admin (independiente del dominio)
    if (userRoles.includes('super_admin')) {
      console.log('[LAYOUT RESOLVER] Usuario es super_admin, usando layout super-admin');
      return {
        name: 'super-admin',
        component: 'SuperAdminLayoutComponent',
        route: '/superadmin',
        allowedRoles: ['super_admin']
      };
    }

    // 2. Resolución basada en entorno del dominio
    const layout = this.resolveByDomainEnvironment(domainConfig, userRoles);
    if (layout) {
      console.log('[LAYOUT RESOLVER] Layout resuelto por entorno:', layout.name);
      return layout;
    }

    // 3. Fallback inteligente basado en roles
    const fallbackLayout = this.getFallbackLayout(userRoles);
    console.log('[LAYOUT RESOLVER] Usando fallback layout:', fallbackLayout.name);
    return fallbackLayout;
  }

  /**
   * Resuelve layout basado en el entorno del dominio
   */
  private resolveByDomainEnvironment(
    domainConfig: DomainConfig,
    userRoles: string[]
  ): LayoutConfig | null {
    switch (domainConfig.environment) {
      case AppEnvironment.VENDIX_ADMIN:
        return {
          name: 'super-admin',
          component: 'SuperAdminLayoutComponent',
          route: '/superadmin',
          allowedRoles: ['super_admin']
        };

      case AppEnvironment.ORG_ADMIN:
        // Para organización, permitir roles administrativos
        const orgAdminRoles = ['owner', 'admin', 'manager'];
        if (userRoles.some(role => orgAdminRoles.includes(role))) {
          return {
            name: 'organization-admin',
            component: 'OrganizationAdminLayoutComponent',
            route: '/admin',
            allowedRoles: orgAdminRoles
          };
        }
        break;

      case AppEnvironment.STORE_ADMIN:
        // Para tienda, permitir roles de gestión de tienda
        const storeAdminRoles = ['owner', 'admin', 'manager', 'supervisor', 'employee'];
        if (userRoles.some(role => storeAdminRoles.includes(role))) {
          return {
            name: 'store-admin',
            component: 'StoreAdminLayoutComponent',
            route: '/admin',
            allowedRoles: storeAdminRoles
          };
        }
        break;

      case AppEnvironment.STORE_ECOMMERCE:
        // Para ecommerce, cliente o empleado
        const ecommerceRoles = ['customer', 'employee'];
        if (userRoles.some(role => ecommerceRoles.includes(role))) {
          return {
            name: 'store-ecommerce',
            component: 'StoreEcommerceLayoutComponent',
            route: '/account',
            allowedRoles: ecommerceRoles
          };
        }
        break;

      case AppEnvironment.ORG_LANDING:
      case AppEnvironment.VENDIX_LANDING:
        // Para landings, no hay layout específico de admin
        console.log('[LAYOUT RESOLVER] Entorno de landing, sin layout de admin específico');
        break;
    }

    return null;
  }

  /**
   * Layout de fallback inteligente basado en roles
   */
  private getFallbackLayout(userRoles: string[]): LayoutConfig {
    // Priorizar por nivel de acceso
    if (userRoles.includes('owner') || userRoles.includes('admin')) {
      return {
        name: 'organization-admin',
        component: 'OrganizationAdminLayoutComponent',
        route: '/admin',
        allowedRoles: ['owner', 'admin', 'manager']
      };
    }

    if (userRoles.includes('manager') || userRoles.includes('supervisor')) {
      return {
        name: 'store-admin',
        component: 'StoreAdminLayoutComponent',
        route: '/admin',
        allowedRoles: ['manager', 'supervisor', 'employee']
      };
    }

    if (userRoles.includes('employee')) {
      return {
        name: 'store-admin',
        component: 'StoreAdminLayoutComponent',
        route: '/admin',
        allowedRoles: ['employee']
      };
    }

    if (userRoles.includes('customer')) {
      return {
        name: 'store-ecommerce',
        component: 'StoreEcommerceLayoutComponent',
        route: '/account',
        allowedRoles: ['customer']
      };
    }

    // Fallback mínimo - redirigir a landing
    console.warn('[LAYOUT RESOLVER] No se pudo determinar layout, usando fallback mínimo');
    return {
      name: 'public',
      component: 'PublicLayoutComponent',
      route: '/',
      allowedRoles: []
    };
  }

  /**
   * Verifica si un usuario tiene acceso a un layout específico
   */
  hasAccessToLayout(layout: LayoutConfig, userRoles: string[]): boolean {
    if (layout.allowedRoles.length === 0) return true; // Layout público
    
    return userRoles.some(role => layout.allowedRoles.includes(role));
  }

  /**
   * Obtiene todos los layouts disponibles para un usuario
   */
  getAvailableLayouts(userRoles: string[], domainConfig: DomainConfig): LayoutConfig[] {
    const allLayouts: LayoutConfig[] = [
      {
        name: 'super-admin',
        component: 'SuperAdminLayoutComponent',
        route: '/superadmin',
        allowedRoles: ['super_admin']
      },
      {
        name: 'organization-admin',
        component: 'OrganizationAdminLayoutComponent',
        route: '/admin',
        allowedRoles: ['owner', 'admin', 'manager']
      },
      {
        name: 'store-admin',
        component: 'StoreAdminLayoutComponent',
        route: '/admin',
        allowedRoles: ['owner', 'admin', 'manager', 'supervisor', 'employee']
      },
      {
        name: 'store-ecommerce',
        component: 'StoreEcommerceLayoutComponent',
        route: '/account',
        allowedRoles: ['customer', 'employee']
      }
    ];

    return allLayouts.filter(layout => 
      this.hasAccessToLayout(layout, userRoles) && 
      this.isLayoutAllowedInDomain(layout, domainConfig)
    );
  }

  /**
   * Verifica si un layout está permitido en el dominio actual
   */
  private isLayoutAllowedInDomain(layout: LayoutConfig, domainConfig: DomainConfig): boolean {
    // Super admin solo en dominios de Vendix
    if (layout.name === 'super-admin') {
      return domainConfig.isVendixDomain && 
             domainConfig.environment === AppEnvironment.VENDIX_ADMIN;
    }

    // Organization admin en dominios de organización
    if (layout.name === 'organization-admin') {
      return domainConfig.domainType === DomainType.ORGANIZATION &&
             domainConfig.environment === AppEnvironment.ORG_ADMIN;
    }

    // Store admin en dominios de tienda
    if (layout.name === 'store-admin') {
      return (domainConfig.domainType === DomainType.STORE || 
              domainConfig.domainType === DomainType.ECOMMERCE) &&
             domainConfig.environment === AppEnvironment.STORE_ADMIN;
    }

    // Store ecommerce en dominios de ecommerce
    if (layout.name === 'store-ecommerce') {
      return domainConfig.domainType === DomainType.ECOMMERCE &&
             domainConfig.environment === AppEnvironment.STORE_ECOMMERCE;
    }

    return true;
  }
}