import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { DomainConfig, AppEnvironment } from '../models/domain-config.interface';
import { TenantConfig, OrganizationConfig, StoreConfig } from '../models/tenant-config.interface';

@Injectable({
  providedIn: 'root'
})
export class TenantConfigService {
  private readonly API_URL = 'http://localhost:3000';
  
  // Estado global de la configuración del tenant
  private tenantConfigSubject = new BehaviorSubject<TenantConfig | null>(null);
  public tenantConfig$ = this.tenantConfigSubject.asObservable();
  
  // Estado del dominio actual
  private domainConfigSubject = new BehaviorSubject<DomainConfig | null>(null);
  public domainConfig$ = this.domainConfigSubject.asObservable();
  
  // Cache de configuraciones
  private configCache = new Map<string, TenantConfig>();

  constructor(private http: HttpClient) {}

  /**
   * Carga la configuración del tenant basada en el dominio
   */
  async loadTenantConfig(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      console.log('[TENANT CONFIG] Loading config for domain:', domainConfig);
      
      // Guardar configuración de dominio
      this.domainConfigSubject.next(domainConfig);
      
      // Si es dominio de Vendix, usar configuración por defecto
      if (domainConfig.isVendixDomain && 
          (domainConfig.environment === AppEnvironment.VENDIX_LANDING || 
           domainConfig.environment === AppEnvironment.VENDIX_ADMIN)) {
        const vendixConfig = this.getVendixDefaultConfig();
        this.tenantConfigSubject.next(vendixConfig);
        return vendixConfig;
      }
      
      // Verificar cache
      const cacheKey = this.getCacheKey(domainConfig);
      if (this.configCache.has(cacheKey)) {
        const cachedConfig = this.configCache.get(cacheKey)!;
        this.tenantConfigSubject.next(cachedConfig);
        return cachedConfig;
      }
      
      // Cargar desde API
      const config = await this.fetchTenantConfig(domainConfig);
      
      if (config) {
        // Guardar en cache
        this.configCache.set(cacheKey, config);
        this.tenantConfigSubject.next(config);
      }
      
      return config;
      
    } catch (error) {
      console.error('[TENANT CONFIG] Error loading tenant config:', error);
      throw error;
    }
  }

  /**
   * Obtiene la configuración actual del tenant
   */
  getCurrentTenantConfig(): TenantConfig | null {
    return this.tenantConfigSubject.value;
  }

  /**
   * Obtiene la configuración actual del dominio
   */
  getCurrentDomainConfig(): DomainConfig | null {
    return this.domainConfigSubject.value;
  }

  /**
   * Actualiza la configuración del tenant
   */
  updateTenantConfig(config: Partial<TenantConfig>): void {
    const currentConfig = this.tenantConfigSubject.value;
    if (currentConfig) {
      const updatedConfig = { ...currentConfig, ...config };
      this.tenantConfigSubject.next(updatedConfig);
      
      // Actualizar cache
      const domainConfig = this.domainConfigSubject.value;
      if (domainConfig) {
        const cacheKey = this.getCacheKey(domainConfig);
        this.configCache.set(cacheKey, updatedConfig);
      }
    }
  }

  /**
   * Limpia el cache de configuraciones
   */
  clearCache(): void {
    this.configCache.clear();
  }

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
          url: '/assets/images/vendix-logo.png',
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

  /**
   * Obtiene configuración desde la API
   */
  private async fetchTenantConfig(domainConfig: DomainConfig): Promise<TenantConfig | null> {
    try {
      let endpoint = '';
      
      if (domainConfig.organizationSlug && domainConfig.storeSlug) {
        // Configuración de tienda específica
        endpoint = `/api/tenants/store/${domainConfig.organizationSlug}/${domainConfig.storeSlug}`;
      } else if (domainConfig.organizationSlug) {
        // Configuración de organización
        endpoint = `/api/tenants/organization/${domainConfig.organizationSlug}`;
      } else {
        throw new Error('No organization or store slug provided');
      }
      
      const response = await this.http
        .get<{ success: boolean; data: TenantConfig }>(`${this.API_URL}${endpoint}`)
        .pipe(
          catchError(error => {
            console.error('[TENANT CONFIG] API fetch failed:', error);
            return of(null);
          })
        )
        .toPromise();
      
      return response?.data || null;
      
    } catch (error) {
      console.error('[TENANT CONFIG] Error fetching from API:', error);
      return null;
    }
  }

  /**
   * Genera clave para el cache
   */
  private getCacheKey(domainConfig: DomainConfig): string {
    const parts = [domainConfig.environment as string];
    
    if (domainConfig.organizationSlug) {
      parts.push(domainConfig.organizationSlug);
    }
    
    if (domainConfig.storeSlug) {
      parts.push(domainConfig.storeSlug);
    }
    
    return parts.join('-');
  }

  /**
   * Verifica si una característica está habilitada
   */
  isFeatureEnabled(featureName: string): boolean {
    const config = this.getCurrentTenantConfig();
    return config?.features?.[featureName] || false;
  }

  /**
   * Obtiene la organización actual
   */
  getCurrentOrganization(): OrganizationConfig | null {
    const config = this.getCurrentTenantConfig();
    return config?.organization || null;
  }

  /**
   * Obtiene la tienda actual
   */
  getCurrentStore(): StoreConfig | null {
    const config = this.getCurrentTenantConfig();
    return config?.store || null;
  }

  /**
   * Verifica si el dominio actual es de Vendix
   */
  isVendixDomain(): boolean {
    const domainConfig = this.getCurrentDomainConfig();
    return domainConfig?.isVendixDomain || false;
  }

  /**
   * Obtiene el entorno actual
   */
  getCurrentEnvironment(): AppEnvironment | null {
    const domainConfig = this.getCurrentDomainConfig();
    return domainConfig?.environment || null;
  }
}
