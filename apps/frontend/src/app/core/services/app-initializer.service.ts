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
    private router: Router
  ) {}

  /**
   * Inicializa la aplicación completa
   */
  async initializeApp(): Promise<void> {
    try {
      console.log('[APP INITIALIZER] Starting application initialization...');

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

      // 5. Configurar rutas dinámicamente
      await this.configureRoutesForEnvironment(domainConfig);

      // 6. Inicializar servicios específicos del entorno
      await this.initializeEnvironmentServices(domainConfig);

      // 7. If user is authenticated, redirect to appropriate environment
      if (isAuthenticated) {
        console.log('[APP INITIALIZER] User is authenticated, redirecting...');
        await this.redirectAuthenticatedUser();
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
  private async redirectAuthenticatedUser(): Promise<void> {
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
        currentPath: this.router.url
      });
      
      if (user && userRole && isAuthenticated) {
        // Only redirect if we're not already in the admin area
        if (!this.router.url.startsWith('/admin')) {
          // Determine redirect path based on user role
          let redirectPath = '/admin/dashboard'; // default
          
          const adminRoles = ['super_admin', 'admin', 'owner', 'manager', 'supervisor'];
          if (adminRoles.includes(userRole.toLowerCase())) {
            redirectPath = '/admin/dashboard';
          }
          
          console.log('[APP INITIALIZER] Redirecting to:', redirectPath);
          this.router.navigate([redirectPath]);
        } else {
          console.log('[APP INITIALIZER] User already in admin area, no redirect needed');
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
   * Configura las rutas según el entorno
   */
   private async configureRoutesForEnvironment(domainConfig: DomainConfig): Promise<void> {
    console.log('[APP INITIALIZER] Configuring routes for environment:', domainConfig.environment);

    // Las rutas se configurarán dinámicamente según el entorno
    // Por ahora, simplemente logueamos el entorno
    const routeConfig = this.getRouteConfigForEnvironment(domainConfig.environment);
    console.log('[APP INITIALIZER] Route configuration:', routeConfig);
  }

  /**
   * Obtiene la configuración de rutas para un entorno específico
   * Nota: La configuración de rutas ahora viene del domain resolution service
   */
  private getRouteConfigForEnvironment(environment: AppEnvironment): any {
    // La configuración de rutas se determina basada en el entorno detectado
    // Esta información ya está disponible en la configuración del dominio
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return {
          modules: ['landing', 'auth', 'onboarding'],
          defaultRoute: '/',
          features: ['registration', 'login', 'marketing']
        };

      case AppEnvironment.VENDIX_ADMIN:
        return {
          modules: ['admin', 'super-admin', 'organizations', 'analytics'],
          defaultRoute: '/admin/dashboard',
          features: ['user-management', 'system-settings', 'analytics']
        };

      case AppEnvironment.ORG_LANDING:
        return {
          modules: ['organization-landing', 'auth'],
          defaultRoute: '/',
          features: ['company-info', 'contact', 'login']
        };

      case AppEnvironment.ORG_ADMIN:
        return {
          modules: ['organization', 'stores', 'users', 'reports'],
          defaultRoute: '/dashboard',
          features: ['store-management', 'user-management', 'analytics']
        };

      case AppEnvironment.STORE_ADMIN:
        return {
          modules: ['store', 'products', 'orders', 'customers', 'pos'],
          defaultRoute: '/dashboard',
          features: ['inventory', 'sales', 'customer-management', 'pos']
        };

      case AppEnvironment.STORE_ECOMMERCE:
        return {
          modules: ['ecommerce', 'products', 'cart', 'checkout'],
          defaultRoute: '/',
          features: ['catalog', 'shopping-cart', 'checkout', 'account']
        };

      default:
        return {
          modules: ['error'],
          defaultRoute: '/error',
          features: []
        };
    }
  }

  /**
   * Configuración de rutas por defecto (fallback)
   */
  private getFallbackRouteConfigForEnvironment(environment: AppEnvironment): any {
    switch (environment) {
      case AppEnvironment.VENDIX_LANDING:
        return {
          modules: ['landing', 'auth', 'onboarding'],
          defaultRoute: '/',
          features: ['registration', 'login', 'marketing']
        };

      case AppEnvironment.VENDIX_ADMIN:
        return {
          modules: ['admin', 'super-admin', 'organizations', 'analytics'],
          defaultRoute: '/admin/dashboard',
          features: ['user-management', 'system-settings', 'analytics']
        };

      case AppEnvironment.ORG_LANDING:
        return {
          modules: ['organization-landing', 'auth'],
          defaultRoute: '/',
          features: ['company-info', 'contact', 'login']
        };

      case AppEnvironment.ORG_ADMIN:
        return {
          modules: ['organization', 'stores', 'users', 'reports'],
          defaultRoute: '/dashboard',
          features: ['store-management', 'user-management', 'analytics']
        };

      case AppEnvironment.STORE_ADMIN:
        return {
          modules: ['store', 'products', 'orders', 'customers', 'pos'],
          defaultRoute: '/dashboard',
          features: ['inventory', 'sales', 'customer-management', 'pos']
        };

      case AppEnvironment.STORE_ECOMMERCE:
        return {
          modules: ['ecommerce', 'products', 'cart', 'checkout'],
          defaultRoute: '/',
          features: ['catalog', 'shopping-cart', 'checkout', 'account']
        };

      default:
        return {
          modules: ['error'],
          defaultRoute: '/error',
          features: []
        };
    }
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
