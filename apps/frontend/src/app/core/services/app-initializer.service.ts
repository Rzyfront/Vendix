import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { DomainDetectorService } from './domain-detector.service';
import { TenantConfigService } from './tenant-config.service';
import { ThemeService } from './theme.service';
import { TenantFacade } from '../store/tenant/tenant.facade';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';
import { TenantConfig } from '../models/tenant-config.interface';

@Injectable({
  providedIn: 'root'
})
export class AppInitializerService {
  
  constructor(
    private domainDetector: DomainDetectorService,
    private tenantConfig: TenantConfigService,
    private themeService: ThemeService,
    private tenantFacade: TenantFacade,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  /**
   * Inicializa la aplicación completa
   */
  async initializeApp(): Promise<void> {
    try {
      console.log('[APP INITIALIZER] Starting application initialization...');

      // 1. Detectar el dominio actual
      const domainConfig = await this.domainDetector.detectDomain();
      console.log('[APP INITIALIZER] Domain detected:', domainConfig);

      // 2. Inicializar tenant a través del store
      this.tenantFacade.initTenant(domainConfig);

      // 3. Esperar a que se complete la inicialización del tenant
      await firstValueFrom(
        this.tenantFacade.initialized$.pipe(
          filter(initialized => initialized === true)
        )
      );

      // 4. Obtener configuración del tenant desde el store
      const tenantConfig = this.tenantFacade.getCurrentTenantConfig();
      console.log('[APP INITIALIZER] Tenant config loaded:', tenantConfig);

      // 5. Aplicar tema y branding
      if (tenantConfig) {
        await this.themeService.applyTenantConfiguration(tenantConfig);
        console.log('[APP INITIALIZER] Theme applied successfully');
      }

      // 6. Configurar rutas dinámicamente
      await this.configureRoutesForEnvironment(domainConfig);

      // 7. Inicializar servicios específicos del entorno
      await this.initializeEnvironmentServices(domainConfig);

      console.log('[APP INITIALIZER] Application initialization completed successfully');

    } catch (error) {
      console.error('[APP INITIALIZER] Error during initialization:', error);
      await this.handleInitializationError(error);
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
   * Maneja errores durante la inicialización
   */
  private async handleInitializationError(error: any): Promise<void> {
    console.error('[APP INITIALIZER] Initialization failed:', error);
    
    // Dependiendo del tipo de error, podríamos:
    // 1. Mostrar página de error
    // 2. Redirigir a Vendix principal
    // 3. Mostrar mensaje de mantenimiento
    
    if (error.message?.includes('Domain') && error.message?.includes('not found')) {
      // Dominio no encontrado - redirigir a Vendix
      console.log('[APP INITIALIZER] Redirecting to Vendix due to domain not found');
      if (isPlatformBrowser(this.platformId)) {
        window.location.href = 'https://vendix.com';
      }
    } else {
      // Otro tipo de error - mostrar página de error
      console.log('[APP INITIALIZER] Navigating to error page');
      this.router.navigate(['/error'], { 
        queryParams: { message: 'Initialization failed' } 
      });
    }
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
   */
  isAppInitialized(): boolean {
    const domainConfig = this.tenantConfig.getCurrentDomainConfig();
    const tenantConfig = this.tenantConfig.getCurrentTenantConfig();
    
    return !!(domainConfig && tenantConfig);
  }
}
