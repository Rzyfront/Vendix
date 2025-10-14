import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import {
  DomainConfig,
  DomainType,
  AppEnvironment,
  DomainResolution
} from '../models/domain-config.interface';
import { environment } from '../../../environments/environment';
import * as TenantActions from '../store/tenant/tenant.actions';

@Injectable({
  providedIn: 'root'
})
export class DomainDetectorService {
  private readonly API_URL = environment.apiUrl;
  private readonly production = environment.production;
  private readonly DOMAIN_CONFIG_KEY = 'vendix_domain_config';

  constructor(
    private http: HttpClient,
    private store: Store
  ) {}

  /**
   * Detecta la configuración del dominio actual
   */
  async detectDomain(hostname?: string): Promise<DomainConfig> {
    const currentHostname = hostname || window.location.hostname;

    console.log(`[DOMAIN DETECTOR] Analyzing hostname: ${currentHostname}`);

    try {
      // Check if we have cached domain config
      const cachedConfig = this.getCachedDomainConfig();
      if (cachedConfig && cachedConfig.hostname === currentHostname) {
        console.log('[DOMAIN DETECTOR] Using cached domain config:', cachedConfig);
        this.store.dispatch(TenantActions.setDomainConfig({ domainConfig: cachedConfig }));
        return cachedConfig;
      }

      // Consultar API para resolver el dominio
      const domainInfo = await this.resolveDomainFromAPI(currentHostname);

      if (!domainInfo) {
        throw new Error(`Domain ${currentHostname} not found or not configured`);
      }

      const domainConfig = this.buildDomainConfig(currentHostname, domainInfo);

      // Cache the domain config
      this.cacheDomainConfig(domainConfig);

      // Store in NgRx state
      this.store.dispatch(TenantActions.setDomainConfig({ domainConfig }));

      return domainConfig;

    } catch (error) {
      console.error('[DOMAIN DETECTOR] Error detecting domain:', error);
      throw error;
    }
  }

  /**
   * Cache domain config in localStorage
   */
  private cacheDomainConfig(config: DomainConfig): void {
    try {
      localStorage.setItem(this.DOMAIN_CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      console.warn('[DOMAIN DETECTOR] Failed to cache domain config:', error);
    }
  }

  /**
   * Get cached domain config from localStorage
   */
  private getCachedDomainConfig(): DomainConfig | null {
    try {
      const cached = localStorage.getItem(this.DOMAIN_CONFIG_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn('[DOMAIN DETECTOR] Failed to get cached domain config:', error);
      return null;
    }
  }

  /**
   * Clear cached domain config
   */
  clearCache(): void {
    try {
      localStorage.removeItem(this.DOMAIN_CONFIG_KEY);
    } catch (error) {
      console.warn('[DOMAIN DETECTOR] Failed to clear domain config cache:', error);
    }
  }

  /**
   * Consulta la API para resolver dominios personalizados
   */
  private async resolveDomainFromAPI(hostname: string): Promise<DomainResolution | null> {
    try {
      const response = await this.http
        .get<DomainResolution>(`${this.API_URL}/api/domains/resolve/${hostname}`)
        .pipe(
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
    console.log(`[DOMAIN DETECTOR] Building config for domain:`, domainInfo);

    // Map domain type from API to enum
    let domainType: DomainType;
    switch (domainInfo.raw_domain_type) {
      case 'organization_root':
        domainType = DomainType.ORGANIZATION_ROOT;
        break;
      case 'organization_subdomain':
        domainType = DomainType.ORGANIZATION_SUBDOMAIN;
        break;
      case 'store_subdomain':
        domainType = DomainType.STORE_SUBDOMAIN;
        break;
      case 'store_custom':
        domainType = DomainType.STORE_CUSTOM;
        break;
      default:
        // Handle cases where domainType is provided directly (like "organization")
        switch (domainInfo.domainType) {
          case 'organization':
            domainType = DomainType.ORGANIZATION_ROOT;
            break;
          default:
            throw new Error(`Unknown domain type: ${domainInfo.type || domainInfo.domainType}`);
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
      organizationSlug: domainInfo.organizationSlug,
      storeSlug: domainInfo.storeSlug,
      customConfig: domainInfo.config,
      isVendixDomain: domainInfo.organizationSlug === 'vendix-corp',
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
