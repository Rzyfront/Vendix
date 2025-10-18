import { Injectable, Injector } from '@angular/core';
import { Routes, Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppConfigService, RouteConfig, LayoutConfig } from './app-config.service';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';

// Guards imports - simplified
import { DomainGuard } from '../guards/domain.guard';
import { AuthGuard } from '../guards/auth.guard';


// Component imports for dynamic loading
import { VendixLandingComponent } from '../../public/landing/vendix-landing/vendix-landing.component';
import { OrgLandingComponent } from '../../public/dynamic-landing/components/org-landing/org-landing.component';
import { StoreLandingComponent } from '../../public/dynamic-landing/components/store-landing/store-landing.component';
import { StorefrontComponent } from '../../public/ecommerce/components/storefront/storefront.component';
// Importaciones de componentes modulares
import { DashboardComponent as SuperAdminDashboardComponent } from '../../private/modules/super-admin/dashboard/dashboard.component';
import { OrganizationsComponent as OrganizationsManagementComponent } from '../../private/modules/super-admin/organizations/organizations.component';
import { DashboardComponent as OrganizationDashboardComponent } from '../../private/modules/organization/dashboard/dashboard.component';
import { DashboardComponent as StoreDashboardComponent } from '../../private/modules/store/dashboard/dashboard.component';

// Layout components - Only include existing components
import { OrganizationAdminLayoutComponent } from '../../private/layouts/organization-admin/organization-admin-layout.component';
import { StoreAdminLayoutComponent } from '../../private/layouts/store-admin/store-admin-layout.component';

export interface DynamicRoute {
  path: string;
  component: any;
  layout?: any;
  guards?: any[];
  data?: any;
}

@Injectable({
  providedIn: 'root'
})
export class RouteManagerService {
  private currentRoutesSubject = new BehaviorSubject<Routes>([]);
  public currentRoutes$ = this.currentRoutesSubject.asObservable();
  
  private componentRegistry = new Map<string, any>();
  private layoutRegistry = new Map<string, any>();
  private guardRegistry = new Map<string, any>();

  constructor(
    private appConfig: AppConfigService,
    private router: Router,
    private injector: Injector
  ) {
    this.initializeRegistries();
  }

  /**
   * Inicializa los registros de componentes, layouts y guards
   */
  private initializeRegistries(): void {
    // Registrar componentes
    this.registerComponents();
    
    // Registrar layouts
    this.registerLayouts();
    
    // Registrar guards
    this.registerGuards();
  }

  /**
   * Registra todos los componentes disponibles
   */
  private registerComponents(): void {
    // Public components
    this.componentRegistry.set('VendixLandingComponent', VendixLandingComponent);
    this.componentRegistry.set('OrgLandingComponent', OrgLandingComponent);
    this.componentRegistry.set('StoreLandingComponent', StoreLandingComponent);
    this.componentRegistry.set('StorefrontComponent', StorefrontComponent);
    
    // Super Admin components
    this.componentRegistry.set('SuperAdminDashboardComponent', SuperAdminDashboardComponent);
    this.componentRegistry.set('OrganizationsManagementComponent', OrganizationsManagementComponent);
    
    // Organization Admin components
    this.componentRegistry.set('OrgAdminDashboardComponent', OrganizationDashboardComponent);
    
    // Store Admin components
    this.componentRegistry.set('StoreAdminDashboardComponent', StoreDashboardComponent);
    
    // E-commerce components - using existing dashboard components
    this.componentRegistry.set('StoreEcommerceComponent', StoreDashboardComponent);
    this.componentRegistry.set('OrgEcommerceComponent', OrganizationDashboardComponent);
    
    // Auth components - consolidated contextual login
    this.componentRegistry.set('ContextualLoginComponent', () =>
      import('../../public/auth/components/contextual-login/contextual-login.component').then(c => c.ContextualLoginComponent));
  }

  /**
   * Registra todos los layouts disponibles
   */
  private registerLayouts(): void {
    this.layoutRegistry.set('super-admin', () =>
      import('../../private/layouts/organization-admin/organization-admin-layout.component').then(c => c.OrganizationAdminLayoutComponent)
    );
    this.layoutRegistry.set('organization-admin', OrganizationAdminLayoutComponent);
    this.layoutRegistry.set('store-admin', StoreAdminLayoutComponent);
    
    // Register remaining layouts with dynamic imports
    this.layoutRegistry.set('store-ecommerce', () =>
      import('../../private/layouts/store-admin/store-admin-layout.component').then(c => c.StoreAdminLayoutComponent)
    );
    this.layoutRegistry.set('org-ecommerce', () =>
      import('../../private/layouts/organization-admin/organization-admin-layout.component').then(c => c.OrganizationAdminLayoutComponent)
    );
    this.layoutRegistry.set('auth', () =>
      import('../../private/layouts/organization-admin/organization-admin-layout.component').then(c => c.OrganizationAdminLayoutComponent)
    );
    this.layoutRegistry.set('public', () =>
      import('../../private/layouts/organization-admin/organization-admin-layout.component').then(c => c.OrganizationAdminLayoutComponent)
    );
    this.layoutRegistry.set('storefront', () =>
      import('../../private/layouts/store-admin/store-admin-layout.component').then(c => c.StoreAdminLayoutComponent)
    );
  }

  /**
   * Registra todos los guards disponibles
   */
  private registerGuards(): void {
    this.guardRegistry.set('DomainGuard', DomainGuard);
    this.guardRegistry.set('AuthGuard', AuthGuard);

  }

  /**
   * Configura las rutas dinámicamente basadas en la configuración de la aplicación
   */
  async configureDynamicRoutes(): Promise<Routes> {
    try {
      const appConfig = this.appConfig.getCurrentConfig();
      
      if (!appConfig) {
        console.warn('[ROUTE MANAGER] App config not available, using fallback routes');
        return this.getFallbackRoutes();
      }

      console.log('[ROUTE MANAGER] Configuring dynamic routes for environment:', appConfig.environment);

      const dynamicRoutes = this.buildDynamicRoutes(appConfig);
      this.currentRoutesSubject.next(dynamicRoutes);

      console.log('[ROUTE MANAGER] Routes configured successfully:', {
        environment: appConfig.environment,
        totalRoutes: dynamicRoutes.length,
        publicRoutes: dynamicRoutes.filter(r => r.data?.['isPublic']).length,
        privateRoutes: dynamicRoutes.filter(r => !r.data?.['isPublic']).length
      });

      return dynamicRoutes;

    } catch (error) {
      console.error('[ROUTE MANAGER] Error configuring routes:', error);
      return this.getFallbackRoutes();
    }
  }

  /**
   * Construye las rutas dinámicas desde la configuración
   */
  private buildDynamicRoutes(appConfig: any): Routes {
    const routes: Routes = [];

    // Agregar rutas públicas
    appConfig.routes
      .filter((route: RouteConfig) => route.isPublic)
      .forEach((routeConfig: RouteConfig) => {
        const route = this.buildRoute(routeConfig, false);
        if (route) routes.push(route);
      });

    // Agregar rutas privadas
    appConfig.routes
      .filter((route: RouteConfig) => !route.isPublic)
      .forEach((routeConfig: RouteConfig) => {
        const route = this.buildRoute(routeConfig, true);
        if (route) routes.push(route);
      });

    // Agregar ruta wildcard (404)
    routes.push({
      path: '**',
      redirectTo: this.getDefaultRouteForEnvironment(appConfig.environment)
    });

    return routes;
  }

  /**
   * Construye una ruta individual desde la configuración
   */
  private buildRoute(routeConfig: RouteConfig, isPrivate: boolean): any {
    const component = this.getComponentReference(routeConfig.component);
    
    if (!component) {
      console.warn(`[ROUTE MANAGER] Component not found: ${routeConfig.component}`);
      return null;
    }

    const route: any = {
      path: routeConfig.path,
      component: component
    };

    // Configurar layout si está especificado
    if (routeConfig.layout) {
      const layout = this.getLayoutReference(routeConfig.layout);
      if (layout) {
        route.component = layout;
        // El componente real se pasa como data para que el layout lo renderice
        route.data = {
          ...routeConfig.data,
          component: component,
          layout: routeConfig.layout,
          isPublic: !isPrivate
        };
      }
    } else {
      route.data = {
        ...routeConfig.data,
        isPublic: !isPrivate
      };
    }

    // Configurar guards
    const guards = this.resolveGuards(routeConfig.guards || [], isPrivate);
    if (guards.length > 0) {
      route.canActivate = guards;
    }

    return route;
  }

  /**
   * Obtiene la referencia a un componente por nombre
   */
  private getComponentReference(componentName: string): any {
    return this.componentRegistry.get(componentName) || null;
  }

  /**
   * Obtiene la referencia a un layout por nombre
   */
  private getLayoutReference(layoutName: string): any {
    return this.layoutRegistry.get(layoutName) || null;
  }

  /**
   * Resuelve los guards para una ruta
   */
  private resolveGuards(guardNames: string[], isPrivate: boolean): any[] {
    const guards: any[] = [];

    // Agregar guards específicos
    guardNames.forEach(guardName => {
      const guard = this.guardRegistry.get(guardName);
      if (guard) guards.push(guard);
    });

    // Agregar guard de autenticación para rutas privadas
    if (isPrivate && !guardNames.includes('AuthGuard')) {
      guards.push(AuthGuard);
    }

    // Siempre agregar DomainGuard para rutas raíz
    if (guardNames.includes('DomainGuard') || this.shouldAddDomainGuard(guardNames)) {
      guards.push(DomainGuard);
    }

    return guards;
  }

  /**
   * Determina si se debe agregar DomainGuard
   */
  private shouldAddDomainGuard(guardNames: string[]): boolean {
    const domainSpecificGuards = ['SuperAdminGuard', 'AdminGuard', 'POSGuard'];
    return guardNames.some(guard => domainSpecificGuards.includes(guard));
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
        loadComponent: () => import('../../public/auth/components/contextual-login/contextual-login.component').then(c => c.ContextualLoginComponent)
      },
      {
        path: '**',
        redirectTo: '/auth/login'
      }
    ];
  }

  /**
   * Registra un componente dinámicamente
   */
  registerComponent(name: string, component: any): void {
    this.componentRegistry.set(name, component);
    console.log(`[ROUTE MANAGER] Component registered: ${name}`);
  }

  /**
   * Registra un layout dinámicamente
   */
  registerLayout(name: string, layout: any): void {
    this.layoutRegistry.set(name, layout);
    console.log(`[ROUTE MANAGER] Layout registered: ${name}`);
  }

  /**
   * Registra un guard dinámicamente
   */
  registerGuard(name: string, guard: any): void {
    this.guardRegistry.set(name, guard);
    console.log(`[ROUTE MANAGER] Guard registered: ${name}`);
  }

  /**
   * Obtiene las rutas actualmente configuradas
   */
  getCurrentRoutes(): Routes {
    return this.currentRoutesSubject.value;
  }

  /**
   * Verifica si una ruta está disponible
   */
  isRouteAvailable(path: string): boolean {
    const routes = this.getCurrentRoutes();
    return routes.some(route => route.path === path);
  }

  /**
   * Obtiene la configuración de una ruta específica
   */
  getRouteConfig(path: string): RouteConfig | null {
    const appConfig = this.appConfig.getCurrentConfig();
    if (!appConfig) return null;

    return appConfig.routes.find(route => route.path === path) || null;
  }

  /**
   * Obtiene el layout apropiado para un módulo
   */
  getLayoutForEnvironment(environment: AppEnvironment, userRoles: string[] = []): string {
    const appConfig = this.appConfig.getCurrentConfig();
    if (!appConfig) return 'public';

    const availableLayouts = appConfig.layouts.filter(layout => 
      layout.allowedEnvironments.includes(environment)
    );

    // Si no hay roles, retornar layout público
    if (userRoles.length === 0) {
      const publicLayout = availableLayouts.find(layout => layout.allowedRoles.length === 0);
      return publicLayout?.name || 'public';
    }

    // Buscar layout que coincida con los roles
    for (const layout of availableLayouts) {
      if (layout.allowedRoles.some(role => userRoles.includes(role))) {
        return layout.name;
      }
    }

    return 'public';
  }

  /**
   * Obtiene la URL de redirección post-login
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
   * Reinicia la configuración de rutas
   */
  async resetRoutes(): Promise<void> {
    this.currentRoutesSubject.next([]);
    await this.configureDynamicRoutes();
  }

  /**
   * Navega a una ruta específica con manejo de errores
   */
  async navigateTo(path: string, extras?: any): Promise<boolean> {
    try {
      if (!this.isRouteAvailable(path)) {
        console.warn(`[ROUTE MANAGER] Route not available: ${path}`);
        return false;
      }

      const success = await this.router.navigate([path], extras);
      
      if (!success) {
        console.warn(`[ROUTE MANAGER] Navigation failed for path: ${path}`);
        // Fallback to default route
        await this.router.navigate(['/']);
      }

      return success;
    } catch (error) {
      console.error(`[ROUTE MANAGER] Error navigating to ${path}:`, error);
      await this.router.navigate(['/']);
      return false;
    }
  }
}