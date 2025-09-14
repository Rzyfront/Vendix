import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import {
  DomainConfig,
  DomainType,
  AppEnvironment,
  DomainResolution
} from '../models/domain-config.interface';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class DomainDetectorService {
  private readonly API_URL = environment.apiUrl;
  private readonly production = environment.production;

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  /**
   * Detecta la configuración del dominio actual
   */
  async detectDomain(hostname?: string): Promise<DomainConfig> {
    const currentHostname = hostname || (isPlatformBrowser(this.platformId) ? window.location.hostname : 'localhost');
    
    console.log(`[DOMAIN DETECTOR] Analyzing hostname: ${currentHostname}`);

    try {
      // 1. Verificar si es dominio de Vendix
      if (this.isVendixCoreDomain(currentHostname)) {
        return this.handleVendixDomain(currentHostname);
      }

      // 2. Para desarrollo local, usar mapeo
      if (this.isDevelopmentEnvironment()) {
        const devConfig = this.getDevelopmentMapping(currentHostname);
        if (devConfig) {
          return devConfig;
        }
      }

      // 3. Consultar API para dominios personalizados
      const domainInfo = await this.resolveDomainFromAPI(currentHostname);
      
      if (!domainInfo) {
        throw new Error(`Domain ${currentHostname} not found or not configured`);
      }

      return this.buildDomainConfig(currentHostname, domainInfo);

    } catch (error) {
      console.error('[DOMAIN DETECTOR] Error detecting domain:', error);
      throw error;
    }
  }

  /**
   * Verifica si es un dominio core de Vendix
   */
   private isVendixCoreDomain(hostname: string): boolean {
    // Usar configuración del backend en lugar de valores hardcodeados
    // Por ahora mantenemos una lista básica, pero esto debería venir del backend
    const vendixDomains = [
      'vendix.com',
      'admin.vendix.com',
      'localhost',
      '127.0.0.1'
    ];

    return vendixDomains.includes(hostname) || hostname.endsWith('.vendix.com');
  }

  /**
   * Maneja dominios de Vendix
   */
  private handleVendixDomain(hostname: string): DomainConfig {
    console.log(`[DOMAIN DETECTOR] Handling Vendix domain: ${hostname}`);

    // Vendix principal
    if (hostname === 'vendix.com' || hostname === 'localhost' || hostname === '127.0.0.1') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname
      };
    }

    // Admin de Vendix
    if (hostname === 'admin.vendix.com') {
      return {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_ADMIN,
        isVendixDomain: true,
        hostname
      };
    }

    // Subdominios de Vendix (organizaciones sin dominio propio)
    if (hostname.endsWith('.vendix.com')) {
      const subdomain = hostname.replace('.vendix.com', '');
      
      // admin-{store}.vendix.com
      if (subdomain.startsWith('admin-')) {
        const storeSlug = subdomain.replace('admin-', '');
        return {
          domainType: DomainType.STORE_SUBDOMAIN,
          environment: AppEnvironment.STORE_ADMIN,
          storeSlug,
          isVendixDomain: true,
          hostname
        };
      }
      
      // store-{store}.vendix.com
      if (subdomain.startsWith('store-')) {
        const storeSlug = subdomain.replace('store-', '');
        return {
          domainType: DomainType.STORE_SUBDOMAIN,
          environment: AppEnvironment.STORE_ECOMMERCE,
          storeSlug,
          isVendixDomain: true,
          hostname
        };
      }
      
      // {org}.vendix.com
      return {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: subdomain,
        isVendixDomain: true,
        hostname
      };
    }

    throw new Error(`Unrecognized Vendix domain: ${hostname}`);
  }

  /**
   * Verifica si estamos en entorno de desarrollo
   */
  private isDevelopmentEnvironment(): boolean {
    return !this.production;
  }

  /**
   * Obtiene el mapeo para desarrollo local
   * Nota: Para desarrollo, usamos configuración simplificada ya que el backend puede no estar disponible
   */
  private getDevelopmentMapping(hostname: string): DomainConfig | null {
    const port = isPlatformBrowser(this.platformId) ? window.location.port : '';
    const fullHostname = port ? `${hostname}:${port}` : hostname;

    // Mapeo básico para desarrollo - en producción esto vendría del backend
    const devMappings: { [key: string]: DomainConfig } = {
      'localhost:4200': {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: fullHostname
      }
    };

    return devMappings[fullHostname] || null;
  }

  /**
   * Fallback para desarrollo cuando el backend no está disponible
   */
  private getFallbackDevelopmentMapping(fullHostname: string): DomainConfig | null {
    const devMappings: { [key: string]: DomainConfig } = {
      'localhost:4200': {
        domainType: DomainType.VENDIX_CORE,
        environment: AppEnvironment.VENDIX_LANDING,
        isVendixDomain: true,
        hostname: fullHostname
      },
      'mordoc.localhost:4200': {
        domainType: DomainType.ORGANIZATION_ROOT,
        environment: AppEnvironment.ORG_LANDING,
        organizationSlug: 'mordoc',
        isVendixDomain: false,
        hostname: fullHostname
      },
      'app.mordoc.localhost:4200': {
        domainType: DomainType.ORGANIZATION_SUBDOMAIN,
        environment: AppEnvironment.ORG_ADMIN,
        organizationSlug: 'mordoc',
        isVendixDomain: false,
        hostname: fullHostname
      },
      'luda.mordoc.localhost:4200': {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ECOMMERCE,
        organizationSlug: 'mordoc',
        storeSlug: 'luda',
        isVendixDomain: false,
        hostname: fullHostname
      },
      'admin.luda.localhost:4200': {
        domainType: DomainType.STORE_SUBDOMAIN,
        environment: AppEnvironment.STORE_ADMIN,
        organizationSlug: 'mordoc',
        storeSlug: 'luda',
        isVendixDomain: false,
        hostname: fullHostname
      }
    };

    return devMappings[fullHostname] || null;
  }

  /**
   * Consulta la API para resolver dominios personalizados
   */
  private async resolveDomainFromAPI(hostname: string): Promise<DomainResolution | null> {
    try {
      const response = await this.http
        .get<{ success: boolean; data: DomainResolution }>(`${this.API_URL}/api/public/domains/resolve/${hostname}`)
        .pipe(
          map(response => response.data),
          catchError(error => {
            console.warn(`[DOMAIN DETECTOR] API resolution failed for ${hostname}:`, error);
            return of(null);
          })
        )
        .toPromise();

      return response || null;
    } catch (error) {
      console.warn(`[DOMAIN DETECTOR] Failed to resolve domain ${hostname}:`, error);
      return null;
    }
  }

  /**
   * Construye la configuración de dominio basada en la respuesta de la API
   */
  private buildDomainConfig(hostname: string, domainInfo: DomainResolution): DomainConfig {
    console.log(`[DOMAIN DETECTOR] Building config for custom domain:`, domainInfo);

    let environment: AppEnvironment;
    let domainType: DomainType;

    // Determinar el tipo de dominio y entorno
    switch (domainInfo.type) {
      case 'organization_root':
        domainType = DomainType.ORGANIZATION_ROOT;
        environment = domainInfo.environmentConfig?.showLanding 
          ? AppEnvironment.ORG_LANDING 
          : AppEnvironment.ORG_ADMIN;
        break;
        
      case 'organization_subdomain':
        domainType = DomainType.ORGANIZATION_SUBDOMAIN;
        environment = AppEnvironment.ORG_ADMIN;
        break;
        
      case 'store_subdomain':
        domainType = DomainType.STORE_SUBDOMAIN;
        environment = domainInfo.purpose === 'admin' 
          ? AppEnvironment.STORE_ADMIN 
          : AppEnvironment.STORE_ECOMMERCE;
        break;
        
      case 'store_custom':
        domainType = DomainType.STORE_CUSTOM;
        environment = domainInfo.purpose === 'admin' 
          ? AppEnvironment.STORE_ADMIN 
          : AppEnvironment.STORE_ECOMMERCE;
        break;
        
      default:
        throw new Error(`Unknown domain type: ${domainInfo.type}`);
    }

    return {
      domainType,
      environment,
      organizationSlug: domainInfo.organizationSlug,
      storeSlug: domainInfo.storeSlug,
      customConfig: domainInfo.config,
      isVendixDomain: false,
      hostname
    };
  }

  /**
   * Obtiene información adicional del dominio
   */
  getDomainInfo(config: DomainConfig): { displayName: string; type: string; description: string } {
    switch (config.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return {
          displayName: 'Vendix',
          type: 'Landing Principal',
          description: 'Página principal de Vendix'
        };
        
      case AppEnvironment.VENDIX_ADMIN:
        return {
          displayName: 'Vendix Admin',
          type: 'Super Administración',
          description: 'Panel de administración de Vendix'
        };
        
      case AppEnvironment.ORG_LANDING:
        return {
          displayName: config.organizationSlug || 'Organización',
          type: 'Landing Organizacional',
          description: 'Página principal de la organización'
        };
        
      case AppEnvironment.ORG_ADMIN:
        return {
          displayName: config.organizationSlug || 'Organización',
          type: 'Admin Organizacional',
          description: 'Panel de administración organizacional'
        };
        
      case AppEnvironment.STORE_ADMIN:
        return {
          displayName: config.storeSlug || 'Tienda',
          type: 'Admin Tienda',
          description: 'Panel de administración de tienda'
        };
        
      case AppEnvironment.STORE_ECOMMERCE:
        return {
          displayName: config.storeSlug || 'Tienda',
          type: 'E-commerce',
          description: 'Tienda online'
        };
        
      default:
        return {
          displayName: 'Desconocido',
          type: 'No identificado',
          description: 'Entorno no identificado'
        };
    }
  }
}
