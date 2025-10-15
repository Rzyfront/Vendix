import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { DomainConfig, AppEnvironment, DomainType, DomainResolution } from '../models/domain-config.interface';
import { TenantConfig, OrganizationConfig, StoreConfig, BrandingConfig } from '../models/tenant-config.interface';
import { ThemeService } from './theme.service';
import { environment } from '../../../environments/environment';
import * as TenantActions from '../store/tenant/tenant.actions';

export interface AppConfig {
  environment: AppEnvironment;
  domainConfig: DomainConfig;
  tenantConfig: TenantConfig | null;
  routes: RouteConfig[];
  layouts: LayoutConfig[];
  features: string[];
  branding: BrandingConfig;
}

export interface RouteConfig {
  path: string;
  component: string;
  layout?: string;
  guards?: string[];
  data?: any;
  isPublic?: boolean;
}

export interface LayoutConfig {
  name: string;
  component: string;
  allowedEnvironments: AppEnvironment[];
  allowedRoles: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AppConfigService {
  private readonly CACHE_KEY = 'vendix_app_config';
  private readonly TENANT_CACHE_KEY = 'vendix_tenant_config';
  
  private configSubject = new BehaviorSubject<AppConfig | null>(null);
  public config$ = this.configSubject.asObservable();
  
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();
  
  private errorSubject = new BehaviorSubject<string | null>(null);
  public error$ = this.errorSubject.asObservable();

  // Inyectar servicios necesarios
  private http = inject(HttpClient);
  private store = inject(Store);
  private themeService = inject(ThemeService);

  /**
   * Inicializa la aplicación completa con flujo unificado y centralizado
   */
  async initializeApp(): Promise<AppConfig> {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);

    try {
      console.log('[APP CONFIG] Starting unified application initialization...');

      // 1. Detectar dominio (sin dependencia de DomainDetectorService)
      const domainConfig = await this.detectDomain();
      console.log('[APP CONFIG] Domain detected:', domainConfig);

      // 2. Cargar configuración del tenant (sin dependencia de TenantConfigService)
      const tenantConfig = await this.loadTenantConfigByDomain(domainConfig);
      console.log('[APP CONFIG] Tenant config loaded:', tenantConfig);

      // 3. Construir configuración completa de la aplicación
      const appConfig = await this.buildAppConfig(domainConfig, tenantConfig);
      console.log('[APP CONFIG] App config built:', appConfig);

      // 4. Aplicar tema y branding usando ThemeService
      if (tenantConfig) {
        await this.themeService.applyTenantConfiguration(tenantConfig);
      }

      // 5. Cachear configuración
      this.cacheAppConfig(appConfig);

      // 6. Emitir configuración
      this.configSubject.next(appConfig);
      this.loadingSubject.next(false);

      console.log('[APP CONFIG] Unified application initialization completed successfully');
      return appConfig;

    } catch (error) {
      console.error('[APP CONFIG] Error during unified initialization:', error);
      this.errorSubject.next(error instanceof Error ? error.message : 'Unknown error');
      this.loadingSubject.next(false);
      throw error;
    }
  }

  /**
   * Detección de dominio centralizada (reemplaza DomainDetectorService)
   */
  private async detectDomain(hostname?: string): Promise<DomainConfig> {
    const currentHostname = hostname || window.location.hostname;

    console.log(`[APP CONFIG] Analyzing hostname: ${currentHostname}`);

    try {
      // Consultar API para resolver el dominio
      const domainInfo = await this.resolveDomainFromAPI(currentHostname);

      if (!domainInfo) {
        throw new Error(`Domain ${currentHostname} not found or not configured`);
      }

      const domainConfig = this.buildDomainConfig(currentHostname, domainInfo);

      // Store in NgRx state
      this.store.dispatch(TenantActions.setDomainConfig({ domainConfig }));

      return domainConfig;

    } catch (error) {
      console.error('[APP CONFIG] Error detecting domain:', error);
      throw error;
    }
  }

  /**
   * Carga configuración del tenant centralizada (reemplaza TenantConfigService)
   */
  async loadTenantConfigByDomain(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      console.log('[APP CONFIG] Loading tenant config for domain:', domainConfig);
      
      // Si es dominio de Vendix, usar configuración por defecto pero aplicar branding personalizado si existe
      if (domainConfig.isVendixDomain &&
          (domainConfig.environment === AppEnvironment.VENDIX_LANDING ||
           domainConfig.environment === AppEnvironment.VENDIX_ADMIN)) {
        const vendixConfig = this.getVendixDefaultConfig();
        
        // Aplicar branding personalizado desde la configuración del dominio si está disponible
        if (domainConfig.customConfig?.branding) {
          vendixConfig.branding = this.mergeVendixBranding(vendixConfig.branding, domainConfig.customConfig.branding);
        }
        
        return vendixConfig;
      }
      
      // Verificar cache
      const cacheKey = this.getTenantCacheKey(domainConfig);
      const cachedConfig = this.getCachedTenantConfig(cacheKey);
      if (cachedConfig) {
        return cachedConfig;
      }
      
      // Cargar desde API
      const config = await this.fetchTenantConfig(domainConfig);
      
      if (config) {
        // Guardar en cache
        this.cacheTenantConfig(cacheKey, config);
      }
      
      return config;
      
    } catch (error) {
      console.error('[APP CONFIG] Error loading tenant config:', error);
      throw error;
    }
  }

  /**
   * Construye configuración completa de la aplicación
   */
  private async buildAppConfig(domainConfig: DomainConfig, tenantConfig: TenantConfig | null): Promise<AppConfig> {
    return {
      environment: domainConfig.environment,
      domainConfig,
      tenantConfig,
      routes: this.resolveRoutes(domainConfig, tenantConfig),
      layouts: this.resolveLayouts(domainConfig),
      features: this.resolveFeatures(domainConfig),
      branding: this.transformBrandingFromApi(tenantConfig?.branding || this.getDefaultBranding())
    };
  }

  /**
   * Resuelve rutas dinámicas basadas en el entorno
   */
  private resolveRoutes(domainConfig: DomainConfig, tenantConfig: TenantConfig | null): RouteConfig[] {
    const routes: RouteConfig[] = [];

    // Rutas públicas
    routes.push(...this.resolvePublicRoutes(domainConfig));

    // Rutas privadas
    routes.push(...this.resolvePrivateRoutes(domainConfig));

    return routes;
  }

  /**
   * Rutas públicas por entorno
   */
  private resolvePublicRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return [
          { path: '/', component: 'VendixLandingComponent', layout: 'public', isPublic: true },
          { path: '/auth/login', component: 'ContextualLoginComponent', layout: 'auth', isPublic: true },
          { path: '/auth/register', component: 'VendixAuthRegisterComponent', layout: 'auth', isPublic: true },
          { path: '/auth/forgot-password', component: 'VendixAuthForgotPasswordComponent', layout: 'auth', isPublic: true }
        ];

      case AppEnvironment.ORG_LANDING:
        return [
          { path: '/', component: 'OrgLandingComponent', layout: 'public', isPublic: true },
          { path: '/auth/login', component: 'ContextualLoginComponent', layout: 'auth', isPublic: true },
          { path: '/shop', component: 'OrgEcommerceComponent', layout: 'storefront', isPublic: true }
        ];

      case AppEnvironment.STORE_ECOMMERCE:
        return [
          { path: '/', component: 'StoreEcommerceComponent', layout: 'storefront', isPublic: true },
          { path: '/auth/login', component: 'ContextualLoginComponent', layout: 'auth', isPublic: true },
          { path: '/auth/register', component: 'StoreAuthRegisterComponent', layout: 'auth', isPublic: true }
        ];

      default:
        return [
          { path: '/', component: 'LandingComponent', layout: 'public', isPublic: true },
          { path: '/auth/login', component: 'ContextualLoginComponent', layout: 'auth', isPublic: true }
        ];
    }
  }

  /**
   * Rutas privadas por entorno
   */
  private resolvePrivateRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_ADMIN:
        return [
          { 
            path: '/superadmin', 
            component: 'SuperAdminDashboardComponent', 
            layout: 'super-admin', 
            guards: ['RoleGuard', 'DomainGuard'] 
          },
          { 
            path: '/superadmin/tenants', 
            component: 'TenantListComponent', 
            layout: 'super-admin', 
            guards: ['RoleGuard'] 
          }
        ];

      case AppEnvironment.ORG_ADMIN:
        return [
          { 
            path: '/admin', 
            component: 'OrgAdminDashboardComponent', 
            layout: 'organization-admin', 
            guards: ['RoleGuard', 'DomainGuard'] 
          },
          { 
            path: '/admin/stores', 
            component: 'StoreManagementComponent', 
            layout: 'organization-admin', 
            guards: ['RoleGuard'] 
          },
          { 
            path: '/admin/users', 
            component: 'UserManagementComponent', 
            layout: 'organization-admin', 
            guards: ['RoleGuard'] 
          }
        ];

      case AppEnvironment.STORE_ADMIN:
        return [
          { 
            path: '/admin', 
            component: 'StoreAdminDashboardComponent', 
            layout: 'store-admin', 
            guards: ['RoleGuard', 'DomainGuard'] 
          },
          { 
            path: '/admin/products', 
            component: 'ProductManagementComponent', 
            layout: 'store-admin', 
            guards: ['RoleGuard'] 
          },
          { 
            path: '/admin/orders', 
            component: 'OrderManagementComponent', 
            layout: 'store-admin', 
            guards: ['RoleGuard'] 
          },
          { 
            path: '/pos', 
            component: 'POSComponent', 
            layout: 'pos', 
            guards: ['RoleGuard'] 
          }
        ];

      case AppEnvironment.STORE_ECOMMERCE:
        return [
          { 
            path: '/account', 
            component: 'CustomerAccountComponent', 
            layout: 'store-ecommerce', 
            guards: ['AuthGuard'] 
          },
          { 
            path: '/orders', 
            component: 'CustomerOrdersComponent', 
            layout: 'store-ecommerce', 
            guards: ['AuthGuard'] 
          }
        ];

      default:
        return [];
    }
  }

  /**
   * Resuelve layouts disponibles
   */
  private resolveLayouts(domainConfig: DomainConfig): LayoutConfig[] {
    const baseLayouts: LayoutConfig[] = [
      {
        name: 'auth',
        component: 'AuthLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_LANDING, AppEnvironment.ORG_LANDING, AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: []
      },
      {
        name: 'public',
        component: 'PublicLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_LANDING, AppEnvironment.ORG_LANDING],
        allowedRoles: []
      },
      {
        name: 'storefront',
        component: 'StorefrontLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_LANDING, AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: ['customer']
      }
    ];

    const privateLayouts: LayoutConfig[] = [
      {
        name: 'super-admin',
        component: 'SuperAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.VENDIX_ADMIN],
        allowedRoles: ['super_admin']
      },
      {
        name: 'organization-admin',
        component: 'OrganizationAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager']
      },
      {
        name: 'store-admin',
        component: 'StoreAdminLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'supervisor']
      },
      {
        name: 'org-ecommerce',
        component: 'OrgEcommerceLayoutComponent',
        allowedEnvironments: [AppEnvironment.ORG_ADMIN, AppEnvironment.STORE_ADMIN],
        allowedRoles: ['owner', 'admin', 'manager', 'customer']
      },
      {
        name: 'store-ecommerce',
        component: 'StoreEcommerceLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ECOMMERCE],
        allowedRoles: ['customer', 'employee']
      },
      {
        name: 'pos',
        component: 'POSLayoutComponent',
        allowedEnvironments: [AppEnvironment.STORE_ADMIN],
        allowedRoles: ['supervisor', 'employee']
      }
    ];

    return [...baseLayouts, ...privateLayouts].filter(layout => 
      layout.allowedEnvironments.includes(domainConfig.environment)
    );
  }

  /**
   * Resuelve características disponibles
   */
  private resolveFeatures(domainConfig: DomainConfig): string[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return ['registration', 'login', 'marketing', 'onboarding'];

      case AppEnvironment.VENDIX_ADMIN:
        return ['tenant-management', 'system-analytics', 'user-management', 'billing'];

      case AppEnvironment.ORG_LANDING:
        return ['company-info', 'contact', 'login', 'ecommerce'];

      case AppEnvironment.ORG_ADMIN:
        return ['store-management', 'user-management', 'analytics', 'billing', 'ecommerce'];

      case AppEnvironment.STORE_ADMIN:
        return ['inventory', 'sales', 'customer-management', 'pos', 'ecommerce'];

      case AppEnvironment.STORE_ECOMMERCE:
        return ['catalog', 'shopping-cart', 'checkout', 'account', 'reviews'];

      default:
        return [];
    }
  }

  /**
   * Transformación correcta de branding desde API
   */
  private transformBrandingFromApi(apiBranding: any): BrandingConfig {
    return {
      logo: {
        url: apiBranding.logo_url || 'assets/images/logo.png',
        alt: apiBranding.name || 'Logo',
        width: 120,
        height: 40
      },
      colors: {
        primary: apiBranding.primary_color || '#3B82F6',
        secondary: apiBranding.secondary_color || '#64748B',
        accent: apiBranding.accent_color || '#10B981',
        background: apiBranding.background_color || '#FFFFFF',
        surface: apiBranding.background_color || '#F8FAFC',
        text: {
          primary: apiBranding.text_color || '#1E293B',
          secondary: apiBranding.text_color || '#64748B',
          muted: apiBranding.text_color || '#94A3B8'
        }
      },
      fonts: {
        primary: 'Inter, sans-serif',
        secondary: 'Inter, sans-serif',
        headings: 'Inter, sans-serif'
      },
      favicon: apiBranding.favicon_url,
      customCSS: apiBranding.custom_css
    };
  }

  // ==================== DOMAIN DETECTION METHODS ====================

  /**
   * Consulta la API para resolver dominios personalizados
   */
  private async resolveDomainFromAPI(hostname: string): Promise<DomainResolution | null> {
    try {
      const response = await this.http
        .get<DomainResolution>(`${environment.apiUrl}/api/domains/resolve/${hostname}`)
        .pipe(
          catchError(error => {
            console.warn(`[APP CONFIG] API resolution failed for ${hostname}:`, error);
            return of(null);
          })
        )
        .toPromise();

      return response || null;
    } catch (error) {
      console.warn(`[APP CONFIG] Failed to resolve domain ${hostname}:`, error);
      return null;
    }
  }

  /**
   * Construye la configuración de dominio basada en la respuesta de la API
   */
  private buildDomainConfig(hostname: string, domainInfo: any): DomainConfig {
    console.log(`[APP CONFIG] Building config for domain:`, domainInfo);

    // Map domain type from API to enum
    let domainType: DomainType;
    switch (domainInfo.raw_domain_type) {
      case 'vendix_core':
        domainType = DomainType.VENDIX_CORE;
        break;
      case 'organization':
        domainType = DomainType.ORGANIZATION;
        break;
      case 'store':
        domainType = DomainType.STORE;
        break;
      case 'ecommerce':
        domainType = DomainType.ECOMMERCE;
        break;
      default:
        // Handle cases where domainType is provided directly
        switch (domainInfo.domain_type) {
          case 'vendix_core':
            domainType = DomainType.VENDIX_CORE;
            break;
          case 'organization':
            domainType = DomainType.ORGANIZATION;
            break;
          case 'store':
            domainType = DomainType.STORE;
            break;
          case 'ecommerce':
            domainType = DomainType.ECOMMERCE;
            break;
          default:
            throw new Error(`Unknown domain type: ${domainInfo.raw_domain_type || domainInfo.domain_type}`);
        }
    }

    // Map environment from API response - use config.app field
    let environment: AppEnvironment;
    if (domainInfo.config?.app) {
      const appType = domainInfo.config.app;
      switch (appType) {
        case 'VENDIX_LANDING':
          environment = AppEnvironment.VENDIX_LANDING;
          break;
        case 'VENDIX_ADMIN':
          environment = AppEnvironment.VENDIX_ADMIN;
          break;
        case 'ORG_LANDING':
          environment = AppEnvironment.ORG_LANDING;
          break;
        case 'ORG_ADMIN':
          environment = AppEnvironment.ORG_ADMIN;
          break;
        case 'STORE_ADMIN':
          environment = AppEnvironment.STORE_ADMIN;
          break;
        case 'STORE_ECOMMERCE':
          environment = AppEnvironment.STORE_ECOMMERCE;
          break;
        default:
          throw new Error(`Unknown app type: ${appType}`);
      }
    } else {
      throw new Error('No app environment information provided in domain resolution config');
    }

    return {
      domainType,
      environment,
      organization_slug: domainInfo.organization_slug,
      store_slug: domainInfo.store_slug,
      customConfig: domainInfo.config,
      isVendixDomain: domainInfo.organization_slug === 'vendix-corp',
      hostname
    };
  }

  // ==================== TENANT CONFIG METHODS ====================

  /**
   * Obtiene configuración desde la API
   */
  private async fetchTenantConfig(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      let endpoint = '';
      
      if (domainConfig.organization_slug && domainConfig.store_slug) {
        // Configuración de tienda específica
        endpoint = `/api/tenants/store/${domainConfig.organization_slug}/${domainConfig.store_slug}`;
      } else if (domainConfig.organization_slug) {
        // Configuración de organización
        endpoint = `/api/tenants/organization/${domainConfig.organization_slug}`;
      } else {
        throw new Error('No organization or store slug provided');
      }
      
      const response = await this.http
        .get<{ success: boolean; data: TenantConfig }>(`${environment.apiUrl}${endpoint}`)
        .pipe(
          catchError(error => {
            console.error('[APP CONFIG] API fetch failed:', error);
            return of(null);
          })
        )
        .toPromise();
      
      return response?.data || null;
      
    } catch (error) {
      console.error('[APP CONFIG] Error fetching from API:', error);
      return null;
    }
  }

  /**
   * Fusiona el branding por defecto de Vendix con el branding personalizado del dominio
   */
  private mergeVendixBranding(defaultBranding: any, domainBranding: any): any {
    return {
      ...defaultBranding,
      colors: {
        ...defaultBranding.colors,
        primary: domainBranding.primary_color || defaultBranding.colors.primary,
        secondary: domainBranding.secondary_color || defaultBranding.colors.secondary,
        accent: domainBranding.accent_color || defaultBranding.colors.accent,
        background: domainBranding.background_color || defaultBranding.colors.background,
        text: {
          primary: domainBranding.text_color || defaultBranding.colors.text.primary,
          secondary: domainBranding.text_color || defaultBranding.colors.text.secondary,
          muted: domainBranding.text_color || defaultBranding.colors.text.muted
        }
      },
      logo: {
        ...defaultBranding.logo,
        url: domainBranding.logo_url || defaultBranding.logo.url
      }
    };
  }

  // ==================== CACHE METHODS ====================

  private cacheAppConfig(config: AppConfig): void {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(config));
    } catch (error) {
      console.warn('[APP CONFIG] Failed to cache app config:', error);
    }
  }

  private cacheTenantConfig(cacheKey: string, config: TenantConfig): void {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(config));
    } catch (error) {
      console.warn('[APP CONFIG] Failed to cache tenant config:', error);
    }
  }

  private getCachedTenantConfig(cacheKey: string): TenantConfig | null {
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('[APP CONFIG] Failed to get cached tenant config:', error);
      return null;
    }
  }

  /**
   * Genera clave para el cache de tenant
   */
  private getTenantCacheKey(domainConfig: DomainConfig): string {
    const parts = [domainConfig.environment as string];
    
    if (domainConfig.organization_slug) {
      parts.push(domainConfig.organization_slug);
    }
    
    if (domainConfig.store_slug) {
      parts.push(domainConfig.store_slug);
    }
    
    return `${this.TENANT_CACHE_KEY}_${parts.join('-')}`;
  }

  // ==================== DEFAULT CONFIGURATIONS ====================

  /**
   * Obtiene configuración por defecto de Vendix
   */
  private getVendixDefaultConfig(): TenantConfig {
    return {
      organization: {
        id: 'vendix',
        slug: 'vendix',
        name: 'Vendix',
        description: 'Plataforma SaaS Multi-tenant para E-commerce',
        domains: {
          useCustomDomain: false,
          organizationUrl: 'vendix.com',
          adminUrls: ['admin.vendix.com'],
          storeUrls: []
        },
        subscription: {
          plan: 'enterprise',
          allowedStores: -1, // Ilimitado
          customDomainAllowed: true,
          features: ['all']
        },
        settings: {
          timezone: 'UTC',
          currency: 'USD',
          language: 'es',
          dateFormat: 'DD/MM/YYYY'
        }
      },
      branding: {
        logo: {
          url: 'assets/images/logo.png',
          alt: 'Vendix',
          width: 120,
          height: 40
        },
        colors: {
          primary: '#3B82F6',
          secondary: '#64748B',
          accent: '#10B981',
          background: '#FFFFFF',
          surface: '#F8FAFC',
          text: {
            primary: '#1E293B',
            secondary: '#64748B',
            muted: '#94A3B8'
          }
        },
        fonts: {
          primary: 'Inter, system-ui, sans-serif',
          headings: 'Inter, system-ui, sans-serif'
        }
      },
      theme: {
        name: 'vendix-default',
        primaryColor: '#3B82F6',
        secondaryColor: '#64748B',
        accentColor: '#10B981',
        backgroundColor: '#FFFFFF',
        textColor: '#1E293B',
        fontFamily: 'Inter, system-ui, sans-serif',
        borderRadius: '0.5rem',
        spacing: {
          xs: '0.25rem',
          sm: '0.5rem',
          md: '1rem',
          lg: '1.5rem',
          xl: '3rem'
        },
        shadows: {
          sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
          md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
        }
      },
      features: {
        onboarding: true,
        superAdmin: true,
        multiStore: true,
        userManagement: true,
        analytics: true,
        inventory: true,
        pos: true,
        orders: true,
        customers: true,
        reports: true,
        guestCheckout: true,
        wishlist: true,
        reviews: true,
        coupons: true,
        shipping: true,
        payments: true
      },
      seo: {
        title: 'Vendix - Plataforma E-commerce Multi-tenant',
        description: 'La mejor plataforma SaaS para crear y gestionar múltiples tiendas online',
        keywords: ['ecommerce', 'saas', 'multi-tenant', 'online store', 'vendix'],
        ogImage: '/assets/images/vendix-og.png'
      }
    };
  }

  private getDefaultBranding(): any {
    return {
      logo: {
        url: 'assets/images/logo.png',
        alt: 'Vendix',
        width: 120,
        height: 40
      },
      colors: {
        primary: '#3B82F6',
        secondary: '#64748B',
        accent: '#10B981',
        background: '#FFFFFF',
        surface: '#F8FAFC',
        text: {
          primary: '#1E293B',
          secondary: '#64748B',
          muted: '#94A3B8'
        }
      },
      fonts: {
        primary: 'Inter, sans-serif',
        secondary: 'Inter, sans-serif',
        headings: 'Inter, sans-serif'
      }
    };
  }

  // ==================== PUBLIC API ====================

  getCurrentConfig(): AppConfig | null {
    return this.configSubject.value;
  }

  isInitialized(): boolean {
    return this.configSubject.value !== null;
  }

  isLoading(): boolean {
    return this.loadingSubject.value;
  }

  getError(): string | null {
    return this.errorSubject.value;
  }

  clearCache(): void {
    try {
      localStorage.removeItem(this.CACHE_KEY);
      // Remove all tenant cache entries
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith(this.TENANT_CACHE_KEY)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('[APP CONFIG] Failed to clear cache:', error);
    }
  }

  async reinitialize(): Promise<AppConfig> {
    this.clearCache();
    return await this.initializeApp();
  }
}