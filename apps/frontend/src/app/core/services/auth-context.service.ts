import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { DomainDetectorService } from './domain-detector.service';
import { AppResolverService } from './app-resolver.service';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { AuthFacade } from '../store/auth/auth.facade';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';

export interface AuthContext {
  environment: AppEnvironment;
  contextType: 'vendix' | 'organization' | 'store';
  displayName: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  allowedRoles: string[];
  postLoginRedirect: string;
  authComponents: {
    login: string;
    register: string;
    forgotPassword: string;
  };
  features: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AuthContextService {

  constructor(
    private domainDetector: DomainDetectorService,
    private appResolver: AppResolverService,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade,
    private router: Router
  ) {}

  /**
   * Resuelve el contexto de autenticación actual basado en el dominio
   */
  async resolveAuthContext(): Promise<AuthContext> {
    const domainConfig = await this.domainDetector.detectDomain();
    const tenantConfig = this.tenantFacade.getCurrentTenantConfig();
    
    return this.buildAuthContext(domainConfig, tenantConfig);
  }

  /**
   * Obtiene el contexto de autenticación actual como Observable
   */
  getAuthContext(): Observable<AuthContext> {
    return this.tenantFacade.tenantConfig$.pipe(
      take(1),
      switchMap(tenantConfig =>
        from(this.domainDetector.detectDomain()).pipe(
          map(domainConfig => this.buildAuthContext(domainConfig, tenantConfig))
        )
      )
    );
  }

  /**
   * Construye el contexto de autenticación basado en la configuración del dominio y tenant
   */
  private buildAuthContext(domainConfig: DomainConfig, tenantConfig: any): AuthContext {
    const baseContext = {
      environment: domainConfig.environment,
      displayName: this.getDisplayName(domainConfig, tenantConfig),
      logoUrl: tenantConfig?.branding?.logo?.url,
      primaryColor: tenantConfig?.branding?.colors?.primary,
      secondaryColor: tenantConfig?.branding?.colors?.secondary,
      features: this.appResolver.resolveFeatures(domainConfig)
    };

    switch (domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
      case AppEnvironment.VENDIX_ADMIN:
        return {
          ...baseContext,
          contextType: 'vendix',
          allowedRoles: ['super_admin', 'admin', 'owner', 'manager', 'supervisor'],
          postLoginRedirect: this.getVendixPostLoginRedirect(),
          authComponents: {
            login: 'VendixLoginComponent',
            register: 'VendixRegisterComponent',
            forgotPassword: 'VendixForgotPasswordComponent'
          }
        };

      case AppEnvironment.ORG_LANDING:
      case AppEnvironment.ORG_ADMIN:
        return {
          ...baseContext,
          contextType: 'organization',
          allowedRoles: ['owner', 'admin', 'manager', 'supervisor', 'employee'],
          postLoginRedirect: this.getOrganizationPostLoginRedirect(),
          authComponents: {
            login: 'OrgLoginComponent',
            register: 'OrgRegisterComponent',
            forgotPassword: 'OrgForgotPasswordComponent'
          }
        };

      case AppEnvironment.STORE_ADMIN:
      case AppEnvironment.STORE_ECOMMERCE:
        return {
          ...baseContext,
          contextType: 'store',
          allowedRoles: ['owner', 'admin', 'manager', 'supervisor', 'employee', 'customer'],
          postLoginRedirect: this.getStorePostLoginRedirect(domainConfig.environment),
          authComponents: {
            login: 'StoreLoginComponent',
            register: 'StoreRegisterComponent',
            forgotPassword: 'StoreForgotPasswordComponent'
          }
        };

      default:
        return {
          ...baseContext,
          contextType: 'vendix',
          allowedRoles: [],
          postLoginRedirect: '/',
          authComponents: {
            login: 'LoginComponent',
            register: 'RegisterComponent',
            forgotPassword: 'ForgotPasswordComponent'
          }
        };
    }
  }

  /**
   * Obtiene el nombre para mostrar basado en el contexto
   */
  private getDisplayName(domainConfig: DomainConfig, tenantConfig: any): string {
    switch (domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
      case AppEnvironment.VENDIX_ADMIN:
        return 'Vendix Platform';

      case AppEnvironment.ORG_LANDING:
      case AppEnvironment.ORG_ADMIN:
        return tenantConfig?.organization?.name || 'Organización';

      case AppEnvironment.STORE_ADMIN:
      case AppEnvironment.STORE_ECOMMERCE:
        return tenantConfig?.store?.name || 'Tienda';

      default:
        return 'Vendix';
    }
  }

  /**
   * Obtiene la redirección post-login para Vendix
   */
  private getVendixPostLoginRedirect(): string {
    const user = this.authFacade.getCurrentUser();
    const userRoles = user?.roles || [];
    
    if (userRoles.includes('super_admin')) {
      return '/superadmin';
    }
    
    return '/admin/dashboard';
  }

  /**
   * Obtiene la redirección post-login para Organization
   */
  private getOrganizationPostLoginRedirect(): string {
    const user = this.authFacade.getCurrentUser();
    const userRoles = user?.roles || [];
    
    const adminRoles = ['owner', 'admin', 'manager'];
    if (userRoles.some((role: string) => adminRoles.includes(role))) {
      return '/admin/dashboard';
    }
    
    return '/dashboard';
  }

  /**
   * Obtiene la redirección post-login para Store
   */
  private getStorePostLoginRedirect(environment: AppEnvironment): string {
    const user = this.authFacade.getCurrentUser();
    const userRoles = user?.roles || [];
    
    // Para administradores de tienda
    const adminRoles = ['owner', 'admin', 'manager', 'supervisor'];
    if (userRoles.some((role: string) => adminRoles.includes(role))) {
      return environment === AppEnvironment.STORE_ADMIN ? '/admin/dashboard' : '/admin';
    }
    
    // Para empleados
    if (userRoles.includes('employee')) {
      return '/pos';
    }
    
    // Para clientes
    if (userRoles.includes('customer')) {
      return '/account';
    }
    
    return '/';
  }

  /**
   * Verifica si el usuario actual tiene permisos para el contexto actual
   */
  hasContextPermission(): Observable<boolean> {
    return this.getAuthContext().pipe(
      switchMap(context => 
        this.authFacade.user$.pipe(
          take(1),
          map(user => {
            if (!user) return false;
            
            const userRoles = user.roles || [];
            return userRoles.some((role: string) => context.allowedRoles.includes(role));
          })
        )
      )
    );
  }

  /**
   * Obtiene el componente de login apropiado para el contexto actual
   */
  getLoginComponent(): Observable<string> {
    return this.getAuthContext().pipe(
      map(context => context.authComponents.login)
    );
  }

  /**
   * Redirige al usuario autenticado al destino apropiado basado en el contexto
   */
  redirectAuthenticatedUser(): void {
    this.getAuthContext().subscribe(context => {
      const user = this.authFacade.getCurrentUser();
      
      if (!user) {
        console.warn('[AUTH CONTEXT] No user found for redirection');
        return;
      }

      console.log('[AUTH CONTEXT] Redirecting authenticated user:', {
        context: context.contextType,
        userRoles: user.roles,
        redirectTo: context.postLoginRedirect
      });

      this.router.navigate([context.postLoginRedirect]).then(success => {
        if (success) {
          console.log('[AUTH CONTEXT] Successfully redirected to:', context.postLoginRedirect);
        } else {
          console.error('[AUTH CONTEXT] Failed to redirect to:', context.postLoginRedirect);
          // Fallback redirect
          this.router.navigate(['/']);
        }
      });
    });
  }

  /**
   * Verifica si el usuario necesita ser redirigido basado en el contexto actual
   */
  shouldRedirectUser(currentPath: string): Observable<boolean> {
    return this.getAuthContext().pipe(
      switchMap(context => 
        this.authFacade.user$.pipe(
          take(1),
          map(user => {
            if (!user) return false;

            const userRoles = user.roles || [];
            
            // No redirigir si ya está en el área apropiada
            if (this.isInAppropriateArea(currentPath, context.contextType, userRoles)) {
              return false;
            }

            // Redirigir desde rutas públicas
            const publicRoutes = ['/auth/login', '/auth/register', '/auth/forgot-password', '/'];
            if (publicRoutes.includes(currentPath)) {
              return true;
            }

            // Redirigir si está en un contexto incorrecto
            return this.isInWrongContext(currentPath, context.contextType, userRoles);
          })
        )
      )
    );
  }

  /**
   * Verifica si el usuario está en el área apropiada
   */
  private isInAppropriateArea(currentPath: string, contextType: string, userRoles: string[]): boolean {
    const isAdmin = userRoles.some(role => ['super_admin', 'admin', 'owner', 'manager'].includes(role));
    const isCustomer = userRoles.includes('customer');
    const isEmployee = userRoles.includes('employee');

    if (isAdmin && currentPath.startsWith('/admin')) {
      return true;
    }

    if (userRoles.includes('super_admin') && currentPath.startsWith('/superadmin')) {
      return true;
    }

    if (isCustomer && (currentPath.startsWith('/account') || currentPath.startsWith('/shop'))) {
      return true;
    }

    if (isEmployee && currentPath.startsWith('/pos')) {
      return true;
    }

    return false;
  }

  /**
   * Verifica si el usuario está en un contexto incorrecto
   */
  private isInWrongContext(currentPath: string, contextType: string, userRoles: string[]): boolean {
    // Un super_admin puede estar en cualquier contexto
    if (userRoles.includes('super_admin')) {
      return false;
    }

    // Verificar si el usuario está intentando acceder a un contexto no permitido
    if (contextType === 'organization' && currentPath.startsWith('/superadmin')) {
      return true;
    }

    if (contextType === 'store' && (currentPath.startsWith('/superadmin') || currentPath.startsWith('/admin/tenants'))) {
      return true;
    }

    return false;
  }

  /**
   * Obtiene la configuración de branding para el contexto actual
   */
  getBrandingConfig(): Observable<any> {
    return this.tenantFacade.tenantConfig$.pipe(
      take(1),
      map(tenantConfig => ({
        logo: tenantConfig?.branding?.logo,
        colors: tenantConfig?.branding?.colors,
        fonts: tenantConfig?.branding?.fonts,
        customCSS: tenantConfig?.branding?.customCSS
      }))
    );
  }

  /**
   * Verifica si una ruta está permitida en el contexto actual
   */
  isRouteAllowed(routePath: string): Observable<boolean> {
    return this.getAuthContext().pipe(
      switchMap(context => 
        this.authFacade.user$.pipe(
          take(1),
          map(user => {
            if (!user) {
              // Rutas públicas permitidas para usuarios no autenticados
              const publicRoutes = ['/auth/login', '/auth/register', '/auth/forgot-password', '/'];
              return publicRoutes.includes(routePath);
            }

            const userRoles = user.roles || [];
            
            // Verificar permisos basados en el contexto y roles
            return this.checkRoutePermissions(routePath, context.contextType, userRoles);
          })
        )
      )
    );
  }

  /**
   * Verifica los permisos para una ruta específica
   */
  private checkRoutePermissions(routePath: string, contextType: string, userRoles: string[]): boolean {
    // Rutas de super admin solo para super_admin
    if (routePath.startsWith('/superadmin') && !userRoles.includes('super_admin')) {
      return false;
    }

    // Rutas de admin para roles administrativos
    if (routePath.startsWith('/admin') && contextType !== 'vendix') {
      const adminRoles = ['owner', 'admin', 'manager'];
      if (!userRoles.some(role => adminRoles.includes(role))) {
        return false;
      }
    }

    // Rutas de POS para empleados y supervisores
    if (routePath.startsWith('/pos') && contextType === 'store') {
      const posRoles = ['supervisor', 'employee'];
      if (!userRoles.some(role => posRoles.includes(role))) {
        return false;
      }
    }

    return true;
  }
}