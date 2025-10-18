import { Injectable, Injector } from '@angular/core';
import { Routes, Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppConfigService, RouteConfig, LayoutConfig } from './app-config.service';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';

// Guards imports
import { AuthGuard } from '../guards/auth.guard';

// Component imports for dynamic loading
import { VendixLandingComponent } from '../../public/landing/vendix-landing/vendix-landing.component';
import { OrgLandingComponent } from '../../public/dynamic-landing/components/org-landing/org-landing.component';
import { StoreLandingComponent } from '../../public/dynamic-landing/components/store-landing/store-landing.component';
import { StorefrontComponent } from '../../public/ecommerce/components/storefront/storefront.component';
import { DashboardComponent as SuperAdminDashboardComponent } from '../../private/modules/super-admin/dashboard/dashboard.component';
import { OrganizationsComponent as OrganizationsManagementComponent } from '../../private/modules/super-admin/organizations/organizations.component';
import { DashboardComponent as OrganizationDashboardComponent } from '../../private/modules/organization/dashboard/dashboard.component';
import { DashboardComponent as StoreDashboardComponent } from '../../private/modules/store/dashboard/dashboard.component';

// Auth components for static routes
import { ContextualLoginComponent } from '../../public/auth/components/contextual-login/contextual-login.component';
import { RegisterOwnerComponent } from '../../public/auth/components/register-owner/register-owner.component';
import { ForgotOwnerPasswordComponent } from '../../public/auth/components/forgot-owner-password/forgot-owner-password';
import { ResetOwnerPasswordComponent } from '../../public/auth/components/reset-owner-password/reset-owner-password';
import { EmailVerificationComponent } from '../../public/auth/components/email-verification/email-verification.component';

// Layout components
import { SuperAdminLayoutComponent } from '../../private/layouts/super-admin/super-admin-layout.component';
import { OrganizationAdminLayoutComponent } from '../../private/layouts/organization-admin/organization-admin-layout.component';
import { StoreAdminLayoutComponent } from '../../private/layouts/store-admin/store-admin-layout.component';
// Assuming other layouts exist at these paths
// import { PublicLayoutComponent } from '../../public/layouts/public-layout/public-layout.component';
// import { AuthLayoutComponent } from '../../public/layouts/auth-layout/auth-layout.component';

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
    this.registerComponents();
    this.registerLayouts();
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
    
    // E-commerce components
    this.componentRegistry.set('StoreEcommerceComponent', StorefrontComponent);
    this.componentRegistry.set('OrgEcommerceComponent', OrgLandingComponent);
    
    // Auth components - always available
    this.componentRegistry.set('ContextualLoginComponent', ContextualLoginComponent);
    this.componentRegistry.set('RegisterOwnerComponent', RegisterOwnerComponent);
    this.componentRegistry.set('ForgotOwnerPasswordComponent', ForgotOwnerPasswordComponent);
    this.componentRegistry.set('ResetOwnerPasswordComponent', ResetOwnerPasswordComponent);
    this.componentRegistry.set('EmailVerificationComponent', EmailVerificationComponent);
  }

  /**
   * Registra todos los layouts disponibles
   */
  private registerLayouts(): void {
    this.layoutRegistry.set('super-admin', SuperAdminLayoutComponent);
    this.layoutRegistry.set('organization-admin', OrganizationAdminLayoutComponent);
    this.layoutRegistry.set('store-admin', StoreAdminLayoutComponent);
    
    // Assuming a generic public layout for these for now
    // this.layoutRegistry.set('public', PublicLayoutComponent);
    // this.layoutRegistry.set('auth', AuthLayoutComponent);
    // this.layoutRegistry.set('storefront', PublicLayoutComponent);
  }

  /**
   * Registra todos los guards disponibles
   */
  private registerGuards(): void {
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

      // CRITICAL FIX: Reset the router's configuration with the new dynamic routes.
      this.router.resetConfig(dynamicRoutes);

      console.log('[ROUTE MANAGER] Routes configured and router reset successfully:', {
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

    // Always add static auth routes first - these should be available in all environments
    const staticAuthRoutes = this.getStaticAuthRoutes();
    routes.push(...staticAuthRoutes);

    // Build all routes directly from the app config
    if (appConfig.routes && Array.isArray(appConfig.routes)) {
      appConfig.routes.forEach((routeConfig: RouteConfig) => {
        const route = this.buildRoute(routeConfig, !routeConfig.isPublic);
        if (route) routes.push(route);
      });
    }

    // IMPORTANT: No agregar ruta wildcard aquí para evitar bucles de redirección
    // El manejo de rutas no encontradas se hará a nivel de componente
    console.log('[ROUTE MANAGER] Dynamic routes built without wildcard to prevent infinite redirects');
    
    return routes;
  }

  /**
   * Obtiene las rutas estáticas de autenticación que deben estar siempre disponibles
   */
  private getStaticAuthRoutes(): Routes {
    return [
      {
        path: 'auth',
        children: [
          {
            path: 'login',
            component: ContextualLoginComponent,
            data: { isPublic: true }
          },
          {
            path: 'register',
            component: RegisterOwnerComponent,
            data: { isPublic: true }
          },
          {
            path: 'forgot-owner-password',
            component: ForgotOwnerPasswordComponent,
            data: { isPublic: true }
          },
          {
            path: 'reset-owner-password',
            component: ResetOwnerPasswordComponent,
            data: { isPublic: true }
          },
          {
            path: 'verify-email',
            component: EmailVerificationComponent,
            data: { isPublic: true }
          }
        ]
      }
    ];
  }

  /**
   * Construye una ruta individual desde la configuración
   */
  private buildRoute(routeConfig: RouteConfig, isPrivate: boolean): any {
    if (!routeConfig) return null;

    // Case 1: This is a parent route with children
    if (routeConfig.children && routeConfig.children.length > 0) {
      return {
        path: routeConfig.path,
        children: routeConfig.children
          .map(child => this.buildRoute(child, isPrivate))
          .filter(Boolean), // Filter out any null/undefined routes
        data: { isPublic: !isPrivate }
      };
    }

    // Case 2: This is a standard route with a component
    if (routeConfig.component) {
      const componentRef = this.getComponentReference(routeConfig.component);
      if (!componentRef) {
        console.warn(`[ROUTE MANAGER] Component not found: ${routeConfig.component}`);
        return null;
      }

      const route: any = { path: routeConfig.path };

      // If the route has a layout, the layout becomes the route's main component.
      if (routeConfig.layout) {
        const layoutRef = this.getLayoutReference(routeConfig.layout);
        if (layoutRef) {
          this.assignComponentToRoute(route, layoutRef);
          // Pass the actual page component in the data property for the layout to render
          route.data = {
            ...routeConfig.data,
            component: componentRef, 
            layout: routeConfig.layout,
            isPublic: !isPrivate
          };
        } else {
          // Fallback if layout not found: use component directly
          this.assignComponentToRoute(route, componentRef);
        }
      } else {
        // No layout, so the page component is the main route component
        this.assignComponentToRoute(route, componentRef);
        route.data = {
          ...routeConfig.data,
          isPublic: !isPrivate
        };
      }

      route.canActivate = []; // No guards
      return route;
    }

    console.warn(`[ROUTE MANAGER] Invalid route config, no component or children for path: ${routeConfig.path}`);
    return null;
  }

  /**
   * Helper to assign a component reference to the correct route property (component vs loadComponent)
   */
  private assignComponentToRoute(route: any, componentRef: any): void {
    // A class constructor has a .prototype, a lazy-load arrow function does not.
    if (componentRef.prototype) {
      route.component = componentRef;
    } else {
      route.loadComponent = componentRef;
    }
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
  public getDefaultRouteForEnvironment(environment: AppEnvironment): string {
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

      const success = await this.router.navigateByUrl(path, extras);
      
      if (!success) {
        console.warn(`[ROUTE MANAGER] Navigation failed for path: ${path}`);
        // Fallback to default route using navigateByUrl
        await this.router.navigateByUrl('/');
      }

      return success;
    } catch (error) {
      console.error(`[ROUTE MANAGER] Error navigating to ${path}:`, error);
      await this.router.navigateByUrl('/');
      return false;
    }
  }
}