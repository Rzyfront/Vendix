import { Injectable, inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment, Router, UrlTree } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AppConfigService } from '../services/app-config.service';
import { DomainConfig, AppEnvironment, DomainType } from '../models/domain-config.interface';

/**
 * DomainGuard - Guard unificado para manejo de dominios y entornos
 * Reemplaza: EnvMatchGuard + DomainAppGuard
 */
@Injectable({ providedIn: 'root' })
export class DomainGuardService {
  constructor(
    private appConfig: AppConfigService,
    private router: Router
  ) {}

  /**
   * Maneja la lógica principal del guard
   */
  async canMatch(route: Route, segments: UrlSegment[]): Promise<boolean | UrlTree> {
    try {
      // Si la aplicación no está inicializada, permitir el acceso para que se inicialice
      if (!this.appConfig.isInitialized()) {
        console.log('[DOMAIN GUARD] App not initialized, allowing access for initialization');
        return true;
      }

      const appConfig = this.appConfig.getCurrentConfig();
      
      if (!appConfig) {
        console.warn('[DOMAIN GUARD] No app config available, allowing access');
        return true;
      }

      const currentPath = this.buildPathFromSegments(segments);
      const atRoot = segments.length === 0;

      console.log('[DOMAIN GUARD] Checking access:', {
        environment: appConfig.environment,
        currentPath,
        atRoot,
        routeData: route.data
      });

      // Verificar si el entorno actual coincide con los entornos permitidos en la ruta
      if (route.data?.['environments']) {
        const allowedEnvironments = route.data['environments'] as AppEnvironment[];
        if (!allowedEnvironments.includes(appConfig.environment)) {
          console.log('[DOMAIN GUARD] Environment mismatch, redirecting to default');
          return this.redirectToDefaultRoute(appConfig.environment);
        }
      }

      // Manejar redirección desde raíz basada en el entorno
      if (atRoot) {
        const redirectUrl = this.getRootRedirectUrl(appConfig.environment, appConfig.domainConfig);
        if (redirectUrl && redirectUrl !== '/') {
          console.log('[DOMAIN GUARD] Redirecting from root to:', redirectUrl);
          return this.router.parseUrl(redirectUrl);
        }
      }

      // Verificar acceso basado en el contexto del dominio
      const hasDomainAccess = await this.checkDomainAccess(appConfig.domainConfig, currentPath);
      if (!hasDomainAccess) {
        console.log('[DOMAIN GUARD] Domain access denied, redirecting to default');
        return this.redirectToDefaultRoute(appConfig.environment);
      }

      return true;

    } catch (error) {
      console.error('[DOMAIN GUARD] Error checking domain access:', error);
      // En caso de error, permitir el acceso y dejar que la aplicación maneje el error
      return true;
    }
  }

  /**
   * Construye el path completo desde los segmentos
   */
  private buildPathFromSegments(segments: UrlSegment[]): string {
    return segments.length > 0 ? '/' + segments.map(s => s.path).join('/') : '/';
  }

  /**
   * Obtiene la URL de redirección para la raíz basada en el entorno
   */
  private getRootRedirectUrl(environment: AppEnvironment, domainConfig: DomainConfig): string | null {
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return null; // Mantener en raíz para landing

      case AppEnvironment.VENDIX_ADMIN:
        return '/superadmin';

      case AppEnvironment.ORG_LANDING:
        return null; // Mantener en raíz para landing organizacional

      case AppEnvironment.ORG_ADMIN:
        return '/admin';

      case AppEnvironment.STORE_ADMIN:
        return '/admin';

      case AppEnvironment.STORE_ECOMMERCE:
        return '/shop';

      default:
        return null;
    }
  }

  /**
   * Verifica el acceso basado en el dominio y contexto
   */
  private async checkDomainAccess(domainConfig: DomainConfig, currentPath: string): Promise<boolean> {
    // Verificar si el dominio es válido para el contexto actual
    if (!this.isValidDomainContext(domainConfig, currentPath)) {
      return false;
    }

    // Verificar restricciones específicas por tipo de dominio
    return this.checkDomainRestrictions(domainConfig, currentPath);
  }

  /**
   * Verifica si el dominio es válido para el contexto actual
   */
  private isValidDomainContext(domainConfig: DomainConfig, currentPath: string): boolean {
    // Para dominios de Vendix, permitir acceso a todas las rutas
    if (domainConfig.isVendixDomain) {
      return true;
    }

    // Para organizaciones, restringir acceso a rutas de super admin
    if (domainConfig.domainType === DomainType.ORGANIZATION &&
        currentPath.startsWith('/superadmin')) {
      return false;
    }

    // Para tiendas, restringir acceso a rutas de super admin y admin de organización
    if (domainConfig.domainType === DomainType.STORE ||
        domainConfig.domainType === DomainType.ECOMMERCE) {
      if (currentPath.startsWith('/superadmin') ||
          currentPath.startsWith('/admin/tenants')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verifica restricciones específicas por dominio
   */
  private checkDomainRestrictions(domainConfig: DomainConfig, currentPath: string): boolean {
    // Verificar si la organización tiene acceso a características específicas
    if (domainConfig.environment === AppEnvironment.ORG_ADMIN) {
      // Verificar si la organización tiene acceso a multi-store si intenta acceder a rutas de stores
      if (currentPath.startsWith('/admin/stores') && !this.hasMultiStoreAccess(domainConfig)) {
        return false;
      }
    }

    // Verificar si la tienda tiene acceso a POS si intenta acceder a rutas de POS
    if (domainConfig.environment === AppEnvironment.STORE_ADMIN && 
        currentPath.startsWith('/pos') && !this.hasPOSAccess(domainConfig)) {
      return false;
    }

    return true;
  }

  /**
   * Verifica si la organización tiene acceso a multi-store
   */
  private hasMultiStoreAccess(domainConfig: DomainConfig): boolean {
    // Esta lógica debería venir de la configuración del tenant
    // Por ahora, asumimos que todas las organizaciones tienen acceso
    return true;
  }

  /**
   * Verifica si la tienda tiene acceso a POS
   */
  private hasPOSAccess(domainConfig: DomainConfig): boolean {
    // Esta lógica debería venir de la configuración del tenant
    // Por ahora, asumimos que todas las tiendas tienen acceso
    return true;
  }

  /**
   * Redirige a la ruta por defecto para el entorno
   */
  private redirectToDefaultRoute(environment: AppEnvironment): UrlTree {
    let defaultRoute = '/';

    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        defaultRoute = '/';
        break;
      case AppEnvironment.VENDIX_ADMIN:
        defaultRoute = '/superadmin';
        break;
      case AppEnvironment.ORG_LANDING:
        defaultRoute = '/';
        break;
      case AppEnvironment.ORG_ADMIN:
        defaultRoute = '/admin';
        break;
      case AppEnvironment.STORE_ADMIN:
        defaultRoute = '/admin';
        break;
      case AppEnvironment.STORE_ECOMMERCE:
        defaultRoute = '/shop';
        break;
    }

    return this.router.parseUrl(defaultRoute);
  }

  /**
   * Obtiene información del dominio para logging
   */
  getDomainInfo(): { environment: string; domainType: string; isVendix: boolean } {
    const config = this.appConfig.getCurrentConfig();
    if (!config) {
      return { environment: 'unknown', domainType: 'unknown', isVendix: false };
    }

    return {
      environment: config.environment,
      domainType: config.domainConfig.domainType,
      isVendix: config.domainConfig.isVendixDomain
    };
  }
}

/**
 * Función guard canMatch exportada
 */
export const DomainGuard: CanMatchFn = (
  route: Route,
  segments: UrlSegment[]
): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree => {
  const service = inject(DomainGuardService);
  return service.canMatch(route, segments);
};