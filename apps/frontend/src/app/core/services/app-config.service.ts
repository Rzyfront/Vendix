import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  DomainConfig,
  AppEnvironment,
  DomainType,
  DomainResolution,
  DomainResolutionResponse,
} from '../models/domain-config.interface';
import { superAdminRoutes } from '../../routes/private/super_admin.routes';
import { vendixLandingPublicRoutes } from '../../routes/public/vendix_landing.public.routes';
import { orgLandingPublicRoutes } from '../../routes/public/org_landing.public.routes';
import { storeEcommercePublicRoutes } from '../../routes/public/store_ecommerce.public.routes';
import { storeLandingPublicRoutes } from '../../routes/public/store_landing.public.routes';
import { defaultPublicRoutes } from '../../routes/public/default.public.routes';
import { orgAdminRoutes } from '../../routes/private/org_admin.routes';
import { storeAdminRoutes } from '../../routes/private/store_admin.routes';
import { ecommerceRoutes } from '../../routes/private/ecommerce.routes';
import { BrandingConfig } from '../models/tenant-config.interface';
import { environment } from '../../../environments/environment';
import { Routes } from '@angular/router';
import { ThemeService } from './theme.service';

export interface LayoutConfig {
  name: string;
  component: string;
  allowedEnvironments: AppEnvironment[];
  allowedRoles: string[];
}
export interface AppConfig {
  environment: AppEnvironment;
  domainConfig: DomainConfig;
  routes: Routes;
  layouts: LayoutConfig[];
  branding: BrandingConfig;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private http = inject(HttpClient);
  private themeService = inject(ThemeService);

  async setupConfig(): Promise<AppConfig> {
    // 1. Detectar la configuración base del dominio.
    let domainConfig = await this.detectDomain();

    // 2. Revisar si hay un entorno de usuario guardado (de un login previo).
    const cachedUserEnv = this.getCachedUserEnvironment();

    // 3. Si existe, este tiene prioridad sobre el entorno por defecto del dominio.
    if (cachedUserEnv) {
      domainConfig.environment = cachedUserEnv;
    }

    // 4. Construir la configuración final con el entorno definitivo.
    const appConfig = this.buildAppConfig(domainConfig);
    this.cacheAppConfig(appConfig);
    return appConfig;
  }

  public updateEnvironmentForUser(
    currentConfig: AppConfig,
    userAppEnvironment: string,
  ): AppConfig {
    const newEnv = userAppEnvironment as AppEnvironment;
    const domainConfig: DomainConfig = {
      ...currentConfig.domainConfig,
      environment: newEnv,
    };
    const newConfig = this.buildAppConfig(domainConfig);
    this.cacheUserEnvironment(newEnv);
    this.cacheAppConfig(newConfig);
    return newConfig;
  }

  private buildAppConfig(domainConfig: DomainConfig): AppConfig {
    return {
      environment: domainConfig.environment,
      domainConfig,
      routes: this.resolveRoutes(domainConfig),
      layouts: [],
      branding: this.themeService.transformBrandingFromApi(
        domainConfig.customConfig?.branding || {},
      ),
    };
  }

  private resolveRoutes(domainConfig: DomainConfig): Routes {
    const publicRoutes = this.resolvePublicRoutes(domainConfig);
    const privateRoutes = this.resolvePrivateRoutes(domainConfig);
    return [...publicRoutes, ...privateRoutes];
  }

  private resolvePublicRoutes(domainConfig: DomainConfig): Routes {
    switch (domainConfig.environment) {
      case AppEnvironment.VENDIX_LANDING:
        return vendixLandingPublicRoutes;
      case AppEnvironment.ORG_LANDING:
        return orgLandingPublicRoutes;
      case AppEnvironment.STORE_ECOMMERCE:
        return storeEcommercePublicRoutes;
      case AppEnvironment.STORE_LANDING:
        return storeLandingPublicRoutes;
      default:
        return defaultPublicRoutes;
    }
  }

  private resolvePrivateRoutes(domainConfig: DomainConfig): Routes {
    switch (domainConfig.environment) {
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

  private async detectDomain(hostname?: string): Promise<DomainConfig> {
    const rawHostname =
      hostname ||
      (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const currentHostname = this.cleanHostname(rawHostname);
    const domainInfo = await this.resolveDomainFromAPI(currentHostname);
    if (!domainInfo) throw new Error(`Domain ${currentHostname} not found`);
    return this.buildDomainConfig(currentHostname, domainInfo);
  }

  private cleanHostname(hostname: string): string {
    // Remover el subdominio www si está presente
    if (hostname.startsWith('www.')) {
      return hostname.substring(4);
    }
    return hostname;
  }

  private async resolveDomainFromAPI(
    hostname: string,
  ): Promise<DomainResolution | null> {
    const response = await this.http
      .get<DomainResolutionResponse>(
        `${environment.apiUrl}/public/domains/resolve/${hostname}`,
      )
      .pipe(catchError(() => of(null)))
      .toPromise();
    return response?.data ?? null;
  }

  private buildDomainConfig(
    hostname: string,
    domainInfo: DomainResolution,
  ): DomainConfig {
    return {
      hostname,
      domainType: domainInfo.domain_type as DomainType,
      environment: domainInfo.config.app as AppEnvironment,
      organization_slug: domainInfo.organization_slug,
      store_slug: domainInfo.store_slug,
      organization_id: domainInfo.organization_id,
      store_id: domainInfo.store_id,
      customConfig: domainInfo.config,
      isVendixDomain: domainInfo.organization_slug === 'vendix-corp',
    };
  }

  private getCachedUserEnvironment(): AppEnvironment | null {
    try {
      if (typeof localStorage === 'undefined') return null;

      // 🔒 SECURITY CHECK: Verificar si el usuario acaba de cerrar sesión recientemente
      const loggedOutRecently = localStorage.getItem('vendix_logged_out_recently');
      if (loggedOutRecently) {
        const logoutTime = parseInt(loggedOutRecently);
        const currentTime = Date.now();
        // Si el logout fue hace menos de 30 segundos, ignorar el environment cachado
        if (currentTime - logoutTime < 30000) {
          console.log('🔒 Recent logout detected, ignoring cached environment');
          localStorage.removeItem('vendix_user_environment');
          localStorage.removeItem('vendix_logged_out_recently');
          return null;
        }
        // Limpiar bandera si pasó más tiempo
        localStorage.removeItem('vendix_logged_out_recently');
      }

      return localStorage.getItem(
        'vendix_user_environment',
      ) as AppEnvironment | null;
    } catch (e) {
      return null;
    }
  }

  private cacheUserEnvironment(env: AppEnvironment): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_user_environment', env);
    } catch (e) { }
  }
  private cacheAppConfig(config: AppConfig): void {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('vendix_app_config', JSON.stringify(config));
    } catch (e) { }
  }
}
