import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { DomainDetectorService } from './domain-detector.service';
import { TenantConfigService } from './tenant-config.service';
import { ThemeService } from './theme.service';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { AuthFacade } from '../store/auth/auth.facade';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';
import { TenantConfig } from '../models/tenant-config.interface';
import { AppResolverService } from './app-resolver.service';
import { RouteConfigService } from './route-config.service';

@Injectable({
  providedIn: 'root'
})
export class AppInitializerService {
  private initializationError: any = null;

  constructor(
    private domainDetector: DomainDetectorService,
    private tenantConfig: TenantConfigService,
    private themeService: ThemeService,
    private tenantFacade: TenantFacade,
    private authFacade: AuthFacade,
    private router: Router,
    private appResolver: AppResolverService,
    private routeConfig: RouteConfigService
  ) {}

  /**
   * Inicializa la aplicación completa
   */
  async initializeApp(): Promise<void> {
    try {
      // Reset any previous error
      this.initializationError = null;

      // 1. Check if user is already authenticated from persisted state FIRST
      const isAuthenticated = this.checkPersistedAuth();
      console.log('[APP INITIALIZER] Persisted auth check:', isAuthenticated);

      // 2. Detectar el dominio actual
      const domainConfig = await this.domainDetector.detectDomain();
      console.log('[APP INITIALIZER] Domain detected:', domainConfig);

      // 3. Store domain config in tenant store (but don't load tenant config yet)
      this.tenantFacade.setDomainConfig(domainConfig);

      // 4. Apply basic theme from domain config if available
      if (domainConfig.customConfig?.branding) {
        const transformedBranding = this.transformApiBranding(domainConfig.customConfig.branding);
        await this.themeService.applyBranding(transformedBranding);
        console.log('[APP INITIALIZER] Basic branding applied from domain config');
      }

      // 5. Configurar rutas dinámicamente usando el nuevo servicio centralizado
      await this.routeConfig.configureRoutes();
      
      // 6. Resolver configuración completa de la aplicación
      const appConfig = await this.appResolver.resolveAppConfiguration();
      console.log('[APP INITIALIZER] App configuration resolved:', appConfig);

      // 7. Configurar servicios específicos del entorno
      await this.initializeEnvironmentServices(domainConfig);

      // 8. If user is authenticated, redirect to appropriate environment
      if (isAuthenticated) {
        console.log('[APP INITIALIZER] User is authenticated, redirecting...');
        await this.redirectAuthenticatedUser(domainConfig);
      }

      console.log('[APP INITIALIZER] Application initialization completed successfully');

    } catch (error) {
      console.error('[APP INITIALIZER] Error during initialization:', error);
      this.initializationError = error;
      // Don't throw - let the app handle the error state
    }
  }

  /**
   * Verifica si hay un usuario autenticado en el estado persistido
   */
  private checkPersistedAuth(): boolean {
    try {
      const authState = localStorage.getItem('vendix_auth_state');
      if (authState) {
        const parsedState = JSON.parse(authState);
        const hasUser = !!parsedState.user;
        const hasTokens = !!parsedState.tokens?.accessToken;
        
        console.log('[APP INITIALIZER] Checking persisted auth:', { hasUser, hasTokens, user: parsedState.user?.email });
        
        if (hasUser && hasTokens) {
          // Dispatch action to restore auth state immediately
          this.authFacade.restoreAuthState(parsedState.user, parsedState.tokens);
          return true;
        }
      }
    } catch (error) {
      console.warn('[APP INITIALIZER] Error checking persisted auth:', error);
    }
    return false;
  }

  /**
   * Redirige al usuario autenticado a su entorno apropiado
   */
  private async redirectAuthenticatedUser(domainConfig: DomainConfig): Promise<void> {
    try {
      // Wait a bit for the auth state to be restored
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const user = this.authFacade.getCurrentUser();
      const userRole = this.authFacade.getCurrentUserRole();
      const isAuthenticated = this.authFacade.isLoggedIn();
      
      console.log('[APP INITIALIZER] Redirecting authenticated user:', {
        user: user?.email,
        userRole,
        isAuthenticated,
        currentPath: this.router.url,
        environment: domainConfig.environment
      });
      
      if (user && userRole && isAuthenticated) {
        // Only redirect if we're not already in the appropriate area
        const currentPath = this.router.url;
        const shouldRedirect = this.shouldRedirectUser(currentPath, userRole, domainConfig.environment);
        
        if (shouldRedirect) {
          // Use the new AppResolverService for intelligent redirection
          const userRoles = Array.isArray((user as any)?.roles)
            ? (user as any).roles
            : [userRole];
            
          const redirectPath = this.appResolver.getPostLoginRedirect(domainConfig.environment, userRoles);
          
          console.log('[APP INITIALIZER] Redirecting to:', redirectPath);
          this.router.navigate([redirectPath]);
        } else {
          console.log('[APP INITIALIZER] User already in appropriate area, no redirect needed');
        }
      } else {
        console.log('[APP INITIALIZER] Auth state not fully restored, skipping redirect');
      }
    } catch (error) {
      console.error('[APP INITIALIZER] Error redirecting authenticated user:', error);
    }
  }

  /**
   * Verifica si es un entorno core de Vendix
   */
  private isVendixCoreEnvironment(environment: AppEnvironment): boolean {
    return environment === AppEnvironment.VENDIX_LANDING || 
           environment === AppEnvironment.VENDIX_ADMIN;
  }

  /**
   * Determina si el usuario necesita redirección basado en su ubicación actual y rol
   */
  private shouldRedirectUser(currentPath: string, userRole: string, environment: AppEnvironment): boolean {
    const adminRoles = ['super_admin', 'admin', 'owner', 'manager', 'supervisor'];
    const isAdmin = adminRoles.includes(userRole.toLowerCase());
    
    // No redirigir si ya está en el área apropiada
    if (isAdmin && currentPath.startsWith('/admin')) {
      return false;
    }
    
    if (userRole === 'super_admin' && currentPath.startsWith('/superadmin')) {
      return false;
    }
    
    if (userRole === 'customer' && (currentPath.startsWith('/account') || currentPath.startsWith('/shop'))) {
      return false;
    }
    
    // No redirigir desde rutas públicas específicas
    const publicRoutes = ['/auth/login', '/auth/register', '/auth/forgot-password', '/'];
    if (publicRoutes.includes(currentPath)) {
      return true;
    }
    
    return true;
  }




  /**
   * Inicializa servicios específicos del entorno
   */
  private async initializeEnvironmentServices(domainConfig: DomainConfig): Promise<void> {
    console.log('[APP INITIALIZER] Initializing environment services for:', domainConfig.environment);
    
    const currentTenant = this.tenantConfig.getCurrentTenantConfig();
    const organization = currentTenant?.organization;
    const store = currentTenant?.store;
    
    switch (domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        await this.initializeVendixLandingServices();
        break;
        
      case AppEnvironment.VENDIX_ADMIN:
        await this.initializeVendixAdminServices();
        break;
        
      case AppEnvironment.ORG_LANDING:
        await this.initializeOrgLandingServices(organization);
        break;
        
      case AppEnvironment.ORG_ADMIN:
        await this.initializeOrgAdminServices(organization);
        break;
        
      case AppEnvironment.STORE_ADMIN:
        await this.initializeStoreAdminServices(organization, store);
        break;
        
      case AppEnvironment.STORE_ECOMMERCE:
        await this.initializeEcommerceServices(organization, store);
        break;
        
      default:
        console.warn('[APP INITIALIZER] Unknown environment:', domainConfig.environment);
    }
  }

  /**
   * Inicializa servicios para Vendix Landing
   */
  private async initializeVendixLandingServices(): Promise<void> {
    console.log('[APP INITIALIZER] Initializing Vendix Landing services...');
    // Aquí se inicializarían servicios específicos como:
    // - Marketing service
    // - Lead capture service
    // - Analytics service
  }

  /**
   * Inicializa servicios para Vendix Admin
   */
  private async initializeVendixAdminServices(): Promise<void> {
    console.log('[APP INITIALIZER] Initializing Vendix Admin services...');
    // Aquí se inicializarían servicios específicos como:
    // - Super admin service
    // - Organization management service
    // - System metrics service
  }

  /**
   * Inicializa servicios para Organization Landing
   */
  private async initializeOrgLandingServices(organization: any): Promise<void> {
    console.log('[APP INITIALIZER] Initializing Organization Landing services for:', organization?.name);
    // Aquí se inicializarían servicios específicos como:
    // - Company info service
    // - Contact service
    // - Organization-specific marketing
  }

  /**
   * Inicializa servicios para Organization Admin
   */
  private async initializeOrgAdminServices(organization: any): Promise<void> {
    console.log('[APP INITIALIZER] Initializing Organization Admin services for:', organization?.name);
    // Aquí se inicializarían servicios específicos como:
    // - Store management service
    // - Organization user service
    // - Organization analytics service
  }

  /**
   * Inicializa servicios para Store Admin
   */
  private async initializeStoreAdminServices(organization: any, store: any): Promise<void> {
    console.log('[APP INITIALIZER] Initializing Store Admin services for:', store?.name);
    // Aquí se inicializarían servicios específicos como:
    // - Product service
    // - Order service
    // - Customer service
    // - POS service
    // - Inventory service
  }

  /**
   * Inicializa servicios para E-commerce
   */
  private async initializeEcommerceServices(organization: any, store: any): Promise<void> {
    console.log('[APP INITIALIZER] Initializing E-commerce services for:', store?.name);
    // Aquí se inicializarían servicios específicos como:
    // - Catalog service
    // - Cart service
    // - Checkout service
    // - Customer account service
    // - Payment service
  }

  /**
   * Obtiene el error de inicialización si ocurrió
   */
  getInitializationError(): any {
    return this.initializationError;
  }

  /**
   * Verifica si la inicialización falló
   */
  hasInitializationError(): boolean {
    return this.initializationError !== null;
  }

  /**
   * Reinicia la aplicación (útil para cambios de configuración)
   */
  async reinitializeApp(): Promise<void> {
    console.log('[APP INITIALIZER] Reinitializing application...');
    
    // Limpiar configuraciones actuales
    this.tenantConfig.clearCache();
    this.themeService.resetTheme();
    
    // Reinicializar
    await this.initializeApp();
  }

  /**
   * Obtiene información del estado actual de la aplicación
   */
  getAppState(): any {
    const domainConfig = this.tenantConfig.getCurrentDomainConfig();
    const tenantConfig = this.tenantConfig.getCurrentTenantConfig();
    const theme = this.themeService.getCurrentTheme();
    
    return {
      domain: domainConfig,
      tenant: tenantConfig,
      theme: theme,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verifica si la aplicación está completamente inicializada
   * Ahora solo verifica domain config, no tenant config (se carga después del login)
   */
  isAppInitialized(): boolean {
    const domainConfig = this.tenantFacade.getCurrentDomainConfig();
    return !!domainConfig;
  }

  /**
   * Transforma el branding de la API al formato esperado por ThemeService
   */
  private transformApiBranding(apiBranding: any): any {
    return {
      logo: {
        url: apiBranding.logo_url,
        alt: apiBranding.name || 'Logo'
      },
      colors: {
        primary: apiBranding.primary_color,
        secondary: apiBranding.secondary_color,
        accent: apiBranding.accent_color,
        background: apiBranding.background_color,
        surface: apiBranding.background_color, // Using background as surface
        text: {
          primary: apiBranding.text_color,
          secondary: apiBranding.text_color,
          muted: apiBranding.text_color
        }
      },
      fonts: {
        primary: 'Inter, sans-serif', // Default font
        secondary: 'Inter, sans-serif'
      },
      customCSS: undefined,
      favicon: apiBranding.favicon_url
    };
  }
}
