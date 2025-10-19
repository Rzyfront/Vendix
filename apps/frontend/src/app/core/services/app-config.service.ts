import { Injectable, inject } from '@angular/core';

const DOMAIN_SETTINGS_CACHE_KEY = 'domain_settings';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { DomainConfig, AppEnvironment, DomainType, DomainResolution } from '../models/domain-config.interface';
import { superAdminRoutes } from '../../routes/private/super_admin.routes';
import { vendixLandingPublicRoutes } from '../../routes/public/vendix_landing.public.routes';
import { orgLandingPublicRoutes } from '../../routes/public/org_landing.public.routes';
import { storeEcommercePublicRoutes } from '../../routes/public/store_ecommerce.public.routes';
import { defaultPublicRoutes } from '../../routes/public/default.public.routes';
import { orgAdminRoutes } from '../../routes/private/org_admin.routes';
import { storeAdminRoutes } from '../../routes/private/store_admin.routes';
import { ecommerceRoutes } from '../../routes/private/ecommerce.routes';
import { TenantConfig, BrandingConfig } from '../models/tenant-config.interface';
import { ThemeService } from './theme.service';
import { environment } from '../../../environments/environment';
import * as TenantActions from '../store/tenant/tenant.actions';

// --- CACHE KEYS ---
const APP_CONFIG_CACHE_KEY = 'vendix_app_config';
const TENANT_CONFIG_CACHE_KEY = 'vendix_tenant_config';
const DOMAIN_CACHE_KEY = 'vendix_domain_cache';
const USER_ENV_CACHE_KEY = 'vendix_user_environment';

// --- RESTORED INTERFACES ---
export interface RouteConfig {
  path: string;
  component?: string; // Component is optional for parent routes
  layout?: string;
  guards?: string[];
  data?: any;
  isPublic?: boolean;
  children?: RouteConfig[]; // Add children property
}


export interface LayoutConfig {
  name: string;
  component: string;
  allowedEnvironments: AppEnvironment[];
  allowedRoles: string[];
}

export interface AppConfig {
  environment: AppEnvironment;
  domainConfig: DomainConfig;
  tenantConfig: TenantConfig | null;
  routes: RouteConfig[];
  layouts: LayoutConfig[];
  features: string[];
  branding: BrandingConfig;
}

@Injectable({
  providedIn: 'root'
})
export class AppConfigService {
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutos

  private configSubject = new BehaviorSubject<AppConfig | null>(null);
  public config$ = this.configSubject.asObservable();

  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private errorSubject = new BehaviorSubject<string | null>(null);
  public error$ = this.errorSubject.asObservable();

  private http = inject(HttpClient);
  private store = inject(Store);
  private themeService = inject(ThemeService);

  async initializeApp(): Promise<AppConfig> {
    this.errorSubject.next(null);
    try {
      const cachedUserEnv = this.getCachedUserEnvironment();
      let domainConfig: DomainConfig;

      // Si hay un entorno de usuario en caché, priorizarlo sobre la detección de dominio
      if (cachedUserEnv) {
        domainConfig = await this.detectDomain();
        domainConfig = {
          ...domainConfig,
          environment: this.normalizeEnvironment(cachedUserEnv)
        };
      } else {
        domainConfig = await this.detectDomain();
      }
      const tenantConfig = await this.loadTenantConfigByDomain(domainConfig);
      const appConfig = await this.buildAppConfig(domainConfig, tenantConfig);
      if (appConfig) {
        await this.themeService.applyAppConfiguration(appConfig);
      }
      this.cacheAppConfig(appConfig);
      this.configSubject.next(appConfig);
      this.store.dispatch(TenantActions.setDomainConfig({ domainConfig: appConfig.domainConfig }));
      this.loadingSubject.next(false);
      return appConfig;

    } catch (error) {
      // Silenciar error
      this.errorSubject.next(error instanceof Error ? error.message : 'Unknown error');
      this.loadingSubject.next(false);
      throw error;
    }
  }

  public async updateEnvironmentForUser(userAppEnvironment: string): Promise<void> {
    const currentConfig = this.getCurrentConfig();
    if (!currentConfig) {
      return;
    }
    // Normalizar el entorno a mayúsculas para coincidir con el enum AppEnvironment
    const normalizedEnv = this.normalizeEnvironment(userAppEnvironment);
    // Reconstruir la configuración completa con el nuevo entorno
    const domainConfig: DomainConfig = {
      ...currentConfig.domainConfig,
      environment: normalizedEnv
    };
    const tenantConfig = currentConfig.tenantConfig;
    const newConfig = await this.buildAppConfig(domainConfig, tenantConfig);
    // Guardar el environment en mayúsculas (UPPER_SNAKE_CASE)
    this.cacheUserEnvironment(normalizedEnv);
    this.configSubject.next(newConfig);
    this.cacheAppConfig(newConfig);
  }

  /**
   * Normaliza el entorno a mayúsculas para coincidir con el enum AppEnvironment
   */
  private normalizeEnvironment(env: string): AppEnvironment {
    const normalized = env.toUpperCase();
    switch(normalized) {
      case 'VENDIX_LANDING': return AppEnvironment.VENDIX_LANDING;
      case 'VENDIX_ADMIN': return AppEnvironment.VENDIX_ADMIN;
      case 'ORG_LANDING': return AppEnvironment.ORG_LANDING;
      case 'ORG_ADMIN': return AppEnvironment.ORG_ADMIN;
      case 'STORE_ADMIN': return AppEnvironment.STORE_ADMIN;
      case 'STORE_ECOMMERCE': return AppEnvironment.STORE_ECOMMERCE;
      default:
        return AppEnvironment.VENDIX_LANDING;
    }
  }

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
  // --- RESTORED METHODS ---

  private resolveRoutes(domainConfig: DomainConfig, tenantConfig: TenantConfig | null): RouteConfig[] {
    const routes: RouteConfig[] = [];
    routes.push(...this.resolvePublicRoutes(domainConfig));
    routes.push(...this.resolvePrivateRoutes(domainConfig));
    return routes;
  }
  private resolvePublicRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return vendixLandingPublicRoutes;
      case AppEnvironment.ORG_LANDING:
        return orgLandingPublicRoutes;
      case AppEnvironment.STORE_ECOMMERCE:
        return storeEcommercePublicRoutes;
      default:
        return defaultPublicRoutes;
    }
  }

  /**
   * Rutas privadas por entorno
   */
  private resolvePrivateRoutes(domainConfig: DomainConfig): RouteConfig[] {
    switch(domainConfig.environment) {
      case AppEnvironment.VENDIX_ADMIN:
        return superAdminRoutes;
      case AppEnvironment.ORG_ADMIN:
        return orgAdminRoutes;
      case AppEnvironment.STORE_ADMIN:
        return storeAdminRoutes;
      case AppEnvironment.STORE_ECOMMERCE:
        return ecommerceRoutes;
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

  // --- UNCHANGED METHODS ---

  private async detectDomain(hostname?: string): Promise<DomainConfig> {
    let currentHostname = hostname || window.location.hostname;
    if (currentHostname.startsWith('www.')) {
      currentHostname = currentHostname.substring(4);
    }
    try {
      const domainInfo = await this.resolveDomainFromAPI(currentHostname);
      if (!domainInfo) {
        throw new Error(`Domain ${currentHostname} not found or not configured`);
      }
      const domainConfig = this.buildDomainConfig(currentHostname, domainInfo);
      return domainConfig;
    } catch (error) {
      throw error;
    }
  }

  async loadTenantConfigByDomain(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      const cacheKey = this.getTenantCacheKey(domainConfig);
      const cachedConfig = this.getCachedTenantConfig(cacheKey);
      if (cachedConfig) return cachedConfig;
      const config = await this.fetchTenantConfig(domainConfig);
      if (config) this.cacheTenantConfig(cacheKey, config);
      return config;
    } catch (error) {
      throw error;
    }
  }

  private cacheUserEnvironment(env: AppEnvironment): void {
    try {
      localStorage.setItem(USER_ENV_CACHE_KEY, env);
    } catch (error) {
      // Silenciar error de caché
    }
  }

  private getCachedUserEnvironment(): AppEnvironment | null {
    try {
      const cached = localStorage.getItem(USER_ENV_CACHE_KEY);
      if (!cached) return null;
      
      // Normalizar el entorno en caché para asegurar compatibilidad
      return this.normalizeEnvironment(cached);
    } catch (error) {
      return null;
    }
  }

  private cacheAppConfig(config: AppConfig): void {
    try {
      localStorage.setItem(APP_CONFIG_CACHE_KEY, JSON.stringify(config));
    } catch (error) {
      // Silenciar error de caché
    }
  }

  clearCache(): void {
    try {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('vendix_') || key === DOMAIN_SETTINGS_CACHE_KEY) {
          localStorage.removeItem(key);
        }
      });
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    } catch (error) {
      // Silenciar error de limpieza de caché
    }
  }

  getCurrentConfig(): AppConfig | null {
    return this.configSubject.value;
  }

  isInitialized(): boolean {
    return this.configSubject.value !== null;
  }

  async reinitialize(): Promise<AppConfig> {
    this.clearCache();
    return await this.initializeApp();
  }

  private async resolveDomainFromAPI(hostname: string): Promise<DomainResolution | null> {
    try {
      const cachedDomain = this.getCachedDomainSettings();
      if (cachedDomain) {
        return cachedDomain;
      }

      const response = await this.http
        .get<DomainResolution>(`${environment.apiUrl}/api/domains/resolve/${hostname}`)
        .pipe(
          catchError(error => {
            return of(null);
          })
        )
        .toPromise();

      if (response) {
        this.cacheDomainSettings(response);
      }

      return response || null;
    } catch (error) {
      return null;
    }
  }

  private buildDomainConfig(hostname: string, domainInfo: any): DomainConfig {
    let domainType: DomainType;
    switch (domainInfo.domain_type) {
      case 'vendix_core': domainType = DomainType.VENDIX_CORE; break;
      case 'organization': domainType = DomainType.ORGANIZATION; break;
      case 'store': domainType = DomainType.STORE; break;
      case 'ecommerce': domainType = DomainType.ECOMMERCE; break;
      default: throw new Error(`Unknown domain type: ${domainInfo.domain_type}`);
    }

    let appEnvironment: AppEnvironment;
    const appType = domainInfo.config?.app;
    if (appType) {
      appEnvironment = this.normalizeEnvironment(appType);
    } else {
      throw new Error('No app environment information provided in domain resolution config');
    }

    return {
      domainType,
      environment: appEnvironment,
      organization_slug: domainInfo.organization_slug,
      store_slug: domainInfo.store_slug,
      customConfig: domainInfo.config,
      isVendixDomain: domainInfo.organization_slug === 'vendix-corp',
      hostname
    };
  }

  private async fetchTenantConfig(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      let endpoint = '';
      if (domainConfig.organization_slug && domainConfig.store_slug) {
        endpoint = `/api/tenants/store/${domainConfig.organization_slug}/${domainConfig.store_slug}`;
      } else if (domainConfig.organization_slug) {
        endpoint = `/api/tenants/organization/${domainConfig.organization_slug}`;
      } else {
        throw new Error('No organization or store slug provided');
      }
      
      const response = await this.http
        .get<{ success: boolean; data: TenantConfig }>(`${environment.apiUrl}${endpoint}`)
        .pipe(catchError(error => {
          return of(null);
        }))
        .toPromise();
      
      return response?.data || null;
    } catch (error) {
      return null;
    }
  }


  private getTenantCacheKey(domainConfig: DomainConfig): string {
    const parts = [domainConfig.environment as string];
    if (domainConfig.organization_slug) parts.push(domainConfig.organization_slug);
    if (domainConfig.store_slug) parts.push(domainConfig.store_slug);
    return `${TENANT_CONFIG_CACHE_KEY}_${parts.join('-')}`;
  }

  private getCachedTenantConfig(cacheKey: string): TenantConfig | null {
    try {
      const cached = localStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      return null;
    }
  }

  private cacheTenantConfig(cacheKey: string, config: TenantConfig): void {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(config));
    } catch (error) {
      // Silenciar error de caché
    }
  }

  private cacheDomainSettings(domainInfo: DomainResolution): void {
    try {
      const cacheData = { data: domainInfo, timestamp: Date.now(), ttl: this.CACHE_TTL };
      localStorage.setItem(DOMAIN_SETTINGS_CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      // Silenciar error de caché
    }
  }

  private getCachedDomainSettings(): DomainResolution | null {
    try {
      const cached = localStorage.getItem(DOMAIN_SETTINGS_CACHE_KEY);
      if (!cached) return null;

      const cacheData = JSON.parse(cached);
      if (Date.now() - cacheData.timestamp > cacheData.ttl) {
        localStorage.removeItem(DOMAIN_SETTINGS_CACHE_KEY);
        return null;
      }
      return cacheData.data;
    } catch (error) {
      return null;
    }
  }
}