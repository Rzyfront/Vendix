import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { DomainConfig, AppEnvironment, DomainType } from '../models/domain-config.interface';
import { TenantConfig } from '../models/tenant-config.interface';
import { LayoutResolverService, LayoutConfig } from './layout-resolver.service';

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private router = inject(Router);
  private layoutResolver = inject(LayoutResolverService);

  /**
   * Redirección inteligente después del login basada en rol y contexto
   */
  redirectAfterLogin(
    userRoles: string[],
    domainConfig: DomainConfig,
    tenantContext: TenantConfig | null
  ): string {
    console.log('[NAVIGATION SERVICE] Redirección post-login para:', {
      userRoles,
      domainEnvironment: domainConfig.environment,
      tenantContext: tenantContext ? 'present' : 'null'
    });

    // 1. Resolver el layout apropiado
    const layout = this.layoutResolver.resolveLayout(domainConfig, userRoles, tenantContext);
    
    if (!layout) {
      console.warn('[NAVIGATION SERVICE] No se pudo resolver layout, usando fallback');
      return this.getFallbackRoute(userRoles);
    }

    console.log('[NAVIGATION SERVICE] Layout resuelto:', layout.name, 'ruta:', layout.route);
    return layout.route;
  }

  /**
   * Navega a la ruta apropiada después del login
   */
  navigateAfterLogin(
    userRoles: string[],
    domainConfig: DomainConfig,
    tenantContext: TenantConfig | null
  ): string {
    const targetRoute = this.redirectAfterLogin(userRoles, domainConfig, tenantContext);
    console.log('[NAVIGATION SERVICE] Ruta objetivo para navegación:', targetRoute);
    return targetRoute;
  }

  /**
   * Redirección inteligente cuando el dominio no coincide con el contexto del usuario
   */
  redirectToAppropriateDomain(
    userRoles: string[],
    currentDomainConfig: DomainConfig,
    tenantContext: TenantConfig | null
  ): string {
    console.log('[NAVIGATION SERVICE] Redireccionando a dominio apropiado para:', userRoles);

    // 1. Super admin siempre va a Vendix Admin
    if (userRoles.includes('super_admin')) {
      if (currentDomainConfig.environment !== AppEnvironment.VENDIX_ADMIN) {
        console.log('[NAVIGATION SERVICE] Super admin redirigido a Vendix Admin');
        return '/superadmin';
      }
      return '/superadmin';
    }

    // 2. Usuario en dominio incorrecto - redirigir al dominio apropiado
    const appropriateDomain = this.getAppropriateDomainForUser(userRoles, tenantContext);
    if (appropriateDomain && appropriateDomain !== currentDomainConfig.hostname) {
      console.log('[NAVIGATION SERVICE] Redirigiendo a dominio:', appropriateDomain);
      // En un escenario real, aquí harías window.location.href = appropriateDomain
      // Por ahora, redirigimos a la ruta apropiada en el dominio actual
      return this.redirectAfterLogin(userRoles, currentDomainConfig, tenantContext);
    }

    // 3. Mantener en dominio actual con ruta apropiada
    return this.redirectAfterLogin(userRoles, currentDomainConfig, tenantContext);
  }

  /**
   * Obtiene el dominio apropiado para un usuario basado en sus roles
   */
  private getAppropriateDomainForUser(
    userRoles: string[], 
    tenantContext: TenantConfig | null
  ): string | null {
    // Esta lógica debería venir de la configuración del tenant
    // Por ahora, devolvemos null para mantener el dominio actual
    
    if (userRoles.includes('super_admin')) {
      return 'admin.vendix.com'; // Dominio de admin de Vendix
    }

    if (tenantContext?.organization?.domains?.adminUrls?.[0]) {
      return tenantContext.organization.domains.adminUrls[0];
    }

    return null;
  }

  /**
   * Ruta de fallback cuando no se puede determinar la ruta óptima
   */
  private getFallbackRoute(userRoles: string[]): string {
    // Priorizar por nivel de acceso
    if (userRoles.includes('super_admin')) {
      return '/superadmin';
    }

    if (userRoles.includes('owner') || userRoles.includes('admin') || userRoles.includes('manager')) {
      return '/admin';
    }

    if (userRoles.includes('customer')) {
      return '/account';
    }

    if (userRoles.includes('employee') || userRoles.includes('supervisor')) {
      return '/admin';
    }

    // Fallback absoluto - dashboard principal
    console.warn('[NAVIGATION SERVICE] Usando fallback absoluto a /admin');
    return '/admin';
  }

  /**
   * Redirección para acceso denegado
   */
  redirectToAccessDenied(returnUrl?: string): Promise<boolean> {
    console.log('[NAVIGATION SERVICE] Redirigiendo a acceso denegado');
    const queryParams = returnUrl ? { returnUrl } : {};
    return this.router.navigate(['/access-denied'], { queryParams });
  }

  /**
   * Redirección para página no encontrada
   */
  redirectToNotFound(): Promise<boolean> {
    console.log('[NAVIGATION SERVICE] Redirigiendo a página no encontrada');
    return this.router.navigateByUrl('/not-found');
  }

  /**
   * Redirección al login contextual
   */
  redirectToLogin(returnUrl?: string): Promise<boolean> {
    console.log('[NAVIGATION SERVICE] Redirigiendo a login');
    const queryParams = returnUrl ? { returnUrl } : {};
    return this.router.navigate(['/auth/login'], { queryParams });
  }

  /**
   * Verifica si una ruta es accesible para el usuario actual
   */
  isRouteAccessible(routePath: string, userRoles: string[], domainConfig: DomainConfig): boolean {
    // Rutas públicas siempre accesibles
    const publicRoutes = ['/auth/login', '/auth/register', '/auth/forgot-password', '/'];
    if (publicRoutes.includes(routePath)) {
      return true;
    }

    // Rutas de super admin solo para super_admin
    if (routePath.startsWith('/superadmin') && !userRoles.includes('super_admin')) {
      return false;
    }

    // Rutas de admin para roles administrativos
    if (routePath.startsWith('/admin')) {
      const adminRoles = ['super_admin', 'admin', 'owner', 'manager'];
      if (!userRoles.some(role => adminRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de POS para empleados y supervisores
    if (routePath.startsWith('/pos')) {
      const posRoles = ['supervisor', 'employee'];
      if (!userRoles.some(role => posRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de cuenta de cliente
    if (routePath.startsWith('/account')) {
      if (!userRoles.includes('customer')) {
        return false;
      }
    }

    // Verificar restricciones de dominio
    return this.isRouteAllowedInDomain(routePath, domainConfig);
  }

  /**
   * Verifica si una ruta está permitida en el dominio actual
   */
  private isRouteAllowedInDomain(routePath: string, domainConfig: DomainConfig): boolean {
    // Dominios de Vendix permiten todas las rutas
    if (domainConfig.isVendixDomain) {
      return true;
    }

    // Organizaciones no pueden acceder a rutas de super admin
    if (domainConfig.domainType === DomainType.ORGANIZATION &&
        routePath.startsWith('/superadmin')) {
      return false;
    }

    // Tiendas no pueden acceder a rutas de super admin ni admin de organización
    if ((domainConfig.domainType === DomainType.STORE || 
         domainConfig.domainType === DomainType.ECOMMERCE) &&
        (routePath.startsWith('/superadmin') || 
         routePath.startsWith('/admin/tenants'))) {
      return false;
    }

    return true;
  }

  /**
   * Obtiene la ruta por defecto para un entorno específico
   */
  getDefaultRouteForEnvironment(environment: AppEnvironment): string {
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return '/';
      case AppEnvironment.VENDIX_ADMIN:
        return '/superadmin';
      case AppEnvironment.ORG_LANDING:
        return '/';
      case AppEnvironment.ORG_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ADMIN:
        return '/admin';
      case AppEnvironment.STORE_ECOMMERCE:
        return '/shop';
      default:
        return '/';
    }
  }
}