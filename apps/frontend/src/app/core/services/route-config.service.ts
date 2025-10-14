import { Injectable } from '@angular/core';
import { Routes } from '@angular/router';
import { AppResolverService, AppConfig, RouteConfig } from './app-resolver.service';
import { DomainDetectorService } from './domain-detector.service';
import { AppEnvironment } from '../models/domain-config.interface';

// Guards imports
import { AdminGuard } from '../guards/admin.guard';
import { POSGuard } from '../guards/pos.guard';
import { SuperAdminGuard } from '../guards/super-admin.guard';
import { LayoutAccessGuard } from '../guards/layout-access.guard';
import { AuthGuard } from '../guards/auth.guard';

@Injectable({
  providedIn: 'root'
})
export class RouteConfigService {
  private currentRoutes: Routes = [];
  private appConfig: AppConfig | null = null;

  constructor(
    private appResolver: AppResolverService,
    private domainDetector: DomainDetectorService
  ) {}

  /**
   * Configura las rutas dinámicamente basadas en la configuración de la aplicación
   */
  async configureRoutes(): Promise<Routes> {
    try {
      this.appConfig = await this.appResolver.resolveAppConfiguration();
      this.currentRoutes = this.buildRoutesFromConfig(this.appConfig);
      
      console.log('[ROUTE CONFIG] Routes configured successfully:', {
        environment: this.appConfig.environment,
        publicRoutes: this.appConfig.publicRoutes.length,
        privateRoutes: this.appConfig.privateRoutes.length,
        totalRoutes: this.currentRoutes.length
      });

      return this.currentRoutes;
    } catch (error) {
      console.error('[ROUTE CONFIG] Error configuring routes:', error);
      return this.getFallbackRoutes();
    }
  }

  /**
   * Construye las rutas de Angular desde la configuración de la aplicación
   */
  private buildRoutesFromConfig(config: AppConfig): Routes {
    const routes: Routes = [];

    // Agregar rutas públicas
    config.publicRoutes.forEach(routeConfig => {
      const route = this.buildRoute(routeConfig, false);
      if (route) routes.push(route);
    });

    // Agregar rutas privadas
    config.privateRoutes.forEach(routeConfig => {
      const route = this.buildRoute(routeConfig, true);
      if (route) routes.push(route);
    });

    // Agregar rutas de módulos lazy loading
    config.modules.forEach(moduleConfig => {
      const route = this.buildLazyModuleRoute(moduleConfig);
      if (route) routes.push(route);
    });

    // Agregar ruta wildcard (404)
    routes.push({
      path: '**',
      redirectTo: this.getDefaultRouteForEnvironment(config.environment)
    });

    return routes;
  }

  /**
   * Construye una ruta individual desde la configuración
   */
  private buildRoute(routeConfig: RouteConfig, isPrivate: boolean): any {
    const route: any = {
      path: routeConfig.path
    };

    // Configurar componente (será reemplazado con componentes reales durante la migración)
    if (routeConfig.component) {
      route.component = this.getComponentReference(routeConfig.component);
    }

    // Configurar guards
    const guards = this.resolveGuards(routeConfig.guards || [], isPrivate);
    if (guards.length > 0) {
      route.canActivate = guards;
    }

    // Configurar datos adicionales
    if (routeConfig.data || routeConfig.layout) {
      route.data = {
        ...routeConfig.data,
        layout: routeConfig.layout
      };
    }

    return route;
  }

  /**
   * Construye una ruta para módulo lazy loading
   */
  private buildLazyModuleRoute(moduleConfig: any): any {
    const route: any = {
      path: moduleConfig.path.startsWith('/') ? moduleConfig.path.slice(1) : moduleConfig.path
    };

    // Configurar lazy loading (será implementado con módulos reales durante la migración)
    route.loadChildren = () => this.getModuleReference(moduleConfig.name);

    // Configurar guards para módulos privados
    if (moduleConfig.allowedRoles.length > 0) {
      route.canActivate = this.resolveModuleGuards(moduleConfig.allowedRoles);
      route.data = {
        allowedRoles: moduleConfig.allowedRoles,
        layout: this.getLayoutForModule(moduleConfig.name)
      };
    }

    return route;
  }

  /**
   * Resuelve los guards para una ruta
   */
  private resolveGuards(guardNames: string[], isPrivate: boolean): any[] {
    const guards: any[] = [];

    // Agregar guards específicos
    guardNames.forEach(guardName => {
      const guard = this.getGuardReference(guardName);
      if (guard) guards.push(guard);
    });

    // Agregar guard de autenticación para rutas privadas
    if (isPrivate && !guardNames.includes('AuthGuard')) {
      guards.push(AuthGuard);
    }

    return guards;
  }

  /**
   * Resuelve los guards para un módulo basado en roles permitidos
   */
  private resolveModuleGuards(allowedRoles: string[]): any[] {
    const guards: any[] = [AuthGuard];

    // Determinar guards específicos basados en roles
    if (allowedRoles.includes('super_admin')) {
      guards.push(SuperAdminGuard);
    } else if (allowedRoles.some(role => ['owner', 'admin', 'manager'].includes(role))) {
      guards.push(AdminGuard);
    } else if (allowedRoles.some(role => ['supervisor', 'employee'].includes(role))) {
      guards.push(POSGuard);
    }

    // Siempre agregar LayoutAccessGuard para rutas con layout
    guards.push(LayoutAccessGuard);

    return guards;
  }

  /**
   * Obtiene la referencia a un guard por nombre
   */
  private getGuardReference(guardName: string): any {
    const guardMap: { [key: string]: any } = {
      'AdminGuard': AdminGuard,
      'POSGuard': POSGuard,
      'SuperAdminGuard': SuperAdminGuard,
      'LayoutAccessGuard': LayoutAccessGuard,
      'AuthGuard': AuthGuard
    };

    return guardMap[guardName] || null;
  }

  /**
   * Obtiene la referencia a un componente por nombre (placeholder para migración)
   */
  private getComponentReference(componentName: string): any {
    // Esto será reemplazado con imports reales durante la migración
    console.log(`[ROUTE CONFIG] Component reference needed: ${componentName}`);
    return null; // Temporal - se implementará durante la migración
  }

  /**
   * Obtiene la referencia a un módulo por nombre (placeholder para migración)
   */
  private getModuleReference(moduleName: string): any {
    // Esto será reemplazado con imports reales durante la migración
    console.log(`[ROUTE CONFIG] Module reference needed: ${moduleName}`);
    return Promise.resolve({}); // Temporal - se implementará durante la migración
  }

  /**
   * Obtiene el layout apropiado para un módulo
   */
  private getLayoutForModule(moduleName: string): string {
    const layoutMap: { [key: string]: string } = {
      'super-admin': 'super-admin',
      'organization-admin': 'organization-admin',
      'store-admin': 'store-admin',
      'org-ecommerce': 'org-ecommerce',
      'store-ecommerce': 'store-ecommerce'
    };

    return layoutMap[moduleName] || 'default';
  }

  /**
   * Obtiene la ruta por defecto para un entorno
   */
  private getDefaultRouteForEnvironment(environment: AppEnvironment): string {
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
        return '/';
      default:
        return '/';
    }
  }

  /**
   * Rutas de fallback en caso de error
   */
  private getFallbackRoutes(): Routes {
    return [
      {
        path: '',
        redirectTo: '/auth/login',
        pathMatch: 'full'
      },
      {
        path: 'auth',
        loadChildren: () => import('../../public/auth/components/vendix/vendix-login.component').then(c => c.VendixLoginComponent)
      },
      {
        path: '**',
        redirectTo: '/auth/login'
      }
    ];
  }

  /**
   * Obtiene las rutas actualmente configuradas
   */
  getCurrentRoutes(): Routes {
    return this.currentRoutes;
  }

  /**
   * Obtiene la configuración actual de la aplicación
   */
  getCurrentAppConfig(): AppConfig | null {
    return this.appConfig;
  }

  /**
   * Verifica si una ruta está disponible en la configuración actual
   */
  isRouteAvailable(path: string): boolean {
    if (!this.appConfig) return false;

    const allRoutes = [...this.appConfig.publicRoutes, ...this.appConfig.privateRoutes];
    return allRoutes.some(route => route.path === path);
  }

  /**
   * Obtiene la configuración de una ruta específica
   */
  getRouteConfig(path: string): RouteConfig | null {
    if (!this.appConfig) return null;

    const allRoutes = [...this.appConfig.publicRoutes, ...this.appConfig.privateRoutes];
    return allRoutes.find(route => route.path === path) || null;
  }

  /**
   * Reinicia la configuración de rutas (útil para cambios de dominio)
   */
  async resetRoutes(): Promise<void> {
    this.currentRoutes = [];
    this.appConfig = null;
    await this.configureRoutes();
  }
}